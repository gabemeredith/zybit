/**
 * Persona-driven session simulator. Emits CanonicalEvent-shaped events
 * straight into an EventSink — no real browser, no DOM.
 *
 * Event shape: mints events in the SAME shape Zybit's PostHog connector
 * produces at ingest — `page_view` events carry `scrollPctNormalized`,
 * `dwellMs`, and optionally `activeSeconds`; `cta_click` events carry
 * the actual clicked CTA's `cta_text` + `element_tag` (not a single
 * scenario-wide primaryCta). Rage clicks emit when the scenario manifest
 * names a `rageCtaSelector`.
 *
 * Snapshot-driven CTA clicks: when callers pass `pageSnapshotsByPath`,
 * cta_click events sample from the snapshot's CTAs weighted by visual
 * weight, so the HTML determines which CTA "wins" clicks. Falls back to
 * the legacy single-primaryCta tag when no snapshot is available.
 *
 * Why no Playwright here:
 *   The direct-mode sink writes canonical events straight to
 *   phase1_events. There's no autocapture path to exercise, so spinning
 *   up Chromium per session would be pure overhead. A future
 *   playwrightDriver.ts will land alongside this file when --mode
 *   posthog needs real autocapture against a real OSS site.
 *
 * Determinism: every random draw flows through the passed-in `rng`. A
 * caller that constructs `rng = seededRng(`${scenarioId}|${sessionIdx}`)`
 * gets byte-identical event sequences across re-runs.
 */

import type { CtaCandidate, PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { EventSink } from '../sinks/types';
import type { Persona } from '../personas/types';
import {
  boundedNormal,
  logNormal,
  randInt,
  weightedSample,
} from './distributions';
import type { Rng } from './rng';

export interface RunSessionOpts {
  persona: Persona;
  rng: Rng;
  siteId: string;
  /**
   * Paths the session can navigate. Persona biases preferredPaths via
   * weighted sampling but any path in this list is fair game.
   */
  paths: string[];
  /**
   * Per-path outbound transition weights (LIGHTHOUSE.md §13 #1).
   * When present and the current path has an entry, the driver samples the
   * next path from these weights instead of uniform persona-weighted random.
   */
  transitionWeights?: Record<string, Array<{ path: string; weight: number }>>;
  /**
   * Per-path exit hazard (LIGHTHOUSE.md §13 #2).
   * Probability [0,1] that a session ends AFTER visiting this path instead
   * of continuing. Only fires when the session still has remaining pages.
   */
  exitHazard?: Record<string, number>;
  /**
   * Per-path snapshot data. When present and the current path has a
   * snapshot, cta_click events sample from snapshot CTAs weighted by
   * visualWeight — so visually-heavy CTAs naturally win more clicks
   * (which is exactly how hero-hierarchy-inversion gets surfaced).
   */
  pageSnapshotsByPath?: Map<string, PageSnapshotData>;
  /**
   * Fallback CTA tag for cta_click events when no snapshot is available
   * for the current path. Kept for back-compat with scenarios that
   * predate snapshot-driven clicks.
   */
  primaryCta?: { ctaId: string; selector?: string };
  /**
   * Selector of a CTA that produces rage clicks. Matched against the
   * current path's snapshot CTAs; if found and rng < rageClickRate,
   * emits a `rage_click` event tagged with that CTA's text + tag.
   */
  rageCtaSelector?: string;
  /** Per-pageview probability that a rage_click event fires on the rage target. */
  rageClickRate?: number;
  /**
   * Set of paths where active dwell should land ≥45s (feeds
   * `hesitation-pattern`). The driver attaches `activeSeconds` to
   * page_view events on these paths.
   */
  hesitationPaths?: Set<string>;
  /**
   * Set of paths whose layout is so long that users scroll less than a
   * persona's baseline. The driver halves the sampled scroll percent on
   * these paths so editorial pages can fire `above-fold-coverage`
   * without making the persona mix universally bouncy.
   */
  lowScrollPaths?: Set<string>;
  sink: EventSink;
  sessionId: string;
  /** Stable visitor handle; becomes anonymousId on every emitted event. */
  distinctId: string;
  /** Event-time clock; defaults to wall-clock at call. Each event advances by sampled dwell. */
  now?: Date;
  /**
   * Reproducible source-event-id prefix; the driver appends `_${seq}` per
   * emitted event so dedupe is keyed on the (siteId, source, sourceEventId)
   * triple. Defaults to sessionId so cross-run dedupe works for the same
   * (scenarioId + sessionIndex) seed.
   */
  sourceEventPrefix?: string;
}

export interface RunSessionResult {
  pagesVisited: number;
  eventsEmitted: number;
  finalPath: string;
}

const MAX_DWELL_MS = 60_000;
const MIN_DWELL_MS = 200;
const MAX_PAGES_HARD_CAP = 50;
const HESITATION_ACTIVE_SECONDS_MIN = 45;
const HESITATION_ACTIVE_SECONDS_MAX = 120;

function pickPath(
  persona: Persona,
  paths: string[],
  rng: Rng,
  currentPath?: string,
  transitionWeights?: Record<string, Array<{ path: string; weight: number }>>,
): string {
  if (paths.length === 0) return '/';
  // Use transition matrix when the current path has defined outbound weights.
  if (currentPath && transitionWeights?.[currentPath]) {
    const candidates = transitionWeights[currentPath].filter((t) => paths.includes(t.path));
    if (candidates.length > 0) {
      return weightedSample(candidates.map((t) => ({ item: t.path, weight: t.weight })), rng);
    }
  }
  // Fall back to persona-weighted uniform random over all paths.
  const weighted = paths.map((p) => ({
    item: p,
    weight: persona.preferredPaths.includes(p) ? 2 : 1,
  }));
  return weightedSample(weighted, rng);
}

function sampleDwell(persona: Persona, rng: Rng): number {
  const v = logNormal(
    persona.dwellMsPerPage.mean,
    persona.dwellMsPerPage.stddev,
    rng,
  );
  return Math.max(MIN_DWELL_MS, Math.min(MAX_DWELL_MS, Math.round(v)));
}

function sampleScroll(persona: Persona, rng: Rng): number {
  return Math.round(
    boundedNormal(
      persona.scrollDepthPct.mean,
      persona.scrollDepthPct.stddev,
      0,
      100,
      rng,
    ),
  );
}

function samplePagesCount(persona: Persona, rng: Rng): number {
  if (rng.next() < persona.bounceProbability) return 1;
  const v = logNormal(
    persona.pagesPerSession.mean,
    persona.pagesPerSession.stddev,
    rng,
  );
  return Math.max(1, Math.min(MAX_PAGES_HARD_CAP, Math.round(v)));
}

/** Pick a CTA from the snapshot weighted by visual weight. */
function pickSnapshotCta(ctas: readonly CtaCandidate[], rng: Rng): CtaCandidate | null {
  const eligible = ctas.filter((c) => !c.disabled && c.visualWeight > 0);
  if (eligible.length === 0) return null;
  return weightedSample(
    eligible.map((c) => ({ item: c, weight: c.visualWeight })),
    rng,
  );
}

function findRageCta(
  ctas: readonly CtaCandidate[],
  selector: string,
): CtaCandidate | null {
  // Strict match first (selector equality)
  const strict = ctas.find((c) => c.cssSelector === selector);
  if (strict) return strict;
  // data-testid loose match: "[data-testid=foo]" → find a CTA whose
  // cssSelector contains data-testid="foo" — handles selector-format drift.
  const m = selector.match(/data-testid=['"]?([\w-]+)['"]?/);
  if (m) {
    const id = m[1];
    return ctas.find((c) => c.cssSelector?.includes(`data-testid="${id}"`) || c.cssSelector?.includes(`data-testid='${id}'`) || c.cssSelector?.includes(`data-testid=${id}`)) ?? null;
  }
  return null;
}

export async function runSession(
  opts: RunSessionOpts,
): Promise<RunSessionResult> {
  const {
    persona,
    rng,
    siteId,
    paths,
    transitionWeights,
    exitHazard,
    pageSnapshotsByPath,
    primaryCta,
    rageCtaSelector,
    rageClickRate,
    hesitationPaths,
    lowScrollPaths,
    sink,
    sessionId,
    distinctId,
  } = opts;
  const prefix = opts.sourceEventPrefix ?? sessionId;
  const clock = new Date(opts.now ?? Date.now());

  const pagesCount = samplePagesCount(persona, rng);
  let path = pickPath(persona, paths, rng);
  let seq = 0;
  const advance = (ms: number): void => {
    clock.setTime(clock.getTime() + ms);
  };

  for (let i = 0; i < pagesCount; i++) {
    // Sample dwell + scroll up-front and attach to the page_view event
    // (matches the PostHog connector shape: scroll + duration ride on
    // $pageview, not a separate $autocapture-scroll event).
    const dwell = sampleDwell(persona, rng);
    const baseScroll = sampleScroll(persona, rng);
    const scrollPct = lowScrollPaths?.has(path)
      ? Math.max(0, Math.round(baseScroll * 0.5))
      : baseScroll;
    const metrics: Record<string, number> = {
      scrollPct,
      scrollPctNormalized: scrollPct / 100,
      dwellMs: dwell,
    };
    if (hesitationPaths?.has(path)) {
      metrics.activeSeconds = randInt(
        HESITATION_ACTIVE_SECONDS_MIN,
        HESITATION_ACTIVE_SECONDS_MAX,
        rng,
      );
    }

    await sink.emit({
      siteId,
      sessionId,
      type: 'page_view',
      path,
      anonymousId: distinctId,
      metrics,
      sourceEventId: `${prefix}_${seq++}`,
      occurredAt: clock.toISOString(),
    });

    advance(Math.round(dwell * 0.7));

    const snapshot = pageSnapshotsByPath?.get(path);

    // Maybe click a CTA. Snapshot-driven: visual-weight-weighted pick from
    // the current page's CTAs, so HTML determines which CTA wins clicks.
    if (rng.next() < persona.clickIntent) {
      advance(randInt(200, 1500, rng));
      const snapshotCta = snapshot ? pickSnapshotCta(snapshot.ctas, rng) : null;
      const properties = snapshotCta
        ? {
            cta_text: snapshotCta.text,
            element_tag: snapshotCta.tag,
            ...(snapshotCta.cssSelector ? { selector: snapshotCta.cssSelector } : {}),
          }
        : primaryCta
          ? {
              ctaId: primaryCta.ctaId,
              ...(primaryCta.selector ? { selector: primaryCta.selector } : {}),
            }
          : undefined;
      await sink.emit({
        siteId,
        sessionId,
        type: 'cta_click',
        path,
        anonymousId: distinctId,
        properties,
        sourceEventId: `${prefix}_${seq++}`,
        occurredAt: clock.toISOString(),
      });
    }

    // Maybe rage click — snapshot-resolved rage target + per-page rate.
    if (
      snapshot &&
      rageCtaSelector &&
      rageClickRate &&
      rng.next() < rageClickRate
    ) {
      const rageCta = findRageCta(snapshot.ctas, rageCtaSelector);
      if (rageCta) {
        await sink.emit({
          siteId,
          sessionId,
          type: 'rage_click',
          path,
          anonymousId: distinctId,
          properties: {
            rage_target_text: rageCta.text,
            element_tag: rageCta.tag,
            ...(rageCta.cssSelector ? { rage_target_ref: rageCta.cssSelector } : {}),
          },
          sourceEventId: `${prefix}_${seq++}`,
          occurredAt: clock.toISOString(),
        });
      }
    }

    // Maybe submit form
    if (rng.next() < persona.formSubmitIntent) {
      advance(randInt(400, 3500, rng));
      await sink.emit({
        siteId,
        sessionId,
        type: 'form_submit',
        path,
        anonymousId: distinctId,
        sourceEventId: `${prefix}_${seq++}`,
        occurredAt: clock.toISOString(),
      });
    }

    advance(Math.round(dwell * 0.3));

    // Per-path exit hazard: end the session early at this path if the roll hits.
    // Only fires when there are still planned pages remaining so single-page
    // bounce sessions (pagesCount=1) are unaffected.
    if (i < pagesCount - 1 && exitHazard?.[path] != null) {
      if (rng.next() < (exitHazard[path] as number)) break;
    }

    path = pickPath(persona, paths, rng, path, transitionWeights);
  }

  return {
    pagesVisited: pagesCount,
    eventsEmitted: seq,
    finalPath: path,
  };
}

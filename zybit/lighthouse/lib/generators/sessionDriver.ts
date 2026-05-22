/**
 * Persona-driven session simulator. Emits CanonicalEvent-shaped events
 * straight into an EventSink — no real browser, no DOM.
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
   * Selector or ctaId that "clicking the primary CTA" emits as a property
   * on cta_click events. Optional — null means clicks don't get a CTA tag.
   */
  primaryCta?: { ctaId: string; selector?: string };
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
    primaryCta,
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
    // 1) pageview
    await sink.emit({
      siteId,
      sessionId,
      type: 'page_view',
      path,
      anonymousId: distinctId,
      sourceEventId: `${prefix}_${seq++}`,
      occurredAt: clock.toISOString(),
    });

    // 2) scroll, after some dwell
    const dwell = sampleDwell(persona, rng);
    advance(Math.round(dwell * 0.7));
    const scrollPct = sampleScroll(persona, rng);
    await sink.emit({
      siteId,
      sessionId,
      type: 'scroll',
      path,
      anonymousId: distinctId,
      metrics: { scrollPct, dwellMs: dwell },
      sourceEventId: `${prefix}_${seq++}`,
      occurredAt: clock.toISOString(),
    });

    // 3) maybe click CTA
    if (rng.next() < persona.clickIntent) {
      advance(randInt(200, 1500, rng));
      await sink.emit({
        siteId,
        sessionId,
        type: 'cta_click',
        path,
        anonymousId: distinctId,
        properties: primaryCta
          ? {
              ctaId: primaryCta.ctaId,
              ...(primaryCta.selector ? { selector: primaryCta.selector } : {}),
            }
          : undefined,
        sourceEventId: `${prefix}_${seq++}`,
        occurredAt: clock.toISOString(),
      });
    }

    // 4) maybe submit form
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

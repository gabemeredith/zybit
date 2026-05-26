/**
 * Snapshot-grounded synthetic event generator for the URL-audit mode.
 *
 * The Zybit audit rules never fire on a snapshot alone — every design rule
 * joins page structure against behavioral events. To exercise the rule
 * machinery on a real site, this module emits a deterministic event layer
 * keyed to each page's ACTUAL parsed CTAs (real text, real visual weight,
 * real document order).
 *
 * The events are engineered, not observed — they carry no ground truth. What
 * they verify is "do the rules fire and format a finding correctly when
 * grounded in this real page's structure", which is the stated purpose of
 * URL-audit mode. Click pressure is weighted by document order ("users click
 * the topmost CTA"), so whether `hero-hierarchy-inversion` fires depends on
 * the real page — it fires only when the visually heaviest CTA is not the
 * topmost one. Scroll depth is drawn so a majority land below 40%, so
 * `above-fold-coverage` fires only when the page genuinely has a heavy
 * below-fold CTA. Nav clicks are spread uniformly so `nav-dispersion` fires
 * only when the page exposes ≥6 nav destinations.
 *
 * Determinism: every draw flows through a `seededRng` keyed on siteId+pathRef.
 *
 * NOT emitted: `rage_click`. Rage is a real-visitor signal — it cannot be
 * inferred from page structure without lying. The static counterpart for
 * the rage-click insight is `dead-click-target` (anchors with junk hrefs,
 * pseudo-buttons with no handler) which fires on the parsed snapshot
 * directly. See `src/lib/phase2/rules/deadClickTarget.ts`.
 *
 * NOT emitted today (would also require behavior data): form submit /
 * abandon, hesitation timing, return visits, help-search queries.
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';
import type { CtaCandidate, PageSnapshotData } from '@/lib/phase2/snapshots';
import { seededRng } from './rng';
import { randInt, weightedSample } from './distributions';

export interface GroundedPage {
  pathRef: string;
  data: PageSnapshotData;
}

export interface GenerateGroundedEventsOpts {
  siteId: string;
  pages: GroundedPage[];
  /** Epoch ms; events are stamped near this time so they land in-window. */
  baseTime: number;
}

const SESSIONS_PER_PAGE = 80;
const CONTENT_CLICK_PROB = 0.65;
const NAV_CLICK_PROB = 0.45;
const LOW_SCROLL_PROB = 0.6;
// `rage_click` is intentionally NOT in the synthetic event mix. The old
// 8% per-session probability fired `rage-click-target` on every audit run
// regardless of any real signal — the public audit then had to blocklist
// the rule and the rage findings still landed in `zybitFindings` for any
// downstream surface to leak. Rage-clicks are PostHog-grounded signal;
// the static counterpart is `dead-click-target` (anchors with junk hrefs,
// buttons that look interactive but aren't) which is detected directly
// from HTML, not fabricated from probability.
/** Landmarks treated as site navigation (feeds `nav-dispersion`). */
const NAV_LANDMARKS = new Set(['header', 'nav']);
/** Spread window for event timestamps (kept well inside the pipeline window). */
const TIME_SPREAD_MS = 200_000;

function sanitize(value: string): string {
  return (
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '_'
  );
}

function isNavCta(cta: CtaCandidate): boolean {
  return NAV_LANDMARKS.has(cta.landmark) && cta.text.trim().length > 0;
}

/**
 * Build a deterministic, page-grounded event layer. Returns canonical event
 * inputs ready to push straight into an `EventSink`.
 */
export function generateGroundedEvents(
  opts: GenerateGroundedEventsOpts,
): CanonicalEventInput[] {
  const { siteId, pages, baseTime } = opts;
  const events: CanonicalEventInput[] = [];
  let seq = 0;

  const stamp = (): string =>
    new Date(baseTime + ((seq * 137) % TIME_SPREAD_MS)).toISOString();

  for (const page of pages) {
    const { pathRef, data } = page;
    const rng = seededRng(`grounded|${siteId}|${pathRef}`);
    const pageSlug = sanitize(pathRef);

    const contentCtas = data.ctas.filter((c) => !c.disabled && !isNavCta(c));
    const navCtas = data.ctas.filter((c) => !c.disabled && isNavCta(c));

    // Topmost-CTA click pressure: weight ∝ 1/(documentIndex+1).
    const contentWeighted = contentCtas.map((cta) => ({
      item: cta,
      weight: 1 / (cta.documentIndex + 1),
    }));

    for (let i = 0; i < SESSIONS_PER_PAGE; i += 1) {
      const sessionId = `lh_ua_${pageSlug}_${i}`;
      const anonymousId = `lh_ua_v_${i}`;

      // 1) page_view carrying a scroll depth (feeds `above-fold-coverage`).
      const scroll =
        rng.next() < LOW_SCROLL_PROB
          ? 0.05 + rng.next() * 0.34 // below the 40% fold line
          : 0.4 + rng.next() * 0.55;
      events.push({
        siteId,
        sessionId,
        type: 'page_view',
        path: pathRef,
        anonymousId,
        metrics: { scrollPctNormalized: Math.round(scroll * 1000) / 1000 },
        sourceEventId: `ua_${pageSlug}_${i}_pv`,
        occurredAt: stamp(),
      });
      seq += 1;

      // 2) content CTA click — doc-order weighted (feeds `hero-hierarchy`).
      if (contentWeighted.length > 0 && rng.next() < CONTENT_CLICK_PROB) {
        const cta = weightedSample(contentWeighted, rng);
        events.push({
          siteId,
          sessionId,
          type: 'cta_click',
          path: pathRef,
          anonymousId,
          properties: { cta_text: cta.text, element_tag: cta.tag },
          sourceEventId: `ua_${pageSlug}_${i}_cc`,
          occurredAt: stamp(),
        });
        seq += 1;
      }

      // 3) nav CTA click — uniform across destinations (feeds `nav-dispersion`).
      if (navCtas.length > 0 && rng.next() < NAV_CLICK_PROB) {
        const cta = navCtas[randInt(0, navCtas.length - 1, rng)];
        events.push({
          siteId,
          sessionId,
          type: 'cta_click',
          path: pathRef,
          anonymousId,
          properties: {
            cta_text: cta.text,
            element_tag: cta.tag,
            element_role: 'nav',
          },
          sourceEventId: `ua_${pageSlug}_${i}_nav`,
          occurredAt: stamp(),
        });
        seq += 1;
      }

      // No synthetic `rage_click` emission — see top-of-file comment.
    }
  }

  return events;
}

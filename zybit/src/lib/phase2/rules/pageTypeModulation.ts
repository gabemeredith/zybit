/**
 * Per-rule, per-pageType modulation table — the single source of truth for
 * "a docs page should not get the same nav-dispersion threshold as a pricing
 * page" (handover §12.D).
 *
 * The vision pass (`captureVisualSignals`) writes `pageType` to
 * `snapshot.data.visualSignals.pageType`. Rules read it via
 * `pageTypeModulation(ruleId, pageType)` and use the returned shape to
 * either suppress the rule for the page entirely (`suppress: true`) or
 * scale their detection floor/cap (`floorMultiplier`, `capMultiplier`)
 * away from the base threshold the rule would otherwise apply.
 *
 * Design constraints:
 *   - Pure function. No I/O. Deterministic: same inputs, same output.
 *     A `pageType` the table does not know about returns the neutral
 *     `{ suppress: false, floorMultiplier: 1, capMultiplier: 1 }` shape
 *     so rules degrade gracefully when vision is unavailable or returns
 *     `'unknown'`.
 *   - Conservative defaults. `suppress` only fires where a finding would
 *     be *clearly* wrong on the page type (e.g. above-fold-coverage on a
 *     legal/ToS page that legitimately requires scrolling). Modulation
 *     multipliers stay inside [0.5, 1.5] so a rule cannot be turned into
 *     something it is not by table data.
 *   - Defense-in-depth: rules still apply their base thresholds when the
 *     `pageType` is `undefined` (vision pass didn't run) or `'unknown'`
 *     (vision pass ran but couldn't classify). The modulation only kicks
 *     in when the model has a confident classification.
 *
 * Tested by `__tests__/pageTypeModulation.test.ts`.
 */

import type { PageType } from '@/lib/phase2/snapshots/types';

export interface PageTypeModulation {
  /**
   * When true, the rule should emit nothing for this page. Used for page
   * types where the rule's premise does not apply (e.g. the
   * above-fold-coverage rule's premise — "primary CTA hidden below the
   * fold is bad" — does not apply to a blog post that has no primary CTA
   * by design).
   */
  suppress: boolean;
  /**
   * Multiplier applied to a rule's detection *floor* (the minimum signal
   * required to fire). Values < 1 loosen the rule (it fires on weaker
   * signal because the page type makes the issue more impactful — e.g.
   * pricing-page nav dispersion). Values > 1 tighten the rule (it
   * requires stronger signal because the page type makes the issue less
   * urgent). Bounded to [0.5, 1.5].
   */
  floorMultiplier: number;
  /**
   * Multiplier applied to a rule's detection *cap* (the maximum value a
   * signal can take and still fire — applies to rules like nav-dispersion
   * where a low Gini below the cap is what fires the rule). Values > 1
   * loosen the rule (a higher Gini still fires because the page type
   * makes the issue more impactful). Bounded to [0.5, 1.5].
   */
  capMultiplier: number;
  /**
   * Optional severity downgrade. Rules that would normally emit `warn`
   * can downshift to `info` on lower-priority page types (e.g. SEO rules
   * on legal pages). The rule reads this and applies it to the emitted
   * severity before returning.
   */
  severityDowngrade?: boolean;
}

const NEUTRAL: PageTypeModulation = {
  suppress: false,
  floorMultiplier: 1,
  capMultiplier: 1,
};

/**
 * The modulation table. Keyed by `ruleId`, then by `PageType`. Any
 * (rule, pageType) combination not present returns `NEUTRAL` — the rule's
 * base thresholds apply unchanged.
 *
 * Each entry carries a one-line rationale comment so the table is its own
 * docs. If you add a row, write the rationale.
 */
const MODULATION: Record<string, Partial<Record<PageType, PageTypeModulation>>> = {
  // Above-fold CTA coverage — "your primary CTA is hidden below the fold"
  // does not apply to pages whose primary purpose is reading (blog,
  // legal, docs, about). Suppress entirely on these — the rule's premise
  // is wrong, not just weak. Tighten on pricing/signup/checkout where the
  // CTA-above-fold expectation is strongest.
  'above-fold-coverage': {
    blog: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    legal: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    docs: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    about: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    support: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    pricing: { suppress: false, floorMultiplier: 0.7, capMultiplier: 1 },
    signup: { suppress: false, floorMultiplier: 0.7, capMultiplier: 1 },
    checkout: { suppress: false, floorMultiplier: 0.7, capMultiplier: 1 },
  },

  // Nav dispersion — a wide nav is fine on a docs site (the nav IS the
  // table of contents) and on legal/about pages (low-traffic, not a
  // conversion surface). Tighten on pricing/signup/checkout where every
  // extra nav item is an exit ramp.
  'nav-dispersion': {
    docs: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    legal: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    about: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    support: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    blog: { suppress: false, floorMultiplier: 1, capMultiplier: 1.2 },
    pricing: { suppress: false, floorMultiplier: 0.8, capMultiplier: 1.1 },
    signup: { suppress: false, floorMultiplier: 0.8, capMultiplier: 1.1 },
    checkout: { suppress: false, floorMultiplier: 0.7, capMultiplier: 1.2 },
  },

  // Generic link text — "Read more"/"Learn more" footers are universal on
  // legal pages (ToS / privacy / cookie policy lists). Suppress entirely
  // — the rule is correct but the finding is not actionable on a legal
  // surface. On docs sites the rule's bar should be higher (deep "see
  // also" linking is part of the IA).
  'link-text-generic': {
    legal: { suppress: true, floorMultiplier: 1, capMultiplier: 1 },
    docs: { suppress: false, floorMultiplier: 1.3, capMultiplier: 1 },
  },

  // Heading hierarchy — docs sites legitimately ship H1→H3 jumps when
  // their renderer groups sections under a parent. Loosen the rule
  // there. On legal/about, the rule still applies but downgrades from
  // warn → info severity (low-priority surface).
  'heading-hierarchy-jump': {
    docs: { suppress: false, floorMultiplier: 1.4, capMultiplier: 1 },
    legal: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    about: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
  },

  // SEO rules on legal/about pages are low-priority — the page itself is
  // not a ranking target. Keep the rule firing (for completeness) but
  // downshift severity.
  'missing-meta-description': {
    legal: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    about: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    checkout: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    signup: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
  },
  'missing-canonical-url': {
    legal: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    about: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    checkout: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
    signup: { suppress: false, floorMultiplier: 1, capMultiplier: 1, severityDowngrade: true },
  },
};

const FLOOR_BOUNDS: readonly [number, number] = [0.5, 1.5];

function clampMultiplier(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  if (raw < FLOOR_BOUNDS[0]) return FLOOR_BOUNDS[0];
  if (raw > FLOOR_BOUNDS[1]) return FLOOR_BOUNDS[1];
  return raw;
}

/**
 * Look up the modulation for a (rule, pageType) pair. Returns `NEUTRAL`
 * when:
 *   - `pageType` is undefined (vision pass did not run for this snapshot).
 *   - `pageType` is `'unknown'` (vision pass ran but the model could not
 *     classify confidently — fail-open: don't modulate on a guess).
 *   - the rule has no modulation table entry for this page type.
 *
 * Bounds the returned multipliers to [0.5, 1.5] defensively so a table
 * misedit cannot turn a rule into something its base implementation does
 * not expect.
 */
export function pageTypeModulation(
  ruleId: string,
  pageType: PageType | undefined,
): PageTypeModulation {
  if (!pageType || pageType === 'unknown') return NEUTRAL;
  const ruleEntry = MODULATION[ruleId];
  if (!ruleEntry) return NEUTRAL;
  const cell = ruleEntry[pageType];
  if (!cell) return NEUTRAL;
  return {
    suppress: cell.suppress,
    floorMultiplier: clampMultiplier(cell.floorMultiplier),
    capMultiplier: clampMultiplier(cell.capMultiplier),
    ...(cell.severityDowngrade ? { severityDowngrade: true } : {}),
  };
}

/**
 * Convenience: returns just the `pageType` from a snapshot's visualSignals,
 * or `undefined` when the vision pass didn't run. Many rules just want this
 * one field and don't need to drill through the full `visualSignals` shape.
 */
export function pageTypeFromSnapshot(
  visualSignals: { pageType?: PageType } | undefined | null,
): PageType | undefined {
  if (!visualSignals) return undefined;
  return visualSignals.pageType;
}

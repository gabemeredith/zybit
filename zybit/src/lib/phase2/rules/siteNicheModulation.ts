/**
 * Per-rule, per-SiteNiche modulation table — the site-level companion to
 * `pageTypeModulation.ts`.
 *
 * pageTypeModulation answers "does this rule make sense on a pricing page
 * vs. a legal page?" (page-level context).
 *
 * siteNicheModulation answers "does this rule make sense for a devtools
 * product vs. a student fraternity?" (site-level context). Both dimensions
 * are read independently — a rule can be suppressed by page type, by site
 * niche, or by both. If either suppresses, the finding is dropped.
 *
 * Design constraints:
 *   - Pure function. No I/O. Deterministic.
 *   - Conservative. `suppress` only for cases where the finding would
 *     actively mislead the site owner, not just be less relevant.
 *   - Rules that are niche-invariant (heading-hierarchy-jump, image-alt)
 *     are omitted — the NEUTRAL default applies automatically.
 *   - Rationale comment required for every suppress: true entry.
 *
 * Tested by `__tests__/siteNicheModulation.test.ts`.
 */

import type { SiteNiche } from '@/lib/phase2/classification/siteClassifier';

// Note: the `education` niche is treated similarly to `community` throughout
// this table — both are non-commercial, so conversion-specific rules that
// fire on missing pricing-page proof or hero CTAs are suppressed.

export interface SiteNicheModulation {
  /**
   * When true the rule should emit nothing for this site niche. Same
   * semantics as PageTypeModulation.suppress.
   */
  suppress: boolean;
  /**
   * Downgrade severity from `warn` → `info` without suppressing entirely.
   * Used when the finding is still real but less urgent in this context.
   */
  severityDowngrade?: boolean;
}

const NEUTRAL: SiteNicheModulation = { suppress: false };

const MODULATION: Record<string, Partial<Record<SiteNiche, SiteNicheModulation>>> = {
  // Above-fold CTA coverage — community sites (clubs, nonprofits, student orgs)
  // are information portals, not conversion surfaces. "Your primary CTA is
  // hidden below the fold" is the wrong critique for an org whose home page
  // is a welcome message + meeting schedule. Suppress entirely.
  'above-fold-coverage': {
    community:  { suppress: true },
    education:  { suppress: true }, // info architecture over conversion; scroll is expected
    media:      { suppress: true }, // content-first; scroll is expected
  },

  // Hero hierarchy inversion — a community site's hero that leads with an
  // event photo rather than a CTA is not an inversion, it's appropriate
  // IA for its audience. A devtools product hero that leads with a code
  // snippet is common convention (terminal-first). Downgrade rather than
  // suppress so the finding surfaces at `info` for human review.
  'hero-hierarchy-inversion': {
    community:  { suppress: false, severityDowngrade: true },
    education:  { suppress: false, severityDowngrade: true }, // info-dense hero is standard for .edu
    devtools:   { suppress: false, severityDowngrade: true },
  },

  // Vague claim detected — Layer F fires when the hero is not specific
  // enough about outcomes. Community sites routinely use mission/values
  // language ("Together we serve") that reads as vague copy by the
  // specificity model but is the right register for a nonprofit. Suppress.
  // DevTools sites also often use terse technical headlines ("The fastest
  // way to build APIs") that the critique model under-scores for lack of
  // a concrete number — severity downgrade instead of suppress.
  'vague-claim-detected': {
    community:  { suppress: true },
    education:  { suppress: true },  // mission/values language ("shaping tomorrow's leaders") is expected
    devtools:   { suppress: false, severityDowngrade: true },
    media:      { suppress: true },  // editorial voice ≠ sales copy
    local:      { suppress: false, severityDowngrade: true },
  },

  // Proof missing — "there are no testimonials, logos, or metrics in the
  // hero" is an unfair finding for a student org homepage or a local
  // restaurant. The social proof playbook is entirely different there.
  // Suppress for community and local niches.
  'proof-missing': {
    community:  { suppress: true },
    education:  { suppress: true }, // accreditation/rankings prove credibility differently
    local:      { suppress: true },
    media:      { suppress: true }, // publishers prove credibility via bylines/dates
  },

  // CTA verb mismatch — highly conversion-specific rule. Not relevant for
  // non-commercial niches whose CTAs are "Join us" / "Volunteer" / "Donate".
  'cta-verb-mismatch': {
    community:  { suppress: true },
    education:  { suppress: true }, // "Apply Now", "Enroll Today" follow education conventions
    media:      { suppress: true },
  },

  // Nav item count — e-commerce mega-menus legitimately list dozens of
  // category links (Women > Tops > T-Shirts). DevTools sites need multi-section
  // nav for docs, API reference, changelog. Pre-wired for when the rule is
  // built; currently a no-op but safe to leave in the table.
  //
  // 'nav-item-count': {
  //   ecommerce: { suppress: true },
  //   devtools:  { suppress: false, severityDowngrade: true },
  // },
};

/**
 * Look up the modulation for a (rule, siteNiche) pair. Returns NEUTRAL when:
 *   - `siteNiche` is `undefined` or `'unknown'` (classifier didn't fire).
 *   - The rule has no niche modulation entry.
 */
export function siteNicheModulation(
  ruleId: string,
  siteNiche: SiteNiche | undefined,
): SiteNicheModulation {
  if (!siteNiche || siteNiche === 'unknown') return NEUTRAL;
  const ruleEntry = MODULATION[ruleId];
  if (!ruleEntry) return NEUTRAL;
  const cell = ruleEntry[siteNiche];
  if (!cell) return NEUTRAL;
  return cell;
}

/**
 * Rule: nav-dispersion
 *
 * Site-wide check on navigation IA. Aggregate every `cta_click` event
 * whose `element_role === 'nav'`, group by destination label, and
 * compute the Gini coefficient over the click counts. A focused IA
 * shows clear preference; a uniform distribution across many entries
 * means the navigation isn't telling visitors where to start.
 */

import {
  clamp,
  evidenceFromFinding,
  formatCount,
  gini,
  pct,
  quote,
  readStringProp,
  round,
  share,
} from "./helpers";
import { calibratedCap } from "./ruleCalibration";
import { pageTypeFromSnapshot, pageTypeModulation } from "./pageTypeModulation";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
} from "./types";

const MIN_NAV_CLICKS = 50;
const MIN_DISTINCT_DESTS = 6;
const MAX_GINI_FOR_FINDING = 0.3;

export const navDispersion: AuditRule = {
  id: "nav-dispersion",
  name: "Navigation dispersion",
  category: "nav",
  publicAuditBehavior: 'structural-only',

  // Public-audit rewrite: nav-dispersion derives its core signal from real
  // nav-link click distribution (Gini over click counts). In public mode
  // those clicks are synthetic. The structural framing — "your nav exposes
  // a lot of destinations" — still applies because nav-item count is parsed
  // from real HTML; the click-distribution claim is dropped.
  structuralPublicAuditCopy(finding) {
    const page = evidenceFromFinding(finding, 'Page') ?? finding.pathRef ?? 'your homepage';
    return {
      title: `Your top nav on ${page} exposes a lot of destinations`,
      summary:
        `A wide nav forces every visitor to choose. The more options at the top, the more cognitive ` +
        `load before the visitor can do the thing they came for. The best-converting marketing sites ` +
        `keep top-level nav to 4-5 items.`,
      whyItMatters:
        `A wide nav forces every visitor to choose. The more options at the top, the more cognitive ` +
        `load before the visitor can do the thing they came for. The best-converting marketing sites ` +
        `keep top-level nav to 4-5 items.`,
      evidence: [
        { label: 'Page', value: page },
        {
          label: 'Based on',
          value: 'page structure (nav-item count parsed from your HTML — connect PostHog to see which destinations actually win clicks)',
        },
      ],
    };
  },

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const counts = new Map<string, number>();
    let navClicks = 0;

    for (const event of ctx.events) {
      if (event.type !== "cta_click") continue;
      if (readStringProp(event.properties, "element_role") !== "nav") continue;
      const dest = readStringProp(event.properties, "cta_text");
      if (dest === null) continue;
      counts.set(dest, (counts.get(dest) ?? 0) + 1);
      navClicks += 1;
    }

    if (navClicks < MIN_NAV_CLICKS) return [];
    const distinctDests = counts.size;
    if (distinctDests < MIN_DISTINCT_DESTS) return [];

    // PageType modulation — nav-dispersion is site-wide so we read pageType
    // from the homepage (or the first available snapshot). On docs / legal /
    // about / support the rule's premise — "a focused IA tells visitors
    // where to start" — does not apply, so we suppress. On pricing / signup /
    // checkout we tighten the cap (capMultiplier > 1) because every extra
    // nav item on a conversion surface is a real exit ramp.
    const homepageSnapshot =
      ctx.pageSnapshotsByPath.get('/') ?? ctx.pageSnapshots[0] ?? null;
    const pageType = pageTypeFromSnapshot(homepageSnapshot?.data?.visualSignals);
    const modulation = pageTypeModulation('nav-dispersion', pageType);
    if (modulation.suppress) return [];

    const countVector = [...counts.values()];
    const giniValue = gini(countVector);
    // Gini is bounded by [0, 1] — clamp the modulated cap below the
    // theoretical maximum (0.95) so a capMultiplier > 1 on a conversion
    // surface cannot push the cap to or beyond Gini's ceiling (which
    // would silently fire the rule on a perfectly focused nav).
    const baseCap = calibratedCap(ctx, "nav-dispersion", MAX_GINI_FOR_FINDING);
    const modulatedCap = Math.min(0.95, baseCap * modulation.capMultiplier);
    if (giniValue >= modulatedCap) return [];

    const ordered = [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    const [topDestText, topDestCount] = ordered[0];
    const topShare = share(topDestCount, navClicks) ?? 0;

    const demoteCount = Math.max(0, distinctDests - 4);

    const summary =
      `${formatCount(navClicks)} nav clicks across ${distinctDests} destinations with Gini ` +
      `${round(giniValue, 3)} — clicks are spread almost uniformly. Visitors aren't being told ` +
      `where to start.`;

    const recommendation: string[] = [
      `Demote ${demoteCount} of the ${distinctDests} top-level entries into a secondary menu and ` +
        `keep only the four destinations that drive the most subsequent activity. Uniform click ` +
        `distribution in a primary nav means the IA isn't doing its job.`,
      `Look at the bottom-share destinations specifically — they are likely earning entry-level ` +
        `prominence they don't need. Move them to footer or a more contextual surface.`,
    ];

    const evidence: AuditFindingEvidence[] = [
      { label: "Nav clicks", value: navClicks },
      { label: "Distinct destinations", value: distinctDests },
      {
        label: "Gini coefficient",
        value: round(giniValue, 3),
        context: "lower = more uniform",
      },
      {
        label: "Top destination share",
        value: `${pct(topShare)}%`,
        context: topDestText,
      },
    ];

    const topFour = ordered.slice(0, 4).map((e) => quote(e[0])).join(', ');
    const bottomDestinations = ordered.slice(4).map((e) => quote(e[0])).join(', ');

    const prescription = {
      whatToChange:
        `Reduce the top-level navigation to 4 entries: ${topFour}. ` +
        `Move ${demoteCount > 0 ? `${bottomDestinations || 'the remaining items'}` : 'lower-traffic items'} to a secondary dropdown, footer, or contextual surface.`,
      whyItWorks:
        `Navigation with Gini ${round(giniValue, 3)} means clicks are spread almost uniformly across ${distinctDests} items — ` +
        `visitors have no clear signal about where to start. Reducing to 4 items creates visual hierarchy and guides intent.`,
      experimentVariantDescription:
        `Variant B: navigation collapsed to 4 primary items; others moved to secondary dropdown. ` +
        `Primary metric: navigation engagement rate and funnel entry rate.`,
    };

    return [
      {
        id: "nav-dispersion",
        ruleId: "nav-dispersion",
        category: "nav",
        severity: giniValue < 0.2 ? "warn" : "info",
        confidence: clamp(0.4 + Math.log10(Math.max(navClicks, 1)) * 0.2, 0, 0.95),
        priorityScore: clamp(1 - giniValue, 0, 1),
        pathRef: null,
        title: "Top-level navigation is unfocused",
        summary,
        prescription,
        recommendation,
        evidence,
      },
    ];
  },
};

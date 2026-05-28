/**
 * Rule: vague-claim-detected (Layer F — AI copy critique)
 *
 * Fires when the structured copy critique scored the page's hero claim
 * below the specificity threshold (default 0.4). The threshold is set
 * such that a hero that doesn't tell visitors what the product *does*
 * earns a finding — "Empower your team" / "Reimagine your workflow" /
 * "Welcome to the future of X." A specific outcome with a number ("Cut
 * SOC2 audits from 80 hours to 6 hours") will score well above.
 *
 * The LLM call lives in `captureCopyCritique` at capture time — the
 * rule itself is a pure deterministic function over the cached output,
 * same trust model as the existing AI Variant Advisor (validator-gated
 * LLM output consumed by deterministic logic).
 *
 * `publicAuditBehavior: 'as-is'` — the rule's input is a critique of the
 * customer's own hero copy, which is honest in both modes. The finding
 * is structural in nature (it points at copy already on the page), not
 * behavioral, so no rewrite is needed.
 *
 * Suppressed for `pageType: 'docs'` / `'legal'` / `'support'` — those
 * pages are not vending the product and don't need a punchy claim.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import { siteNicheModulation } from './siteNicheModulation';

const SPECIFICITY_THRESHOLD = 0.4;

const SUPPRESSED_PAGE_TYPES = new Set(['docs', 'legal', 'support', 'unknown']);

export const vagueClaimDetected: AuditRule = {
  id: 'vague-claim-detected',
  name: 'Vague hero claim',
  category: 'mismatch',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    // Site-level suppression: community/education/media niches use
    // mission/values language that reads as vague copy by the specificity
    // model but is the correct register for their audience.
    if (siteNicheModulation('vague-claim-detected', ctx.siteNiche).suppress) {
      return findings;
    }
    const nicheDowngrade = siteNicheModulation('vague-claim-detected', ctx.siteNiche).severityDowngrade;

    for (const snapshot of ctx.pageSnapshots) {
      const critique = snapshot.data.copyCritique;
      if (!critique) continue;

      const pageType = snapshot.data.visualSignals?.pageType ?? 'unknown';
      if (SUPPRESSED_PAGE_TYPES.has(pageType)) continue;

      if (critique.specificity >= SPECIFICITY_THRESHOLD) continue;

      const heroBlock = snapshot.data.visualSignals?.heroBlock;
      const headline = heroBlock?.headline ?? '(no headline detected)';

      const vagueTermsList = critique.vagueTerms.slice(0, 3);
      const rewrites = critique.suggestedRewrites.slice(0, 3);

      const evidence: AuditFindingEvidence[] = [
        {
          label: 'Headline',
          value: headline.length > 200 ? headline.slice(0, 197) + '…' : headline,
        },
        {
          label: 'Specificity score',
          value: `${Math.round(critique.specificity * 100)} / 100`,
          context: `Below the 40 / 100 floor — visitors cannot tell what your product does from this copy alone.`,
        },
      ];

      if (vagueTermsList.length > 0) {
        evidence.push({
          label: 'Vague phrases',
          value: vagueTermsList.map((t) => `"${t}"`).join(', '),
        });
      }

      if (rewrites.length > 0) {
        evidence.push({
          label: 'Possible rewrites',
          value: rewrites.map((r) => `"${r}"`).join(' · '),
          context: 'Suggested by the structural reviewer, in the same register as your existing copy. Use as a starting point, not a final variant.',
        });
      }

      // `mismatch` rules already use this category for landing-promise issues.
      // Vague claim is a stronger version of the same: the page's promise is
      // not just unclear, it's empty.
      findings.push({
        id: `vague-claim-detected:${snapshot.pathRef}`,
        ruleId: 'vague-claim-detected',
        category: 'mismatch',
        // Severity bands:
        //   <= 0.2 → 'warn' (very vague: "Empower your team" / "Reimagine your workflow")
        //    0.2..0.4 → 'info' (mildly vague — fires but not loud)
        severity: nicheDowngrade ? 'info' : critique.specificity <= 0.2 ? 'warn' : 'info',
        confidence: 0.75,
        priorityScore: 0.55,
        pathRef: snapshot.pathRef,
        title: `The hero on ${snapshot.pathRef} doesn't tell visitors what you do`,
        summary:
          `The headline on ${snapshot.pathRef} scored ${Math.round(critique.specificity * 100)} / 100 ` +
          `for specificity. Hero copy is the first 2 seconds of a visitor's relationship with your ` +
          `product — vague language costs you visitors who can't tell whether what you sell is ` +
          `relevant to them before they bounce.`,
        recommendation: [
          `Rewrite the headline to name a specific outcome you deliver. Replace abstract verbs ` +
            `("empower", "transform", "reimagine") with the concrete change a customer experiences ` +
            `after using your product.`,
          rewrites.length > 0
            ? `Three concrete starting points from the reviewer: ${rewrites.map((r) => `"${r}"`).join('; ')}. ` +
              `Pick the one closest to your strongest customer story and test against the current control.`
            : `Look at your top three customer quotes — the headline should sound like the outcome the ` +
              `best of them describes, not like a category brochure.`,
        ],
        prescription: {
          whyItMatters:
            `Visitors decide in seconds whether ${snapshot.pathRef} is for them; a hero that doesn't ` +
            `name what your product does makes every visitor do the diligence themselves — most won't.`,
          whatToChange:
            `Replace "${headline}" with a headline that names the specific outcome ${rewrites[0] ? `(e.g. "${rewrites[0]}")` : ''} — ` +
            `a verb that describes what the product does, plus the named benefit a customer would talk about.`,
          whyItWorks:
            `Specific claims are testable claims. A specific headline lets visitors self-qualify in two ` +
            `seconds; a vague headline forces them to keep reading to figure out whether you're relevant. ` +
            `Most don't.`,
          experimentVariantDescription:
            `Variant B replaces the existing headline with a specific-outcome rewrite ` +
            `${rewrites[0] ? `(starting with "${rewrites[0]}")` : ''}. ` +
            `Primary metric: hero-section CTA click rate on ${snapshot.pathRef}.`,
        },
        evidence,
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

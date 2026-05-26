/**
 * Rule: missing-meta-description
 *
 * Fires when a page has no <meta name="description"> or the description is
 * shorter than 50 characters. The description is displayed in search results
 * and social previews — its absence reduces click-through and means platforms
 * generate unpredictable snippets from body copy.
 *
 * Pure snapshot rule: no behavioral events required.
 */

import type { AuditFinding, AuditRule, AuditRuleContext } from './types';
import { pageTypeFromSnapshot, pageTypeModulation } from './pageTypeModulation';

const MIN_DESCRIPTION_LENGTH = 50;

export const missingMetaDescription: AuditRule = {
  id: 'missing-meta-description',
  category: 'seo',
  name: 'Missing meta description',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const pageType = pageTypeFromSnapshot(snapshot.data.visualSignals);
      const modulation = pageTypeModulation('missing-meta-description', pageType);
      if (modulation.suppress) continue;

      const desc = snapshot.data.meta.description;
      const isMissing = !desc || desc.trim().length === 0;
      const isTooShort = !isMissing && desc!.trim().length < MIN_DESCRIPTION_LENGTH;

      if (!isMissing && !isTooShort) continue;

      const id = `missing-meta-description:${snapshot.pathRef}`;
      const evidence = isMissing
        ? [{ label: 'Meta description', value: 'absent' }]
        : [{ label: 'Meta description length', value: `${desc!.trim().length} chars (minimum ${MIN_DESCRIPTION_LENGTH})`, context: desc!.trim() }];

      findings.push({
        id,
        ruleId: 'missing-meta-description',
        category: 'seo',
        // Severity downgrade on low-priority page types (legal/about/checkout/signup):
        // the rule still emits for completeness but doesn't pull rank in the
        // top-4. SEO findings on these pages are real but the impact is small.
        severity: modulation.severityDowngrade ? 'info' : 'warn',
        confidence: 0.95,
        priorityScore: modulation.severityDowngrade ? 0.25 : 0.45,
        pathRef: snapshot.pathRef,
        title: isMissing
          ? `No meta description on ${snapshot.pathRef}`
          : `Meta description too short on ${snapshot.pathRef}`,
        summary: isMissing
          ? `${snapshot.pathRef} has no <meta name="description">. Search engines will generate a snippet from arbitrary body copy, which typically underperforms a curated description by 5–30% CTR.`
          : `The meta description on ${snapshot.pathRef} is only ${desc!.trim().length} characters. Most search engines truncate at 155–160 characters; descriptions under 50 characters rarely communicate enough to earn a click.`,
        recommendation: [
          isMissing
            ? `Add a <meta name="description"> tag to ${snapshot.pathRef} that summarises the page value in 120–155 characters.`
            : `Expand the meta description on ${snapshot.pathRef} to 120–155 characters. Include the primary keyword and a clear benefit or CTA.`,
        ],
        evidence,
        prescription: {
          whatToChange: `Add or expand the <meta name="description"> in the page <head>.`,
          whyItWorks: `Search engines use the description as the default snippet in results pages. A well-written description improves click-through by making the result relevant and compelling before the user even visits the page.`,
          experimentVariantDescription: `Variant adds a 140-character meta description including the primary value proposition. Measure organic CTR in Google Search Console over 30 days.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

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
import { displayPath } from './helpers';

// Below 40 characters a description rarely communicates enough to earn a
// click. The old 50-char floor triggered on descriptions that were
// marginally short (49 chars) with no real SEO impact — pedantic for
// a prospect-facing audit report.
const MIN_DESCRIPTION_LENGTH = 40;

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
        ? [{ label: 'Search summary', value: 'missing' }]
        : [{ label: 'Search summary length', value: `${desc!.trim().length} characters (aim for at least ${MIN_DESCRIPTION_LENGTH})`, context: desc!.trim() }];

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
          ? `Google has no summary to show for ${displayPath(snapshot.pathRef)}`
          : `Your search summary for ${displayPath(snapshot.pathRef)} is too short`,
        summary: isMissing
          ? `${snapshot.pathRef} has no <meta name="description">. Search engines will generate a snippet from arbitrary body copy, which typically underperforms a curated description by 5–30% CTR.`
          : `The meta description on ${snapshot.pathRef} is only ${desc!.trim().length} characters. Most search engines truncate at 155–160 characters; descriptions under 40 characters rarely communicate enough to earn a click.`,
        recommendation: [
          isMissing
            ? `Add a <meta name="description"> tag to ${snapshot.pathRef} that summarises the page value in 120–155 characters.`
            : `Expand the meta description on ${snapshot.pathRef} to 120–155 characters. Include the primary keyword and a clear benefit or CTA.`,
        ],
        evidence,
        prescription: {
          whyItMatters: `This is the sentence that shows up under your page's title in Google search results — it's what convinces someone to click. Without it, Google grabs a random scrap of text from your page (often a menu label or a footer line) and shows that instead, so fewer people click through.`,
          whatToChange: `Add a short page summary so search engines show your own words instead of a random scrap. In your page's code this is a <meta name="description"> tag in the <head> — 120–155 characters describing the page.`,
          whyItWorks: `Search engines use the description as the default snippet in results pages. A well-written description improves click-through by making the result relevant and compelling before the user even visits the page.`,
          experimentVariantDescription: `Variant adds a 140-character meta description including the primary value proposition. Measure organic CTR in Google Search Console over 30 days.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

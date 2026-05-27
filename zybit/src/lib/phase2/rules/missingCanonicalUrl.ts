/**
 * Rule: missing-canonical-url
 *
 * Fires when a page has no <link rel="canonical"> tag. Without a canonical,
 * search engines choose their own preferred URL, which can dilute PageRank
 * across URL variants (www vs non-www, query params, trailing slashes).
 *
 * Lower severity than missingMetaDescription — many sites survive without
 * canonicals. Most useful as a heads-up on landing pages and product pages
 * where paid traffic may introduce UTM variants.
 *
 * Pure snapshot rule: no behavioral events required.
 */

import type { AuditFinding, AuditRule, AuditRuleContext } from './types';
import { pageTypeFromSnapshot, pageTypeModulation } from './pageTypeModulation';

export const missingCanonicalUrl: AuditRule = {
  id: 'missing-canonical-url',
  category: 'seo',
  name: 'Missing canonical URL',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const canonical = snapshot.data.meta.canonical;
      if (canonical && canonical.trim().length > 0) continue;

      const pageType = pageTypeFromSnapshot(snapshot.data.visualSignals);
      const modulation = pageTypeModulation('missing-canonical-url', pageType);
      if (modulation.suppress) continue;

      findings.push({
        id: `missing-canonical-url:${snapshot.pathRef}`,
        ruleId: 'missing-canonical-url',
        category: 'seo',
        // Base severity for this rule is already 'info' — the downgrade
        // path drops priorityScore so low-priority surfaces still emit
        // but slip further down the ranking.
        severity: 'info',
        confidence: 0.9,
        priorityScore: modulation.severityDowngrade ? 0.15 : 0.25,
        pathRef: snapshot.pathRef,
        title: `No canonical URL on ${snapshot.pathRef}`,
        summary: `${snapshot.pathRef} has no <link rel="canonical"> tag. When the same content is accessible via multiple URLs (www vs apex, UTM params, trailing slashes), search engines consolidate ranking signals at whichever URL they choose — not necessarily your preferred one.`,
        recommendation: [
          `Add <link rel="canonical" href="https://yourdomain.com${snapshot.pathRef}"> inside the <head> of ${snapshot.pathRef}.`,
          `This is especially important for landing pages that receive paid traffic with UTM parameters, where the same content is indexed under dozens of URL variants.`,
        ],
        evidence: [
          { label: 'Canonical tag', value: 'absent' },
          { label: 'Page path', value: snapshot.pathRef },
        ],
        prescription: {
          whyItMatters: `Without a canonical tag, every UTM parameter, locale variant, and www-vs-apex URL gets treated as a separate page by search engines — splitting the ranking signal across copies of the same content. The page that should be ranking gets out-competed by its own duplicates, and the inbound links you earned scatter across URLs that don't accumulate authority.`,
          whatToChange: `Add a canonical link tag to the <head> pointing to the preferred URL for this page.`,
          whyItWorks: `Canonical tags consolidate link equity and prevent duplicate-content dilution. Without one, any inbound links to UTM variants or www/apex variants are treated as separate pages.`,
          experimentVariantDescription: `Technical change only — add the canonical tag and monitor Google Search Console for consolidation of impressions to the canonical URL within 2–4 weeks.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

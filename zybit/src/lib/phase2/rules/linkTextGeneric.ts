/**
 * Rule: link-text-generic
 *
 * Fires when a meaningful share of the page's links use generic text like
 * "click here", "read more", "learn more", "here", "this", or "more".
 * Generic link text fails WCAG 2.4.4 (Link Purpose) and undermines SEO
 * because search engines use link text as a signal for destination relevance.
 *
 * Uses the existing CTA inventory which covers all <a> and <button> elements.
 *
 * Pure snapshot rule: no behavioral events required.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import type { CtaCandidate } from '../snapshots/types';

// Always-generic anchor text — fires on any occurrence. These phrases are
// context-free and never describe a destination, so a single instance is
// already a WCAG 2.4.4 violation.
//
// Note: vague-but-acceptable CTAs like "Get started", "Sign up", "Try now"
// are intentionally NOT in this list — they're fine as a single primary CTA.
// They get caught by the high-frequency path below when they're repeated 3+
// times on the same page (which is when screen-reader users actually lose
// destination context).
const ALWAYS_GENERIC_PATTERNS = [
  /^click here$/i,
  /^read more$/i,
  /^learn more$/i,
  /^more$/i,
  /^here$/i,
  /^this$/i,
  /^details$/i,
  /^see more$/i,
  /^view more$/i,
  /^find out more$/i,
];

const HIGH_FREQUENCY_THRESHOLD = 3;

function isAlwaysGeneric(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return ALWAYS_GENERIC_PATTERNS.some((p) => p.test(trimmed));
}

export const linkTextGeneric: AuditRule = {
  id: 'link-text-generic',
  category: 'accessibility',
  name: 'Generic link text',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const links = snapshot.data.ctas.filter((c) => c.tag === 'a');
      if (links.length === 0) continue;

      const genericLinks = links.filter((c) => isAlwaysGeneric(c.text));

      // Frequency-only patterns ("Get started") and any other repeated
      // identical non-generic text fire once the same wording appears on
      // 3+ links. A single primary "Get started" CTA is fine; six of them
      // on the same page is not.
      const textFrequency = new Map<string, CtaCandidate[]>();
      for (const link of links) {
        const key = link.text.trim().toLowerCase();
        const bucket = textFrequency.get(key) ?? [];
        bucket.push(link);
        textFrequency.set(key, bucket);
      }
      const highFrequency = [...textFrequency.values()].filter(
        (group) =>
          group.length >= HIGH_FREQUENCY_THRESHOLD && !isAlwaysGeneric(group[0].text),
      );

      if (genericLinks.length === 0 && highFrequency.length === 0) continue;

      const evidence: AuditFindingEvidence[] = [];

      if (genericLinks.length > 0) {
        evidence.push({
          label: 'Generic link texts',
          value: genericLinks.length,
          context: [...new Set(genericLinks.map((c) => `"${c.text.trim()}"`))]
            .slice(0, 5)
            .join(', '),
        });
      }

      for (const group of highFrequency.slice(0, 2)) {
        evidence.push({
          label: `Repeated link text "${group[0].text.trim()}"`,
          value: group.length,
          context: `appears ${group.length}× — screen reader users hear the same announcement each time`,
        });
      }

      evidence.push({ label: 'Total links on page', value: links.length });

      const totalFlagged = genericLinks.length + highFrequency.reduce((s, g) => s + g.length, 0);
      const rate = totalFlagged / Math.max(links.length, 1);
      const severity = rate >= 0.3 ? 'warn' : 'info';

      findings.push({
        id: `link-text-generic:${snapshot.pathRef}`,
        ruleId: 'link-text-generic',
        category: 'accessibility',
        severity,
        confidence: 0.88,
        priorityScore: 0.35,
        pathRef: snapshot.pathRef,
        title: `Generic link text on ${snapshot.pathRef} (${totalFlagged} instance${totalFlagged > 1 ? 's' : ''})`,
        summary: `${snapshot.pathRef} has ${totalFlagged} link${totalFlagged > 1 ? 's' : ''} with generic text. Screen reader users navigating by links hear a list of "click here", "read more", and "learn more" with no context about the destination. Search engines similarly lose link-destination signals when anchor text is uninformative.`,
        recommendation: [
          `Replace generic link text with descriptive text that identifies the destination: "Read the pricing guide" instead of "Read more", "Get started with the free plan" instead of "Get started".`,
          `Where space is constrained, use aria-label to provide a longer accessible name: <a href="..." aria-label="Read the pricing guide">Read more</a>.`,
        ],
        evidence,
        prescription: {
          whatToChange: `Update anchor text to describe the link destination. Each link should make sense out of context.`,
          whyItWorks: `Descriptive link text improves keyboard and screen reader navigation. It also acts as anchor text for search engines, improving the destination page's relevance signals for the topic named in the link.`,
          experimentVariantDescription: `Variant replaces generic CTAs with destination-specific text. Measure click-through rate on flagged links and organic ranking of destination pages.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

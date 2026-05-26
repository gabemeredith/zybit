/**
 * Rule: heading-hierarchy-jump
 *
 * Fires when a page skips heading levels (e.g. H1 → H3, H2 → H4), or has
 * no H1 at all. Broken heading hierarchy confuses screen readers, hurts SEO
 * (search engines use heading structure to weight content importance), and
 * signals that the page visual hierarchy was built with font-size not semantics.
 *
 * Pure snapshot rule: no behavioral events required.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import type { HeadingItem } from '../snapshots/types';

function detectJumps(headings: HeadingItem[]): Array<{ from: HeadingItem; to: HeadingItem; gap: number }> {
  const jumps: Array<{ from: HeadingItem; to: HeadingItem; gap: number }> = [];
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];
    // Only flag increases in depth (descending into deeper headings) that skip a level.
    // Level going from 3→2 is fine (moving back up). Gap of 1 is fine (h1→h2).
    const gap = curr.level - prev.level;
    if (gap > 1) {
      jumps.push({ from: prev, to: curr, gap });
    }
  }
  return jumps;
}

export const headingHierarchyJump: AuditRule = {
  id: 'heading-hierarchy-jump',
  category: 'seo',
  name: 'Heading hierarchy jump',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const headings = snapshot.data.headings;
      const h1s = headings.filter((h) => h.level === 1);
      const missingH1 = h1s.length === 0;
      const multipleH1 = h1s.length > 1;
      const jumps = detectJumps(headings);

      if (!missingH1 && !multipleH1 && jumps.length === 0) continue;

      const evidence: AuditFindingEvidence[] = [];

      if (missingH1) {
        evidence.push({ label: 'H1 headings', value: 0, context: 'No H1 found on the page' });
      } else if (multipleH1) {
        evidence.push({
          label: 'H1 headings',
          value: h1s.length,
          context: h1s.map((h) => `"${h.text}"`).join(', '),
        });
      }

      for (const jump of jumps.slice(0, 3)) {
        evidence.push({
          label: `Heading jump H${jump.from.level}→H${jump.to.level}`,
          value: `skips ${jump.gap - 1} level${jump.gap > 2 ? 's' : ''}`,
          context: `"${jump.from.text}" → "${jump.to.text}"`,
        });
      }

      const issues: string[] = [];
      if (missingH1) issues.push('no H1');
      if (multipleH1) issues.push(`${h1s.length} H1s`);
      if (jumps.length > 0) issues.push(`${jumps.length} heading level skip${jumps.length > 1 ? 's' : ''}`);

      const severity = missingH1 ? 'warn' : 'info';
      const priorityScore = missingH1 ? 0.5 : 0.3;

      findings.push({
        id: `heading-hierarchy-jump:${snapshot.pathRef}`,
        ruleId: 'heading-hierarchy-jump',
        category: 'seo',
        severity,
        confidence: 0.92,
        priorityScore,
        pathRef: snapshot.pathRef,
        title: `Broken heading structure on ${snapshot.pathRef} (${issues.join(', ')})`,
        summary: `The heading hierarchy on ${snapshot.pathRef} has ${issues.join(' and ')}. Screen readers navigate by headings, and search engines weight H1 content higher. A skipped or missing H1 flattens the page's information architecture.`,
        recommendation: [
          missingH1
            ? `Add a single H1 to ${snapshot.pathRef} that names the page's primary topic. It should appear before any H2s.`
            : multipleH1
            ? `Reduce to one H1 on ${snapshot.pathRef}. The H1 is the page title; all subsequent headings should be H2 or lower.`
            : `Fix heading level jumps on ${snapshot.pathRef}: ${jumps.map((j) => `H${j.from.level}→H${j.to.level}`).join(', ')}. Insert the skipped level or use a lower heading tag.`,
        ],
        evidence,
        prescription: {
          whatToChange: missingH1
            ? `Add <h1> wrapping the existing primary headline element.`
            : `Correct heading levels so they descend without skipping (H1→H2→H3, not H1→H3).`,
          whyItWorks: `Search engines treat H1 as the authoritative page title. A clean heading hierarchy signals well-structured content and improves crawlability and accessibility for screen reader users.`,
          experimentVariantDescription: `Variant corrects heading semantics without changing visual design. Measure organic impressions and ranking for target keywords over 60 days.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

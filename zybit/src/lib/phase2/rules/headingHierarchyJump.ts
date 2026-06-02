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
import { pageTypeFromSnapshot, pageTypeModulation } from './pageTypeModulation';
import { displayPath } from './helpers';

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

/**
 * Pages with 6+ H1s are virtually always content-index card grids — Stripe
 * `/guides` (59 H1s, one per guide card), `/enterprise` (74 H1s, marketing
 * tiles), PostHog blog index, Vercel templates, etc. The "broken heading
 * hierarchy" framing doesn't apply: the page isn't a document, it's a
 * template that emits one card per item, and the prescription ("fix your
 * H1 nesting") would force the PM to redesign their CMS template. Real
 * "two competing H1s" issues (the genuine bug we want to surface) fire
 * far below this threshold — the doctrinaire-CMS case usually has 1
 * intended H1 and 1 accidental one, never 6.
 *
 * 6 is conservative: it admits patterns like H1-per-section docs templates
 * (rare and still semantically wrong) while excluding every observed
 * card-grid case in the 2026-05-27 batch.
 */
const CONTENT_INDEX_H1_THRESHOLD = 6;

export const headingHierarchyJump: AuditRule = {
  id: 'heading-hierarchy-jump',
  category: 'seo',
  name: 'Heading hierarchy jump',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const pageType = pageTypeFromSnapshot(snapshot.data.visualSignals);
      const modulation = pageTypeModulation('heading-hierarchy-jump', pageType);
      if (modulation.suppress) continue;

      const headings = snapshot.data.headings;
      const h1s = headings.filter((h) => h.level === 1);
      // Skip card-grid / content-index templates — see CONTENT_INDEX_H1_THRESHOLD doc.
      if (h1s.length >= CONTENT_INDEX_H1_THRESHOLD) continue;
      const missingH1 = h1s.length === 0;
      const multipleH1 = h1s.length > 1;
      const allJumps = detectJumps(headings);
      // Docs pages legitimately ship H1→H3 jumps when their renderer groups
      // sections under a parent. floorMultiplier > 1 raises the count
      // required to fire — e.g. 1.4 means a single jump no longer fires
      // (we need ≥ 2). `Math.ceil` is the right rounding here: any
      // multiplier strictly above 1 must produce a stricter threshold, not
      // silently round back down. Missing-H1 / multiple-H1 still fire in
      // all cases — those are unambiguous semantic errors.
      const minJumpsToFire = Math.max(1, Math.ceil(1 * modulation.floorMultiplier));
      const jumps = allJumps.length >= minJumpsToFire ? allJumps : [];

      if (!missingH1 && !multipleH1 && jumps.length === 0) continue;

      const evidence: AuditFindingEvidence[] = [];

      if (missingH1) {
        evidence.push({ label: 'Main heading (H1)', value: 0, context: 'No main heading found on the page' });
      } else if (multipleH1) {
        evidence.push({
          label: 'Main headings (H1)',
          value: h1s.length,
          context: h1s.map((h) => `"${h.text}"`).join(', '),
        });
      }

      for (const jump of jumps.slice(0, 3)) {
        evidence.push({
          label: `Skipped from heading H${jump.from.level} to H${jump.to.level}`,
          value: `skips ${jump.gap - 1} level${jump.gap > 2 ? 's' : ''}`,
          context: `"${jump.from.text}" → "${jump.to.text}"`,
        });
      }

      const issues: string[] = [];
      if (missingH1) issues.push('no main heading');
      if (multipleH1) issues.push(`${h1s.length} main headings`);
      if (jumps.length > 0) issues.push(`${jumps.length} skipped heading level${jumps.length > 1 ? 's' : ''}`);

      const baseSeverity: 'warn' | 'info' = missingH1 ? 'warn' : 'info';
      const severity: 'warn' | 'info' = modulation.severityDowngrade && baseSeverity === 'warn' ? 'info' : baseSeverity;
      const priorityScore = missingH1
        ? modulation.severityDowngrade ? 0.3 : 0.5
        : 0.3;

      findings.push({
        id: `heading-hierarchy-jump:${snapshot.pathRef}`,
        ruleId: 'heading-hierarchy-jump',
        category: 'seo',
        severity,
        confidence: 0.92,
        priorityScore,
        pathRef: snapshot.pathRef,
        title: `The headings on ${displayPath(snapshot.pathRef)} aren't in a clear order (${issues.join(', ')})`,
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
          whyItMatters: missingH1
            ? `Search engines read your page's main heading (the H1) to understand what the page is about. With no main heading — or several competing ones — they have to guess, and a guess ranks worse than a clear signal. People using a screen reader also rely on it as their starting point on the page.`
            : `Both search engines and screen readers use the order of your headings (main heading, then sub-headings, then smaller ones) to understand how the page is organized. Skipping a level — jumping from a main heading straight to a small one — makes the page look disorganized and harder to follow.`,
          whatToChange: missingH1
            ? `Add one clear main heading (an <h1> tag in your page's code) that names what the page is about, placed above the smaller headings.`
            : `Put the headings in order without skipping sizes — main heading, then sub-heading, then the next size down (H1 → H2 → H3, not H1 → H3).`,
          whyItWorks: `Search engines treat H1 as the authoritative page title. A clean heading hierarchy signals well-structured content and improves crawlability and accessibility for screen reader users.`,
          experimentVariantDescription: `Variant corrects heading semantics without changing visual design. Measure organic impressions and ranking for target keywords over 60 days.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

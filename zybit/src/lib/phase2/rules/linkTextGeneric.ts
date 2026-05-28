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
import { pageTypeFromSnapshot, pageTypeModulation } from './pageTypeModulation';

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
      // PageType modulation — Privacy Policy / ToS pages list dozens of
      // "Learn more" footer links that are universally generic but not
      // actionable as a finding. Suppress on `legal`. On `docs`, deep
      // "see also" linking is part of the IA — raise the threshold via
      // floorMultiplier so we don't fire on every cross-link.
      const pageType = pageTypeFromSnapshot(snapshot.data.visualSignals);
      const modulation = pageTypeModulation('link-text-generic', pageType);
      if (modulation.suppress) continue;

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
        // Distinguish "anchors with no destination signal in their text"
        // from "anchors whose text repeats on the page." Both count toward
        // the title's total, but they're different patterns the PM can
        // act on separately. Label is verbose-but-unambiguous so the
        // evidence row clearly maps to a subset of the title's total.
        const distinctPhrases = [...new Set(genericLinks.map((c) => `"${c.text.trim()}"`))];
        evidence.push({
          label: 'Anchors with vague text ("read more", "click here", …)',
          value: genericLinks.length,
          context: `${distinctPhrases.length} distinct phrase${distinctPhrases.length === 1 ? '' : 's'}: ${distinctPhrases.slice(0, 5).join(', ')}`,
        });
      }

      // Surface up to 5 high-frequency groups (was previously 2). The title's
      // total used to mention 21 instances while the visible evidence only
      // accounted for ~14 — the missing rows were the 3rd+ high-frequency
      // groups silently dropped from evidence. Widening the slice makes the
      // title's number fully explained by what the PM can see.
      const VISIBLE_REPEAT_GROUPS = 5;
      const visibleGroups = highFrequency.slice(0, VISIBLE_REPEAT_GROUPS);
      for (const group of visibleGroups) {
        evidence.push({
          label: `Repeated link text "${group[0].text.trim()}"`,
          value: group.length,
          context: `appears ${group.length}× — screen reader users hear the same announcement each time`,
        });
      }
      // Account for any high-frequency groups beyond the slice in a single
      // summary row so the title's total still reconciles with the evidence.
      const hiddenGroups = highFrequency.slice(VISIBLE_REPEAT_GROUPS);
      if (hiddenGroups.length > 0) {
        const hiddenInstances = hiddenGroups.reduce((s, g) => s + g.length, 0);
        evidence.push({
          label: `Other repeated phrases`,
          value: hiddenInstances,
          context: `${hiddenGroups.length} additional phrase${hiddenGroups.length === 1 ? '' : 's'} repeat 3+ times`,
        });
      }

      evidence.push({ label: 'Total links on page', value: links.length });

      // Pick the most concrete offender we can hand to the AI fix-preview
      // advisor. `whatToChange` defaults are too abstract — without an actual
      // anchor + rewrite, the advisor invents a no-op selector and the
      // "after" screenshot is identical to the before.
      const firstGeneric = genericLinks[0]?.text.trim();
      const firstFrequent = highFrequency[0]?.[0]?.text.trim();
      const offendingText = firstGeneric ?? firstFrequent ?? null;
      const whatToChange = offendingText
        ? `Replace the "${offendingText}" link text on ${snapshot.pathRef} with anchor text that names the destination — describe where the link leads rather than the action of clicking. Each link should make sense when read in isolation, without relying on surrounding sentence context.`
        : `Update anchor text across ${snapshot.pathRef} to describe each link's destination. Each link should make sense when read in isolation.`;

      const totalFlagged = genericLinks.length + highFrequency.reduce((s, g) => s + g.length, 0);
      const rate = totalFlagged / Math.max(links.length, 1);
      // floorMultiplier > 1 (docs pages) means the rule needs a higher
      // flagged-ratio before it bumps to `warn` — the base 0.3 becomes
      // 0.3 × 1.3 = 0.39 on docs sites.
      const warnThreshold = 0.3 * modulation.floorMultiplier;
      const severity = rate >= warnThreshold ? 'warn' : 'info';

      // Build whyItMatters from the actual evidence so the email reads as a
      // specific observation about *this* page, not generic anchor-text
      // hygiene advice the PM has heard before. Mirrors `hero-hierarchy-
      // inversion`'s pattern of interpolating the rule's own signals.
      const top = highFrequency.slice(0, 2);
      const genericContextSnippet = genericLinks.length > 0
        ? `${genericLinks.length} link${genericLinks.length > 1 ? 's' : ''} say${genericLinks.length === 1 ? 's' : ''} something like "${(genericLinks[0].text || '').trim()}"`
        : '';
      const repeatedContextSnippet = top.length === 2
        ? `${top[0].length} separate links say "${top[0][0].text.trim()}" and ${top[1].length} say "${top[1][0].text.trim()}"`
        : top.length === 1
          ? `${top[0].length} separate links all say "${top[0][0].text.trim()}"`
          : '';
      const observation = [repeatedContextSnippet, genericContextSnippet]
        .filter(Boolean)
        .join('; ');
      const whyItMatters =
        `On ${snapshot.pathRef}, ${observation || `${totalFlagged} links share uninformative anchor text`}. ` +
        `A visitor scanning the page sees a row of identical-looking anchors and has to read each ` +
        `surrounding sentence to figure out where the link actually goes — that's friction on every ` +
        `click. Screen reader users hear the same announcement repeated. Search engines treat anchor ` +
        `text as a relevance signal for the destination page; when the same phrase points at different ` +
        `pages, that signal scatters and nothing accumulates.`;

      findings.push({
        id: `link-text-generic:${snapshot.pathRef}`,
        ruleId: 'link-text-generic',
        category: 'accessibility',
        severity,
        confidence: 0.88,
        priorityScore: 0.35,
        pathRef: snapshot.pathRef,
        title: `${totalFlagged} link${totalFlagged > 1 ? 's' : ''} on ${snapshot.pathRef} use vague or repeated text`,
        summary: `${snapshot.pathRef} has ${totalFlagged} link${totalFlagged > 1 ? 's' : ''} with generic text. Screen reader users navigating by links hear a list of "click here", "read more", and "learn more" with no context about the destination. Search engines similarly lose link-destination signals when anchor text is uninformative.`,
        recommendation: [
          `Replace generic link text with descriptive anchor text that names the destination page or resource. Each link should convey its destination without relying on surrounding sentence context.`,
          `Where space is constrained, use aria-label to provide a longer accessible name without changing the visible text: <a href="..." aria-label="[Full descriptive label]">Short text</a>.`,
        ],
        evidence,
        prescription: {
          whyItMatters,
          whatToChange,
          whyItWorks: `Descriptive link text improves keyboard and screen reader navigation. It also acts as anchor text for search engines, improving the destination page's relevance signals for the topic named in the link.`,
          experimentVariantDescription: `Variant replaces generic CTAs with destination-specific text. Measure click-through rate on flagged links and organic ranking of destination pages.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

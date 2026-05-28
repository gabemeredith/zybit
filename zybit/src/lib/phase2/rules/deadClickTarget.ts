/**
 * Rule: dead-click-target
 *
 * Detects affordances that look interactive but won't do anything when a
 * visitor clicks them — the static counterpart to `rage-click-target`. PMs
 * cannot wait for PostHog data to find these; they're pure HTML signals.
 *
 * Fires on:
 *   - `<a>` with no `href` (browser renders as not-clickable, but custom CSS
 *     often styles them as primary links anyway — visitor clicks, nothing).
 *   - `<a href="#">` / `<a href="#!">` / `<a href="javascript:void(0)">` —
 *     the classic "I'll wire this up later" placeholder. Many sites ship
 *     these into production.
 *   - `<a href="">` empty string — reloads the current page silently.
 *
 * NOT included today (would need form-context detection or DOM event
 * inspection both of which require capture-level work):
 *   - `<button type="button">` inside `<form>` (would-be submit but isn't)
 *   - `cursor: pointer` on non-interactive elements
 *   - buttons with no onclick / no parent form / no associated handler
 *
 * Pure snapshot rule. No behavioral events. Emits one finding per page that
 * has any dead anchors, severity scaled to the count.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import type { CtaCandidate } from '../snapshots/types';
import { displayPath } from './helpers';

const DEAD_HREF_PATTERNS: RegExp[] = [
  /^\s*$/,           // empty string
  /^#!?\s*$/,         // "#" or "#!"
  /^javascript:\s*(?:void\s*(?:\(\s*0?\s*\)|0)\s*)?;?\s*$/i, // "javascript:void(0)", "javascript:void 0" + variants
];

function deadHref(href: string | null): boolean {
  if (href === null) return false; // null = href attribute absent, separate case
  for (const p of DEAD_HREF_PATTERNS) if (p.test(href)) return true;
  return false;
}

function deadKind(cta: CtaCandidate): 'no-href' | 'placeholder' | null {
  if (cta.tag !== 'a') return null;
  // Skip a11y skip-link patterns that legitimately use `#main`/`#content`
  // — those are filtered upstream in the parser but defensive here too.
  if (cta.href && /^#(main|content|main-content|skip|primary)$/i.test(cta.href)) return null;
  if (cta.href === null) return 'no-href';
  if (deadHref(cta.href)) return 'placeholder';
  return null;
}

export const deadClickTarget: AuditRule = {
  id: 'dead-click-target',
  category: 'rage',
  name: 'Dead click target',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const dead: Array<{ cta: CtaCandidate; kind: 'no-href' | 'placeholder' }> = [];
      for (const cta of snapshot.data.ctas) {
        if (cta.disabled) continue;
        const kind = deadKind(cta);
        if (kind) dead.push({ cta, kind });
      }
      if (dead.length === 0) continue;

      // Severity scales with the count — a single placeholder link is an
      // info nit; ten of them is a launch-readiness problem.
      const severity = dead.length >= 5 ? 'warn' : 'info';
      const priorityScore = Math.min(0.4 + dead.length * 0.05, 0.75);

      const samples = dead.slice(0, 5).map((d) => {
        const label =
          d.cta.text && d.cta.text.length > 0
            ? `"${d.cta.text.slice(0, 60)}"`
            : d.cta.ariaLabel
              ? `(aria-label: ${d.cta.ariaLabel.slice(0, 60)})`
              : '(no label)';
        const reason = d.kind === 'no-href' ? 'no href attribute' : `href: "${d.cta.href}"`;
        return `${label} — ${reason}`;
      });
      const moreCount = Math.max(0, dead.length - samples.length);

      const evidence: AuditFindingEvidence[] = [
        { label: 'Links that go nowhere', value: dead.length },
        { label: 'Examples', value: samples.join(' · ') + (moreCount > 0 ? ` · +${moreCount} more` : '') },
        { label: 'Page', value: displayPath(snapshot.pathRef) },
        {
          label: 'How we know',
          value: 'We found these by reading the links on your page — no analytics needed.',
        },
      ];

      findings.push({
        id: `dead-click-target:${snapshot.pathRef}`,
        ruleId: 'dead-click-target',
        category: 'rage',
        severity,
        confidence: 0.95,
        priorityScore,
        pathRef: snapshot.pathRef,
        title:
          dead.length === 1
            ? `One link on ${displayPath(snapshot.pathRef)} doesn't go anywhere`
            : `${dead.length} links on ${displayPath(snapshot.pathRef)} go nowhere`,
        summary:
          dead.length === 1
            ? `${snapshot.pathRef} has a clickable link that does nothing when a visitor clicks it. The element still draws attention and consumes clicks; the click then silently fails. This is the deterministic counterpart to a rage-click — visible in your HTML, no analytics required.`
            : `${snapshot.pathRef} has ${dead.length} clickable links that do nothing when a visitor clicks them. Each one draws attention and consumes a click that then silently fails — exactly the pattern that produces rage clicks once you can measure them. These are visible in your HTML right now, no analytics required.`,
        recommendation: [
          `Wire each link to its real destination, or — if a link's purpose is purely visual (e.g. an icon decoration) — replace it with a non-clickable element so the page doesn't promise an action it can't deliver.`,
        ],
        evidence,
        prescription: {
          whatToChange: `On ${displayPath(snapshot.pathRef)}, point each of these links at a real page, or — if a link is only a decoration — make it not clickable so it doesn't look like a button that does nothing.`,
          whyItMatters: `A click that goes nowhere is the most frustrating thing a visitor can hit — they tried, and the page ignored them.`,
          whyItWorks: `Real destinations turn high-intent clicks into real outcomes. Removing dead affordances removes the false visual promise.`,
          experimentVariantDescription: `Variant replaces dead hrefs with real destinations (or removes the affordance). Measure: click-through to the intended destination on first session; rage-click rate on the same elements once PostHog is connected.`,
        },
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

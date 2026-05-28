/**
 * Rule: cta-verb-mismatch (Layer F — AI copy critique)
 *
 * Fires when the structured copy critique scored the primary CTA verb as
 * mismatched to the page type. Examples: "Book a demo" on a docs page,
 * "Read more" on a pricing page, "Contact us" on a free-tier signup page.
 * Misaligned CTAs slow visitors down — they arrived expecting one verb
 * and got another.
 *
 * Pure rule over capture-time LLM output. The model's structured
 * `ctaAlignment.matches` boolean is the gate; `suggestedVerbs` populate
 * the recommendation.
 *
 * `publicAuditBehavior: 'as-is'` — the rule's input is the customer's
 * own CTA copy + their own page type (vision-pass-classified).
 *
 * Suppressed when `ctaAlignment` is null — no observed CTA, nothing to
 * critique. Also suppressed when `pageType === 'unknown'` because the
 * mismatch claim requires a confident page-type classification to be
 * meaningful.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import { displayPath } from './helpers';

export const ctaVerbMismatch: AuditRule = {
  id: 'cta-verb-mismatch',
  name: 'CTA verb does not fit page intent',
  category: 'mismatch',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const critique = snapshot.data.copyCritique;
      if (!critique) continue;
      if (!critique.ctaAlignment) continue;
      if (critique.ctaAlignment.matches) continue;

      const pageType = snapshot.data.visualSignals?.pageType;
      if (!pageType || pageType === 'unknown') continue;

      // Identify the actual CTA text the rule is about. Prefer the
      // vision-extracted primary CTA (semantic label); fall back to the
      // parser's heaviest CTA. If neither, skip — we'd have nothing
      // concrete to quote in the finding.
      const visualPrimaryCta = snapshot.data.visualSignals?.visualPrimaryCta;
      const parserHeaviest = (() => {
        const eligible = snapshot.data.ctas.filter((c) => !c.disabled);
        if (eligible.length === 0) return null;
        return [...eligible].sort((a, b) => b.visualWeight - a.visualWeight)[0];
      })();
      const ctaLabel = visualPrimaryCta?.text ?? parserHeaviest?.text ?? '';
      if (!ctaLabel) continue;

      const suggested = critique.ctaAlignment.suggestedVerbs.slice(0, 3);

      const evidence: AuditFindingEvidence[] = [
        { label: 'Your button text', value: ctaLabel },
        { label: 'Type of page', value: pageType },
        {
          label: 'The problem',
          value: "the wording doesn't fit what people came here to do",
          context: 'We asked: would someone arriving on this page expect this wording? The answer was no.',
        },
      ];

      if (suggested.length > 0) {
        evidence.push({
          label: 'Better options',
          value: suggested.join(' · '),
          context: 'Ranked by best fit. Pick the one that sounds most like you.',
        });
      }

      findings.push({
        id: `cta-verb-mismatch:${snapshot.pathRef}`,
        ruleId: 'cta-verb-mismatch',
        category: 'mismatch',
        severity: pageType === 'pricing' || pageType === 'signup' ? 'warn' : 'info',
        confidence: 0.7,
        priorityScore: 0.5,
        pathRef: snapshot.pathRef,
        title: `Your button text on ${displayPath(snapshot.pathRef)} doesn't match what this page is for`,
        summary:
          `On a ${pageType} page, visitors arrive ready for a particular action — and "${ctaLabel}" ` +
          `isn't it. The CTA verb is the small contract between the page and the visitor; when the ` +
          `verb doesn't fit the page, visitors second-guess what they were here to do.`,
        recommendation: [
          suggested.length > 0
            ? `Replace "${ctaLabel}" with a verb that fits the ${pageType} surface. The reviewer's top ` +
              `suggestion is "${suggested[0]}"${suggested.length > 1 ? ` (alternatives: ${suggested.slice(1).map((v) => `"${v}"`).join(', ')})` : ''}.`
            : `Replace "${ctaLabel}" with a verb that names the next action a ${pageType}-page visitor ` +
              `would expect. The right verb is short, an actual verb (not a noun phrase), and answers ` +
              `"what happens when I click?"`,
          `If "${ctaLabel}" is your current standard CTA across the site, you have two clean options: ` +
            `change the page type by reframing the page itself, or change the verb only on this page ` +
            `(per-page CTA copy is fine; per-page CTA visuals are usually a mistake).`,
        ],
        prescription: {
          whyItMatters:
            `When the button wording doesn't match what people came to do — "is 'Contact us' the same as 'Sign up'?" — they hesitate, and a fair share just leave.`,
          whatToChange:
            suggested.length > 0
              ? `Replace "${ctaLabel}" with "${suggested[0]}" on ${displayPath(snapshot.pathRef)}.`
              : `Replace "${ctaLabel}" with a verb that fits a ${pageType} page.`,
          whyItWorks:
            `CTAs work when the verb matches the visitor's mental model of the page. The verb should ` +
            `answer the visitor's question — "what does clicking do?" — in 1–3 words, in language they ` +
            `would use themselves.`,
          experimentVariantDescription:
            `Variant B swaps "${ctaLabel}" for ${suggested[0] ? `"${suggested[0]}"` : 'a page-aligned verb'}. ` +
            `All other elements unchanged. Primary metric: CTA click rate on ${snapshot.pathRef}.`,
        },
        evidence,
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

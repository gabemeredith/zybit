/**
 * Rule: proof-missing (Layer F — AI copy critique)
 *
 * Fires when the structured copy critique identified zero proof signals
 * (named customer logos, specific metrics, press mentions, security
 * badges, named testimonials, ratings, team credentials) in the hero
 * block + first paragraphs — on a page where proof is essential.
 *
 * Scope: only `home` / `landing` / `pricing`. Other page types either
 * don't need proof (legal, docs, support, about) or have a different
 * conversion job. The rule's premise — "this is a sales-shaped page
 * with nothing to back its claim" — is wrong on those pages.
 *
 * Pure rule over capture-time LLM output: no per-rule model calls.
 * `publicAuditBehavior: 'as-is'` because the input is the customer's
 * own visible copy.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';

const RELEVANT_PAGE_TYPES = new Set(['home', 'landing', 'pricing']);

export const proofMissing: AuditRule = {
  id: 'proof-missing',
  name: 'No proof signals',
  category: 'mismatch',
  publicAuditBehavior: 'as-is',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      const critique = snapshot.data.copyCritique;
      if (!critique) continue;

      const pageType = snapshot.data.visualSignals?.pageType ?? 'unknown';
      if (!RELEVANT_PAGE_TYPES.has(pageType)) continue;

      if (critique.proofSignals.length > 0) continue;

      const heroBlock = snapshot.data.visualSignals?.heroBlock;
      const headline = heroBlock?.headline ?? '(no headline detected)';

      const evidence: AuditFindingEvidence[] = [
        {
          label: 'Type of page',
          value: pageType,
          context: 'This page is selling something — visitors want a reason to believe it.',
        },
        {
          label: 'Proof we found',
          value: 0,
          context: 'Near the top of the page we found no customer names, numbers, testimonials, press mentions, or trust badges.',
        },
        {
          label: 'Headline',
          value: headline.length > 200 ? headline.slice(0, 197) + '…' : headline,
        },
      ];

      // priorityScore: 0.5 is the band where "should fix this quarter"
      // findings live. Not as urgent as a hero-hierarchy inversion (the
      // visitor doesn't even see the inversion's effect, they just bounce)
      // but a bigger lift than most accessibility findings — proof is a
      // common gate on enterprise / mid-market conversion.
      findings.push({
        id: `proof-missing:${snapshot.pathRef}`,
        ruleId: 'proof-missing',
        category: 'mismatch',
        severity: pageType === 'pricing' ? 'warn' : 'info',
        confidence: 0.7,
        priorityScore: pageType === 'pricing' ? 0.55 : 0.45,
        pathRef: snapshot.pathRef,
        title: `${snapshot.pathRef} makes claims without showing proof`,
        summary:
          `${snapshot.pathRef} is a ${pageType} page — the visitor's first question is "is this real?" ` +
          `Near the top of the page we found no customer names, numbers, testimonials, trust ` +
          `badges, or press mentions. Every claim on the page asks the visitor to trust you on faith.`,
        recommendation: [
          `Add one credible proof signal above the fold. The simplest version is a row of three to five ` +
            `customer logos under the hero — visitors recognize one and the headline becomes credible. ` +
            `If you don't have customer logos to show yet, lead with a specific metric ("96% of our ` +
            `users finish onboarding in under 10 minutes") instead.`,
          `If you have testimonials further down the page, hoist the most-credible one (named, titled, ` +
            `with a quantified outcome) into the hero. Most landing-page testimonials get less visible ` +
            `at the spot where they're needed most.`,
        ],
        prescription: {
          whyItMatters:
            `With nothing to back up your claims near the top of the page, you look like every other option — and people go with the one that shows proof.`,
          whatToChange:
            `Add proof near the top of the page, just under your headline: 3–5 recognizable customer logos, ` +
            `or one specific result ("Acme cut their onboarding time 12×"), or one real testimonial with ` +
            `a name and title. Pick the strongest one you have.`,
          whyItWorks:
            `Specific, named proof converts because it shifts the page's claim from your voice to a ` +
            `customer's voice. Visitors discount marketing copy; they don't discount Acme saying it ` +
            `worked.`,
          experimentVariantDescription:
            `Variant B adds a proof row (customer logos or one named testimonial with a specific metric) ` +
            `directly below the hero. Primary metric: scroll past the hero + signup form starts on ${snapshot.pathRef}.`,
        },
        evidence,
        refs: { snapshotId: snapshot.id },
      });
    }

    return findings;
  },
};

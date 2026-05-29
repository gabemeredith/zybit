/**
 * Live verification harness for Layer B prose — calls the REAL Gemini API and
 * prints, per representative finding: outcome, latency, tokens, est cost, the
 * template-vs-LLM summary, the prescription, and the numeric-grounding verdict.
 *
 *   npx tsx --env-file=.env scripts/verify-layer-b.ts
 *
 * Exercises the real orchestrator path (factsFromEvidence → runLayerBTraced),
 * so it reflects exactly what Lighthouse Compare mode produces. Read the output
 * and judge: is it concise? grounded (no invented numbers)? PM-readable?
 */

import type { AuditFinding } from '@/lib/phase2/rules/types';
import { factsFromEvidence } from '@/lib/phase2/layerB/factsFromEvidence';
import { runLayerBTraced } from '@/lib/phase2/layerB/runLayerB';

// Two real findings from the acmebank Lighthouse run (template prose included
// so we can show the side-by-side). bounce-on-key-page has NO factsJson — it
// exercises the derive-from-evidence (compare-mode) path.
const FINDINGS: Array<{ finding: AuditFinding; pageType: 'home' | 'pricing' | 'unknown' }> = [
  {
    pageType: 'unknown',
    finding: {
      id: 'return-visit-thrash:/checking-accounts',
      ruleId: 'return-visit-thrash',
      category: 'thrash',
      severity: 'warn',
      confidence: 0.76,
      priorityScore: 0.89,
      pathRef: '/checking-accounts',
      title: 'Return-visit thrash',
      summary:
        '67 sessions visit /checking-accounts 3+ times without progressing — 22.3% of sessions that touch this page get caught in a loop.',
      recommendation: ['template recommendation'],
      evidence: [
        { label: 'Page', value: '/checking-accounts' },
        { label: 'Thrash sessions', value: 67, context: '300 sessions touched the page' },
        { label: 'Thrash rate', value: '22.3%' },
        { label: 'Median visits / thrash session', value: 6 },
      ],
      impactEstimate: {
        value: 2010,
        unit: 'sessions',
        period: 'monthly',
        formatted: '~2k sessions/month',
        basis: 'x',
      },
      factsJson: {
        pathRef: '/checking-accounts',
        thrashSessions: 67,
        totalSessions: 300,
        thrashRate: 0.223,
        medianVisitsPerThrashSession: 6,
      },
    },
  },
  {
    pageType: 'home',
    finding: {
      id: 'bounce-on-key-page:/checking-accounts',
      ruleId: 'bounce-on-key-page',
      category: 'bounce',
      severity: 'warn',
      confidence: 0.87,
      priorityScore: 0.67,
      pathRef: '/checking-accounts',
      title: 'High bounce on key page',
      summary:
        '300 sessions land on /checking-accounts and 67% leave without clicking anything — a key page that costs visitors more than it gives.',
      recommendation: ['template recommendation'],
      evidence: [
        { label: 'Landing path', value: '/checking-accounts' },
        { label: 'Entries', value: 300 },
        { label: 'Bounces', value: 201 },
        { label: 'Bounce rate', value: '67%' },
      ],
      impactEstimate: {
        value: 6030,
        unit: 'sessions',
        period: 'monthly',
        formatted: '~6k sessions/month',
        basis: 'x',
      },
      // No factsJson — compare mode derives it from evidence.
    },
  },
];

// Stand-in AcmeBank brand DNA (in the real pipeline this is derived from the
// site's snapshots by deriveBrandProfile). Lets us see the brand-voice effect.
const ACME_BRAND = {
  ctaVocabulary: ['Open an account', 'Apply now', 'Compare checking accounts', 'Find a branch'],
  voiceSamples: ['Banking that moves with you', 'No monthly fees, no minimums'],
};

function hr(label: string): void {
  console.log(`\n${'─'.repeat(72)}\n${label}\n${'─'.repeat(72)}`);
}

(async () => {
  for (const { finding, pageType } of FINDINGS) {
    const facts = finding.factsJson ?? factsFromEvidence(finding);
    hr(`${finding.ruleId} · ${finding.pathRef}  (${finding.factsJson ? 'own factsJson' : 'DERIVED from evidence'})`);

    const { output, telemetry } = await runLayerBTraced({
      ruleId: finding.ruleId,
      category: finding.category,
      title: finding.title,
      pageType,
      pathRef: finding.pathRef,
      factsJson: facts,
      designTokens: null,
      brandProfile: ACME_BRAND,
    });

    console.log(
      `outcome=${telemetry.outcome}  latency=${telemetry.latencyMs}ms  ` +
        `tokens=${telemetry.promptTokens}/${telemetry.responseTokens}  ` +
        `cost=$${telemetry.estCostUsd?.toFixed(5) ?? 'n/a'}`,
    );
    if (telemetry.fabricationFailures.length) {
      console.log(`REJECTED numbers: ${telemetry.fabricationFailures.join(', ')}`);
    }
    console.log(`\nTEMPLATE summary (${finding.summary.length} chars):\n  ${finding.summary}`);
    if (output) {
      console.log(`\nLLM summary (${output.summary.length} chars):\n  ${output.summary}`);
      console.log(`\nLLM whatToChange:\n  ${output.prescription.whatToChange}`);
      console.log(`LLM whyItWorks:\n  ${output.prescription.whyItWorks}`);
    } else {
      console.log('\nLLM: (fell back to template — see outcome above)');
    }
  }
  console.log('');
})();

/**
 * Runs the real URL-audit + Layer B (compare mode) against a few public sites
 * and prints brand DNA + template-vs-LLM prose per finding.
 *
 *   npx tsx --env-file=.env scripts/audit-3-sites.ts
 */

import { runUrlAudit } from '../lighthouse/lib/runner/runUrlAudit';

const SITES = [
  'https://news.ycombinator.com',
  'https://www.berkshirehathaway.com',
  'https://www.allbirds.com',
];

(async () => {
  for (const url of SITES) {
    console.log(`\n${'='.repeat(78)}\n${url}\n${'='.repeat(78)}`);
    try {
      const result = await runUrlAudit({ url, maxPages: 4, layerB: true, layerBDeriveFacts: true });
      const lb = result.layerB;
      console.log(`findings=${result.counts.findings}  snapshots=${result.counts.snapshots}`);
      if (!lb) {
        console.log('(no Layer B telemetry)');
        continue;
      }
      console.log('BRAND DNA:');
      console.log(`  CTAs : ${(lb.brandProfile?.ctaVocabulary ?? []).join(' · ') || '(none)'}`);
      console.log(
        `  voice: ${(lb.brandProfile?.voiceSamples ?? []).map((v) => `"${v}"`).join('  ') || '(none)'}`,
      );
      console.log(
        `Layer B: ${lb.llmWon}/${lb.attempted} LLM, ${lb.fellBack} fallback, ` +
          `fabReject=${lb.fabricationRejections}, cost=$${lb.estTotalCostUsd.toFixed(4)}`,
      );
      for (const f of lb.findings.slice(0, 3)) {
        console.log(`\n  • ${f.ruleId}  [${f.proseSource} / ${f.call.outcome}]`);
        console.log(`    TEMPLATE: ${f.prose.template.summary}`);
        if (f.prose.llm) {
          console.log(`    LLM     : ${f.prose.llm.summary}`);
          console.log(`    LLM fix : ${f.prose.llm.prescription?.whatToChange ?? '(none)'}`);
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log('');
})();

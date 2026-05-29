/**
 * Layer B prose eval — audit a real URL, then have a different-family judge
 * (OpenAI) score template vs LLM prose pairwise (both orders) and print a
 * win-rate report.
 *
 *   npx tsx --env-file=.env scripts/eval-prose.ts [url]
 */

import { runUrlAudit } from '../lighthouse/lib/runner/runUrlAudit';
import { runEval } from '../src/lib/phase2/layerB/eval/runEval';
import { judgeProvider } from '../src/lib/phase2/layerB/eval/judge';

const url = process.argv[2] ?? 'https://news.ycombinator.com';

(async () => {
  console.log(`Auditing ${url} (Layer B on, compare mode)…`);
  const result = await runUrlAudit({ url, maxPages: 4, layerB: true, layerBDeriveFacts: true });
  const lb = result.layerB;
  if (!lb) {
    console.log('No Layer B telemetry (no eligible findings?).');
    return;
  }
  console.log(
    `Generated: ${lb.llmWon}/${lb.attempted} LLM, ${lb.fellBack} fallback, ` +
      `${lb.fabricationRejections} fabrication-reject, cost=$${lb.estTotalCostUsd.toFixed(4)}`,
  );

  const provider = judgeProvider();
  if (provider === 'openai') {
    console.log('Judging with OpenAI (cross-family, rigorous), pairwise, both orders…');
  } else if (provider === 'gemini') {
    console.log(
      '⚠️  No OPENAI_API_KEY — judging with GEMINI (SAME family as the generator).\n' +
        '   DIRECTIONAL ONLY: a model judging its own family has self-preference bias.\n' +
        '   Add OPENAI_API_KEY for the trustworthy cross-family number.',
    );
  } else {
    console.log('No judge key available — every pair will tie. Set OPENAI_API_KEY or GEMINI_API_KEY.');
  }
  const report = await runEval(lb);

  console.log('\n=== EVAL REPORT ===');
  console.log(`generator: ${report.generatorModel}`);
  console.log(`judged   : ${report.judged} findings`);
  console.log(
    `LLM wins : ${report.llmWins}   template wins: ${report.templateWins}   ties: ${report.ties}`,
  );
  console.log(
    `LLM win-rate: ${(report.llmWinRate * 100).toFixed(0)}%   ` +
      `decisive: ${(report.decisiveRate * 100).toFixed(0)}%   ` +
      `fallback: ${(report.fallbackRate * 100).toFixed(0)}%`,
  );
  console.log('\nper finding:');
  for (const p of report.perFinding) {
    console.log(`  ${p.winner.toUpperCase().padEnd(9)} ${p.ruleId} ${p.pathRef ?? ''} — ${p.reason}`);
  }
  console.log('');
})();

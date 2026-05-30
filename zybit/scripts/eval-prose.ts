/**
 * Layer B prose eval — audit real URL(s), then score template vs LLM prose
 * pairwise (both orders) with the judge and print + persist a win-rate report.
 *
 *   npx tsx --env-file=.env scripts/eval-prose.ts <url>            # one URL
 *   npx tsx --env-file=.env scripts/eval-prose.ts --golden         # the golden set
 *   npx tsx --env-file=.env scripts/eval-prose.ts --golden --limit 3
 *
 * Golden-set runs write a JSON + markdown report under evals/out/ (gitignored —
 * the numbers are run-specific) and print an aggregate win-rate. This is the
 * instrument PRD §1A calls the spine: every downstream decision ("ship
 * default-on?", "which rule to convert next?") reads off these numbers.
 *
 * Judge-family note (post Gemini → OpenAI swap): the GENERATOR is now OpenAI, so
 * the default OpenAI judge is SAME-family (self-preference risk, mitigated by
 * the both-orders protocol). Set GEMINI_API_KEY for the rigorous cross-family
 * judge. See src/lib/phase2/layerB/eval/judge.ts.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runUrlAudit } from '../lighthouse/lib/runner/runUrlAudit';
import { runEval, type EvalReport } from '../src/lib/phase2/layerB/eval/runEval';
import { judgeProvider } from '../src/lib/phase2/layerB/eval/judge';

const MAX_PAGES = 4;

interface GoldenSite {
  url: string;
  category: string;
  note?: string;
}

interface SiteEval {
  url: string;
  category?: string;
  report: EvalReport;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  estCostUsd: number | null;
}

function announceJudge(): void {
  const provider = judgeProvider();
  if (provider === 'gemini') {
    console.log('Judging with GEMINI — cross-family with the OpenAI generator (rigorous), pairwise, both orders…');
  } else if (provider === 'openai') {
    console.log(
      'Judging with OPENAI — SAME family as the generator. Both-orders cancels position bias,\n' +
        '  but for the rigorous cross-family check set GEMINI_API_KEY.',
    );
  } else {
    console.log('No judge key available — every pair will tie. Set OPENAI_API_KEY or GEMINI_API_KEY.');
  }
}

/** Audit one URL with Layer B on (compare mode), then judge. Returns null when
 *  the audit produced no Layer-B-eligible findings. */
async function evalUrl(url: string): Promise<SiteEval | null> {
  const result = await runUrlAudit({ url, maxPages: MAX_PAGES, layerB: true, layerBDeriveFacts: true });
  const lb = result.layerB;
  if (!lb) return null;
  const report = await runEval(lb);
  return {
    url,
    report,
    latencyMsP50: lb.latencyMsP50 ?? null,
    latencyMsP95: lb.latencyMsP95 ?? null,
    estCostUsd: lb.estTotalCostUsd ?? null,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function printReport(report: EvalReport): void {
  console.log('\n=== EVAL REPORT ===');
  console.log(`generator: ${report.generatorModel}`);
  console.log(`judged   : ${report.judged} findings`);
  console.log(`LLM wins : ${report.llmWins}   template wins: ${report.templateWins}   ties: ${report.ties}`);
  console.log(
    `LLM win-rate: ${pct(report.llmWinRate)}   decisive: ${pct(report.decisiveRate)}   ` +
      `fallback: ${pct(report.fallbackRate)}   fabrication-reject: ${report.fabricationRejections}`,
  );
  console.log('\nper finding:');
  for (const p of report.perFinding) {
    console.log(`  ${p.winner.toUpperCase().padEnd(9)} ${p.ruleId} ${p.pathRef ?? ''} — ${p.reason}`);
  }
  console.log('');
}

async function runSingle(url: string): Promise<void> {
  console.log(`Auditing ${url} (Layer B on, compare mode)…`);
  const res = await evalUrl(url);
  if (!res) {
    console.log('No Layer B telemetry (no eligible findings?).');
    return;
  }
  const lb = res.report;
  console.log(
    `Generated: ${lb.attempted - lb.fellBack}/${lb.attempted} LLM, ${lb.fellBack} fallback, ` +
      `${lb.fabricationRejections} fabrication-reject, cost=$${(res.estCostUsd ?? 0).toFixed(4)}`,
  );
  announceJudge();
  printReport(res.report);
}

function buildMarkdown(results: SiteEval[], stampedAt: string): string {
  const lines: string[] = [];
  lines.push(`# Layer B prose eval — golden set`, '', `_Generated ${stampedAt}_`, '');
  const totJudged = results.reduce((s, r) => s + r.report.judged, 0);
  const totLlm = results.reduce((s, r) => s + r.report.llmWins, 0);
  const totTpl = results.reduce((s, r) => s + r.report.templateWins, 0);
  const totFab = results.reduce((s, r) => s + r.report.fabricationRejections, 0);
  const totCost = results.reduce((s, r) => s + (r.estCostUsd ?? 0), 0);
  const overallWinRate = totJudged ? totLlm / totJudged : 0;
  lines.push(
    `**Overall LLM win-rate: ${pct(overallWinRate)}** (${totLlm} LLM / ${totTpl} template / ${totJudged} judged) · ` +
      `fabrication-rejects: ${totFab} · est cost: $${totCost.toFixed(4)} · sites: ${results.length}`,
    '',
    '> Win-rate is only trustworthy once the judge passes human calibration (≥80% agreement on ~20 pairs — use the Lighthouse "Eval calibration" panel).',
    '',
    '| site | judged | LLM | tpl | tie | win-rate | fallback | fab-reject | p50 | p95 | cost |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  );
  for (const r of results) {
    const rep = r.report;
    lines.push(
      `| ${r.url} | ${rep.judged} | ${rep.llmWins} | ${rep.templateWins} | ${rep.ties} | ` +
        `${pct(rep.llmWinRate)} | ${pct(rep.fallbackRate)} | ${rep.fabricationRejections} | ` +
        `${r.latencyMsP50 != null ? Math.round(r.latencyMsP50) + 'ms' : 'n/a'} | ` +
        `${r.latencyMsP95 != null ? Math.round(r.latencyMsP95) + 'ms' : 'n/a'} | ` +
        `$${(r.estCostUsd ?? 0).toFixed(4)} |`,
    );
  }
  return lines.join('\n') + '\n';
}

async function runGolden(limit?: number): Promise<void> {
  const goldenPath = join(process.cwd(), 'evals', 'golden-sites.json');
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { sites: GoldenSite[] };
  const sites = limit ? golden.sites.slice(0, limit) : golden.sites;
  console.log(`Golden-set eval: ${sites.length} site(s), maxPages=${MAX_PAGES}.`);
  announceJudge();

  const results: SiteEval[] = [];
  for (const site of sites) {
    process.stdout.write(`\n→ ${site.url} (${site.category})… `);
    try {
      const res = await evalUrl(site.url);
      if (!res) {
        console.log('no eligible findings, skipped.');
        continue;
      }
      res.category = site.category;
      results.push(res);
      console.log(
        `win-rate ${pct(res.report.llmWinRate)} (${res.report.llmWins}/${res.report.judged}), ` +
          `fallback ${pct(res.report.fallbackRate)}, fab-reject ${res.report.fabricationRejections}`,
      );
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (results.length === 0) {
    console.log('\nNo sites produced eligible findings — nothing to report.');
    return;
  }

  const stampedAt = new Date().toISOString();
  const outDir = join(process.cwd(), 'evals', 'out');
  mkdirSync(outDir, { recursive: true });
  const base = `golden-${stampedAt.replace(/[:.]/g, '-')}`;
  const md = buildMarkdown(results, stampedAt);
  writeFileSync(join(outDir, `${base}.json`), JSON.stringify({ stampedAt, results }, null, 2));
  writeFileSync(join(outDir, `${base}.md`), md);

  console.log('\n' + md);
  console.log(`Report written to evals/out/${base}.{json,md}`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === '--golden') {
    const li = args.indexOf('--limit');
    const limit = li >= 0 ? Number(args[li + 1]) : undefined;
    await runGolden(Number.isFinite(limit) ? limit : undefined);
  } else {
    await runSingle(args[0] ?? 'https://news.ycombinator.com');
  }
})();

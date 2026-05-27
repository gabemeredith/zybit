#!/usr/bin/env node
/**
 * Batch audit harness — drives the real `runUrlAudit` pipeline against a
 * curated mix of public sites, then renders the email HTML each prospect
 * would actually receive. Used for systematic quality-regression triage
 * (see `docs/sprints/REMEDIATION.md` + the in-flight `fix/audit-pipeline-
 * regressions` work).
 *
 * What this script does NOT do (deliberately):
 *   - Run the fix-preview pipeline (Browserless cost + 30-90s per finding).
 *   - Run the captureAuditScreenshot / vision-obs caption (Browserless).
 *   - Send email via Resend.
 *
 * What it DOES do:
 *   - For each URL, calls runUrlAudit with mode='public-audit' and
 *     visionPagesLimit=3 (matches production /api/audit/public/run).
 *   - Reads zybitFindings from Neon (the source of truth for the prospect's
 *     dashboard) and applies the route's top-4 cascade with the same
 *     submitted-page boost.
 *   - Renders the email HTML via renderAuditReportEmailHtml.
 *   - Writes per-site artifacts to /tmp/audit-batch/:
 *       <domain>.email.html   — what the prospect would see
 *       <domain>.findings.json — full top-50 + the top-4 selected slice
 *       <domain>.summary.txt   — quick-scan grep target
 *     Plus a top-level batch-summary.csv with one row per finding.
 *
 * Usage:
 *   npx tsx --env-file=.env --env-file=lighthouse/.env scripts/audit-batch.mjs
 *
 * Or with a custom target list:
 *   npx tsx ... scripts/audit-batch.mjs https://foo.com https://bar.com
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { eq, desc } from 'drizzle-orm';
import { runUrlAudit } from '../lighthouse/lib/runner/runUrlAudit.ts';
import { getDb } from '../src/lib/db/client.ts';
import { zybitFindings } from '../src/lib/db/schema.ts';
import { renderAuditReportEmailHtml } from '../src/lib/email/auditReportEmail.ts';

// Curated mix: well-designed SaaS (Stripe), product-led SaaS that has
// historically tripped CTA bloat (Linear), developer platform (Vercel),
// the joke-OS culprit (PostHog), mature complex product (GitHub),
// productivity (Notion), scheduling (Calendly), design tool (Framer).
const DEFAULT_TARGETS = [
  'https://stripe.com',
  'https://linear.app',
  'https://vercel.com',
  'https://posthog.com',
  'https://github.com',
  'https://notion.so',
  'https://calendly.com',
  'https://framer.com',
];

const TARGETS = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TARGETS;
const OUT_DIR = '/tmp/audit-batch';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg) { console.log(`${GREEN}OK${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}WARN${RESET} ${msg}`); }
function fail(msg) { console.error(`${RED}FAIL${RESET} ${msg}`); }
function note(msg) { console.log(`${DIM}—${RESET} ${msg}`); }

function severityFromScore(s) {
  if (s >= 0.6) return 'high';
  if (s >= 0.3) return 'medium';
  return 'low';
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'unknown'; }
}

function safeFilename(domain) {
  return domain.replace(/[^a-z0-9.-]+/gi, '_');
}

// Mirrors src/app/api/audit/public/run/route.ts top-4 cascade. Kept as a
// verbatim copy so a route-side bug is reproduced here too (the harness
// would lie about the prospect experience otherwise).
function pickTop4(sortedFindings, submittedPath) {
  const SUBMITTED_PAGE_BOOST = 1.5;
  const effectiveScore = (f) =>
    f.priorityScore * (f.pathRef === submittedPath ? SUBMITTED_PAGE_BOOST : 1);
  const ranked = [...sortedFindings].sort(
    (a, b) => effectiveScore(b) - effectiveScore(a),
  );
  const top4 = [];
  const pickedIds = new Set();
  const usedRules = new Set();
  const usedPaths = new Set();
  const pathOf = (f) => f.pathRef ?? '/';
  for (const f of ranked) {
    if (top4.length === 4) break;
    if (usedPaths.has(pathOf(f)) || usedRules.has(f.ruleId)) continue;
    top4.push(f); pickedIds.add(f.id); usedPaths.add(pathOf(f)); usedRules.add(f.ruleId);
  }
  for (const f of ranked) {
    if (top4.length === 4) break;
    if (pickedIds.has(f.id) || usedPaths.has(pathOf(f))) continue;
    top4.push(f); pickedIds.add(f.id); usedPaths.add(pathOf(f)); usedRules.add(f.ruleId);
  }
  for (const f of ranked) {
    if (top4.length === 4) break;
    if (pickedIds.has(f.id) || usedRules.has(f.ruleId)) continue;
    top4.push(f); pickedIds.add(f.id); usedPaths.add(pathOf(f)); usedRules.add(f.ruleId);
  }
  for (const f of ranked) {
    if (top4.length === 4) break;
    if (pickedIds.has(f.id)) continue;
    top4.push(f); pickedIds.add(f.id);
  }
  return { top4, ranked };
}

function toEmailFinding(f, rank) {
  return {
    id: f.id,
    rank,
    severity: severityFromScore(f.priorityScore),
    confidence: f.confidence,
    ruleId: f.ruleId,
    title: f.title,
    whyItMatters: f.prescription?.whyItMatters ?? null,
    evidence: (Array.isArray(f.evidence) ? f.evidence : [])
      .map((e) => `${e.label}: ${e.value}`)
      .join(' · '),
    whatToChange: f.prescription?.whatToChange ?? f.recommendation?.[0] ?? '',
    estimatedImpactMonthlyUsd:
      f.impactEstimate?.unit === 'usd' ? Number(f.impactEstimate.value) : null,
    screenshotBeforeUrl: null,
    screenshotAfterUrl: null,
    fixPreviewTier: null,
    fixRationale: null,
  };
}

async function auditOne(url) {
  const domain = domainOf(url);
  console.log(`\n${YELLOW}== ${url} ==${RESET}`);
  const startedAt = Date.now();

  let result;
  try {
    result = await runUrlAudit({
      url,
      maxPages: 20,
      mode: 'public-audit',
      visionPagesLimit: 3,
      onProgress: (e) => note(`[${e.step}] ${e.message}`),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`runUrlAudit threw on ${url}: ${msg}`);
    return { url, domain, error: msg };
  }

  const { siteId, counts } = result;
  ok(`pipeline produced ${counts.snapshots} snapshot(s), ${counts.findings} finding(s)`);

  if (counts.snapshots === 0) {
    warn(`${domain}: zero snapshots — sandbox/edge bot mitigation likely`);
    return { url, domain, unreachable: true, durationMs: Date.now() - startedAt };
  }

  const db = getDb();
  const dbFindings = await db
    .select()
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, siteId))
    .orderBy(desc(zybitFindings.priorityScore))
    .limit(50);

  const submittedPath = (() => {
    try { return new URL(url).pathname || '/'; }
    catch { return '/'; }
  })();
  const { top4, ranked } = pickTop4(dbFindings, submittedPath);

  // Diversity diagnostic — surfaces issue #1 (page selection) at-a-glance.
  const top4Paths = [...new Set(top4.map((f) => f.pathRef))];
  const top4Rules = [...new Set(top4.map((f) => f.ruleId))];
  note(`top-4 unique paths: ${top4Paths.length} (${top4Paths.join(', ')})`);
  note(`top-4 unique rules: ${top4Rules.length} (${top4Rules.join(', ')})`);

  const report = {
    auditId: `batch-${domain}-${Date.now()}`,
    domain,
    url,
    prospect: { email: 'batch@getzybit.com', role: 'Product Manager' },
    generatedAt: new Date().toLocaleString('en-US'),
    pagesScanned: counts.snapshots,
    totalFindings: counts.findings,
    findings: top4.map((f, i) => toEmailFinding(f, i + 1)),
    bookCallUrl: 'https://calendly.com/asad-getzybit/30min',
    screenshotUrl: null,
    visionObs: null,
    brandDna: null,
  };

  const html = renderAuditReportEmailHtml(report);
  const fname = safeFilename(domain);
  await writeFile(`${OUT_DIR}/${fname}.email.html`, html, 'utf8');
  await writeFile(
    `${OUT_DIR}/${fname}.findings.json`,
    JSON.stringify({ url, domain, siteId, counts, top4, top50: ranked }, null, 2),
    'utf8',
  );

  // Plain-text summary for quick grep across the batch.
  const summaryLines = [
    `# ${domain}  (${url})`,
    `pages=${counts.snapshots}  findings=${counts.findings}  duration=${((Date.now()-startedAt)/1000)|0}s`,
    `top-4 paths: ${top4Paths.join(' | ')}`,
    `top-4 rules: ${top4Rules.join(' | ')}`,
    ``,
    `── TOP 4 (what the prospect sees in the email) ──`,
    ...top4.map((f, i) => {
      const ev = Array.isArray(f.evidence)
        ? f.evidence.map((e) => `  · ${e.label}: ${e.value}`).join('\n')
        : '';
      return [
        `\n#${i + 1}  [${f.ruleId}]  path=${f.pathRef}  score=${f.priorityScore.toFixed(2)}`,
        `  Title:  ${f.title}`,
        ev,
        `  Why:    ${f.prescription?.whyItMatters ?? '(none)'}`,
        `  What:   ${f.prescription?.whatToChange ?? f.recommendation?.[0] ?? '(none)'}`,
      ].join('\n');
    }),
    ``,
    `── REMAINING TOP 50 (one line each) ──`,
    ...ranked.slice(0, 50).map((f, i) =>
      `${String(i + 1).padStart(2)}. [${f.ruleId}]  path=${f.pathRef}  score=${f.priorityScore.toFixed(2)}  ${f.title}`,
    ),
  ];
  await writeFile(`${OUT_DIR}/${fname}.summary.txt`, summaryLines.join('\n'), 'utf8');

  return {
    url,
    domain,
    siteId,
    counts,
    top4Paths,
    top4Rules,
    top4: top4.map((f) => ({
      ruleId: f.ruleId,
      pathRef: f.pathRef,
      score: f.priorityScore,
      title: f.title,
    })),
    rankedCount: ranked.length,
    durationMs: Date.now() - startedAt,
  };
}

async function main() {
  // Clean + recreate output dir so stale runs don't confuse Phase 2.
  try { await rm(OUT_DIR, { recursive: true, force: true }); } catch {}
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`\n${YELLOW}Batch audit — ${TARGETS.length} target(s)${RESET}`);
  console.log(`Output: ${OUT_DIR}\n`);

  const reports = [];
  for (const url of TARGETS) {
    const r = await auditOne(url);
    reports.push(r);
  }

  // batch-summary.csv — one row per top-4 finding across all sites.
  const csvLines = [
    'domain,rank,rule_id,path_ref,score,title',
  ];
  for (const r of reports) {
    if (!r?.top4) continue;
    for (let i = 0; i < r.top4.length; i++) {
      const f = r.top4[i];
      const cells = [
        r.domain,
        i + 1,
        f.ruleId,
        f.pathRef,
        f.score.toFixed(3),
        '"' + (f.title ?? '').replace(/"/g, '""') + '"',
      ];
      csvLines.push(cells.join(','));
    }
  }
  await writeFile(`${OUT_DIR}/batch-summary.csv`, csvLines.join('\n'), 'utf8');

  // Compact JSON for Phase 2's categorizer.
  await writeFile(
    `${OUT_DIR}/batch-index.json`,
    JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2),
    'utf8',
  );

  console.log(`\n${YELLOW}Summary${RESET}`);
  for (const r of reports) {
    if (r.error) {
      console.log(`  ${RED}ERR${RESET}    ${r.domain}: ${r.error}`);
    } else if (r.unreachable) {
      console.log(`  ${YELLOW}UNRCH${RESET}  ${r.domain}`);
    } else {
      const dur = `${((r.durationMs ?? 0) / 1000) | 0}s`;
      console.log(
        `  ${GREEN}OK${RESET}     ${r.domain.padEnd(20)} ${String(r.counts.snapshots).padStart(3)} pages · ${String(r.counts.findings).padStart(3)} findings · top4:[paths=${r.top4Paths.length} rules=${r.top4Rules.length}] · ${dur}`,
      );
    }
  }
  console.log(`\n${DIM}wrote ${OUT_DIR}/ — batch-summary.csv, batch-index.json, plus per-domain *.email.html / *.findings.json / *.summary.txt${RESET}\n`);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

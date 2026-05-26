#!/usr/bin/env node
/**
 * Lighthouse `runUrlAudit` e2e dry-run.
 *
 * Drives the *real* audit pipeline against a small public site:
 *   Firecrawl /map → runSnapshot (HTTP fetch + parser) →
 *   capturePageAllBreakpoints (fails fast, no Browserless in this env —
 *   exercises the fail-soft path) → groundedEvents → insights pipeline →
 *   upsert findings.
 *
 * What this verifies that unit tests don't:
 *
 *   - PR #84 bug-1: real HTTP-fetched pages don't hit the
 *     `el.text.trim()` crash even on truncated/edge DOMs.
 *   - PR #84 bug-4: heading `cssSelector` is populated on findings'
 *     snapshots (proves the parser change flows through to insights data).
 *   - No-Browserless path: the brand-DNA capture fails-soft and the
 *     run still completes.
 *
 * Run with the lighthouse env files loaded:
 *   npx tsx --env-file=.env --env-file=lighthouse/.env \
 *       scripts/e2e-lighthouse-url-audit.mjs <url>
 *
 * Default URL: https://stripe.com (matches the PR #84 verification target).
 */

import { runUrlAudit } from '../lighthouse/lib/runner/runUrlAudit.ts';
import { getDb } from '../src/lib/db/client.ts';
import { phase2PageSnapshots } from '../src/lib/db/schema.ts';
import { and, eq } from 'drizzle-orm';

const TARGET_URL = process.argv[2] ?? 'https://example.com';
const MAX_PAGES = Number(process.argv[3] ?? 3);

function ok(message) {
  console.log(`[32mOK[0m ${message}`);
}
function fail(message) {
  console.error(`[31mFAIL[0m ${message}`);
  process.exitCode = 1;
}

async function main() {
  console.log(`\n--- Lighthouse URL audit e2e: ${TARGET_URL} (max ${MAX_PAGES} pages) ---\n`);

  const result = await runUrlAudit({
    url: TARGET_URL,
    maxPages: MAX_PAGES,
    onProgress: (e) => console.log(`  [${e.step}] ${e.message}`),
  });

  console.log('\nRun summary:');
  console.log(`  organizationId: ${result.organizationId}`);
  console.log(`  siteId:         ${result.siteId}`);
  console.log(`  pages crawled:  ${result.crawl?.pagesDiscovered}`);
  console.log(`  pages snapshotted: ${result.crawl?.pagesSnapshotted}`);
  console.log(`  events written: ${result.counts.events}`);
  console.log(`  findings:       ${result.counts.findings}`);

  if (result.counts.snapshots === 0) {
    fail('zero snapshots produced — pipeline did not exercise the parser');
    return;
  }
  ok(`pipeline produced ${result.counts.snapshots} snapshot(s)`);

  // The real verification: pull a freshly written snapshot row and assert
  // the new HeadingItem.cssSelector field is present on the persisted JSON
  // (proves the parser ran on real HTML and the schema flowed through to
  // the DB, not just an in-process artifact).
  const db = getDb();
  const rows = await db
    .select()
    .from(phase2PageSnapshots)
    .where(and(eq(phase2PageSnapshots.siteId, result.siteId)))
    .limit(MAX_PAGES);

  if (rows.length === 0) {
    fail('no snapshot rows written to phase2_page_snapshots — DB persistence broken');
    return;
  }
  ok(`${rows.length} snapshot row(s) persisted to phase2_page_snapshots`);

  let foundCssSelectorKey = false;
  let totalHeadings = 0;
  let headingsWithSelector = 0;
  for (const row of rows) {
    const headings = row.data?.headings ?? [];
    for (const h of headings) {
      totalHeadings += 1;
      // The new field must exist on every persisted HeadingItem — either
      // a string or null. If `cssSelector` is missing entirely from a
      // freshly-written row, the parser change didn't ship.
      if (!('cssSelector' in h)) {
        fail(`heading "${h.text}" on ${row.pathRef} has no cssSelector field`);
        continue;
      }
      foundCssSelectorKey = true;
      if (h.cssSelector !== null) headingsWithSelector += 1;
    }
  }
  console.log(`  total headings on persisted snapshots: ${totalHeadings}`);
  console.log(`  headings with non-null cssSelector: ${headingsWithSelector}`);
  if (!foundCssSelectorKey) {
    fail('no heading carried the new cssSelector key on any persisted snapshot');
  } else {
    ok('every persisted heading carries the new cssSelector field');
  }

  // Sanity-check the CTA vocab filter would behave on real data.
  let navCtasFiltered = 0;
  let mainCtas = 0;
  for (const row of rows) {
    for (const c of row.data?.ctas ?? []) {
      if (c.landmark === 'nav' || c.landmark === 'header') navCtasFiltered += 1;
      else mainCtas += 1;
    }
  }
  ok(`CTA-vocab filter would drop ${navCtasFiltered} nav/header CTAs, keep ${mainCtas} as conversion copy`);

  if (process.exitCode === 1) {
    console.error('\nLighthouse e2e FAILED — see assertions above.');
    process.exit(1);
  }
  console.log('\nLighthouse e2e PASSED.\n');
}

main().catch((err) => {
  console.error('\nScript error:', err);
  process.exit(2);
});

/**
 * Verify that the Gemini inpaint key works by downloading the existing
 * before-screenshot from the most recent Stripe audit and running the
 * visionInpaint step directly — no Browserless, no full pipeline.
 *
 * Usage:
 *   GEMINI_API_KEY=<key> npx tsx --env-file=.env scripts/verify-gemini-inpaint.ts
 *
 * On success: prints the afterUrl (a real Vercel Blob URL).
 * On failure: prints the exact error so you know what's wrong.
 */

import 'dotenv/config';
import { inpaintFixAfter } from '../src/lib/audit/fixPreview/visionInpaint';
import { getDb } from '../src/lib/db/client';
import { publicAudits } from '../src/lib/db/schema';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[verify-gemini] GEMINI_API_KEY is not set — add it to .env');
    process.exit(1);
  }
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    console.error('[verify-gemini] BLOB_READ_WRITE_TOKEN is not set');
    process.exit(1);
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(publicAudits)
    .where(eq(publicAudits.status, 'done'))
    .orderBy(desc(publicAudits.completedAt))
    .limit(1);

  if (rows.length === 0) {
    console.error('[verify-gemini] No completed audits in the DB to use for testing.');
    process.exit(1);
  }

  const audit = rows[0];
  const findings = (audit.findings ?? []) as Array<{
    id: string;
    ruleId: string;
    title: string;
    screenshotBeforeUrl?: string | null;
    whatToChange?: string;
  }>;

  const finding = findings.find((f) => f.screenshotBeforeUrl);
  if (!finding?.screenshotBeforeUrl) {
    console.error('[verify-gemini] No stored before-screenshot URL in most recent audit. Re-run the full audit first.');
    process.exit(1);
  }

  console.log(`[verify-gemini] Using audit ${audit.id} (${audit.domain})`);
  console.log(`[verify-gemini] Fetching before screenshot: ${finding.screenshotBeforeUrl}`);

  const res = await fetch(finding.screenshotBeforeUrl);
  if (!res.ok) {
    console.error(`[verify-gemini] Failed to fetch before screenshot: HTTP ${res.status}`);
    process.exit(1);
  }
  const beforeBuffer = Buffer.from(await res.arrayBuffer());
  console.log(`[verify-gemini] Before buffer: ${(beforeBuffer.length / 1024).toFixed(1)} KB`);

  console.log(`[verify-gemini] Calling Gemini inpaint (ruleId: ${finding.ruleId})…`);
  const start = Date.now();
  const result = await inpaintFixAfter(
    {
      findingId: finding.id + '-verify',
      beforeBuffer,
      beforeUrl: finding.screenshotBeforeUrl,
      finding: {
        ruleId: finding.ruleId,
        title: finding.title,
        whatToChange: finding.whatToChange ?? 'Improve the conversion experience.',
        whyItWorks: 'Clearer copy improves conversion.',
      },
      designTokens: null,
    },
    { apiKey },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!result) {
    console.error(`[verify-gemini] inpaintFixAfter returned null after ${elapsed}s`);
    console.error('  → Check the console warnings above for the specific failure reason.');
    process.exit(1);
  }

  console.log(`\n[verify-gemini] ✓ SUCCESS in ${elapsed}s`);
  console.log(`  before: ${result.beforeUrl}`);
  console.log(`  after:  ${result.afterUrl}`);
  console.log(`  rationale: ${result.rationale}`);
}

main().catch((err) => {
  console.error('[verify-gemini] Unhandled error:', err);
  process.exit(1);
});

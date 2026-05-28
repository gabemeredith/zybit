/**
 * CLI entry for the /demo seed.
 *
 *   npx tsx scripts/seed-demo.ts          # runs audit only if findings missing
 *   npx tsx scripts/seed-demo.ts --force  # rebuilds findings from scratch
 *
 * Reads the same env the audit pipeline needs: DATABASE_URL,
 * BROWSERLESS_URL, BROWSERLESS_KEY, FIRECRAWL_KEY, GEMINI_API_KEY,
 * BLOB_READ_WRITE_TOKEN, AUDIT_FIX_PREVIEW_ENABLED=1.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function main() {
  const { seedDemo, readSeedStatus } = await import('../src/lib/demo/seed');
  const force = process.argv.includes('--force');
  console.log(`[seed-demo] starting (force=${force})`);
  await seedDemo({ force });
  const status = await readSeedStatus();
  console.log('[seed-demo] done', status);
}

main().catch((err) => {
  console.error('[seed-demo] failed', err);
  process.exit(1);
});

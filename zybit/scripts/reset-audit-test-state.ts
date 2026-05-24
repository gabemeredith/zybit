/**
 * Dev-only helper: clear all public-audit rate-limit + budget rows so the E2E
 * test can re-submit without waiting for the IP/email/host quotas to drain.
 *
 * Usage: `npx tsx --env-file=.env scripts/reset-audit-test-state.ts`
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../src/lib/db/client';

async function main() {
  const db = getDb();

  const beforeRl = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM public_audit_rate_limits
  `);
  const beforeBudget = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM public_audit_budget
  `);

  await db.execute(sql`DELETE FROM public_audit_rate_limits`);
  await db.execute(sql`DELETE FROM public_audit_budget`);

  console.log(`Cleared ${beforeRl.rows[0]?.count ?? 0} rate-limit rows and ${beforeBudget.rows[0]?.count ?? 0} budget rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * One-shot script: clear rate-limit entries so production can accept a
 * test audit submission from the current IP / email / host.
 *
 * Usage: npx tsx scripts/clear-audit-ratelimit.ts
 */
import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const keysToDelete = [
    // wipe all ip:, email:, domain:, and host: keys related to the test
    'audit:email:aarizvi06@gmail.com',
    'audit:dom:gmail.com',
    'audit:host:commitmint.app',
  ];

  // Also clear by prefix for any IP entries accumulated today
  const deleted = await sql`
    DELETE FROM public_audit_rate_limits
    WHERE key = ANY(${keysToDelete})
       OR key LIKE 'audit:ip:%'
    RETURNING key
  `;

  console.log('Cleared rate-limit rows:', deleted.map((r) => (r as { key: string }).key));
}

main().catch((err) => { console.error(err); process.exit(1); });

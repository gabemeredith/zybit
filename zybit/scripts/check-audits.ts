import { sql } from 'drizzle-orm';
import { getDb } from '../src/lib/db/client';

(async () => {
  const db = getDb();
  const r = await db.execute(sql`
    SELECT domain, status, pages_scanned, total_findings,
           LEFT(COALESCE(error, ''), 80) AS error_short,
           submitted_at
    FROM public_audits
    WHERE domain IN ('oracle.com','bloomberg.com','linear.app','stripe.com','salesforce.com','hubspot.com','www.oracle.com','www.bloomberg.com')
    ORDER BY submitted_at DESC LIMIT 12
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

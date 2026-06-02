import { getDb } from '../src/lib/db/client.ts';
import { zybitFindings } from '../src/lib/db/schema.ts';
import { eq } from 'drizzle-orm';

const siteId = process.argv[2] ?? 'lighthouse_site_urlaudit-vercel-com';
const db = getDb();
const rows = await db.select().from(zybitFindings).where(eq(zybitFindings.siteId, siteId));
console.log(`${rows.length} findings on ${siteId}:\n`);
const byRule = {};
for (const r of rows) byRule[r.ruleId] = (byRule[r.ruleId] || 0) + 1;
for (const [ruleId, count] of Object.entries(byRule).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${String(count).padStart(2)} × ${ruleId}`);
}
console.log('\nSample evidence (top 5 by priority):');
const sorted = [...rows].sort((a,b)=>(b.priorityScore??0)-(a.priorityScore??0)).slice(0,5);
for (const r of sorted) {
  console.log(`\n[${r.ruleId}] ${r.title}`);
  console.log(`  priorityScore=${r.priorityScore} confidence=${r.confidence} pathRef=${r.pathRef ?? '(site-wide)'}`);
  for (const e of r.evidence ?? []) console.log(`  ${e.label}: ${e.value}`);
}
process.exit(0);

console.log('\n--- prescription field passthrough (what reaches the email) ---');
for (const r of sorted) {
  console.log(`\n[${r.ruleId}]`);
  console.log(`  whatToChange: ${(r.prescription?.whatToChange ?? '').slice(0,180)}`);
  console.log(`  whyItMatters: ${(r.prescription?.whyItMatters ?? '').slice(0,180)}`);
}

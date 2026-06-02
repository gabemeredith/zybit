/**
 * One-off: re-render the audit report email with the current template for
 * a given audit id (or the most recent N completed audits) and send to a
 * target email. Used to preview template changes against real audit data
 * without re-running the full crawl/insights pipeline.
 *
 * Usage:
 *   npx tsx scripts/resend-audit-report.ts --to me@example.com --recent 3
 *   npx tsx scripts/resend-audit-report.ts --to me@example.com --id pub_abc123
 *   npx tsx scripts/resend-audit-report.ts --to me@example.com --domain github.com
 */

import 'dotenv/config';
import { getDb } from '@/lib/db/client';
import { publicAudits } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import {
  sendAuditReportEmail,
  type AuditFindingForEmail,
  type AuditReport,
} from '@/lib/email/auditReportEmail';
import { PUBLIC_AUDIT_RULE_COUNT } from '@/lib/audit/publicAuditRuleCount';
import { severityFromScore, formatAuditDate } from '@/lib/audit/auditReportFormatting';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  const to = arg('--to');
  if (!to) {
    console.error('Missing --to <email>');
    process.exit(1);
  }
  const id = arg('--id');
  const domain = arg('--domain');
  const recent = Number(arg('--recent') ?? '0');

  const db = getDb();

  let rows;
  if (id) {
    rows = await db.select().from(publicAudits).where(eq(publicAudits.id, id)).limit(1);
  } else if (domain) {
    rows = await db
      .select()
      .from(publicAudits)
      .where(and(eq(publicAudits.domain, domain), eq(publicAudits.status, 'done')))
      .orderBy(desc(publicAudits.completedAt))
      .limit(Math.max(1, recent || 1));
  } else {
    rows = await db
      .select()
      .from(publicAudits)
      .where(eq(publicAudits.status, 'done'))
      .orderBy(desc(publicAudits.completedAt))
      .limit(Math.max(1, recent || 1));
  }

  if (rows.length === 0) {
    console.error('No matching audits found.');
    process.exit(1);
  }

  for (const audit of rows) {
    const stored = (audit.findings ?? []) as Array<Record<string, unknown>>;
    const findings: AuditFindingForEmail[] = stored.slice(0, 4).map((f, i) => ({
      id: String(f.id ?? `f${i}`),
      rank: Number(f.rank ?? i + 1),
      severity: (f.severity as 'high' | 'medium' | 'low') ?? severityFromScore(Number(f.priorityScore)),
      confidence: Number(f.confidence ?? 0.7),
      ruleId: String(f.ruleId ?? 'unknown'),
      title: String(f.title ?? ''),
      whyItMatters: (f.whyItMatters as string | null) ?? null,
      evidence: String(f.evidence ?? ''),
      whatToChange: String(f.whatToChange ?? ''),
      estimatedImpactMonthlyUsd:
        typeof f.estimatedImpactMonthlyUsd === 'number' ? f.estimatedImpactMonthlyUsd : null,
      screenshotBeforeUrl: (f.screenshotBeforeUrl as string | null | undefined) ?? null,
      screenshotAfterUrl: (f.screenshotAfterUrl as string | null | undefined) ?? null,
      fixPreviewTier: (f.fixPreviewTier as 1 | 2 | 3 | null | undefined) ?? null,
      fixRationale: (f.fixRationale as string | null | undefined) ?? null,
    }));

    const report: AuditReport = {
      auditId: audit.id,
      domain: audit.domain,
      url: audit.url,
      prospect: { email: audit.email, role: audit.role },
      generatedAt: formatAuditDate(audit.completedAt ?? audit.submittedAt ?? new Date()),
      pagesScanned: audit.pagesScanned ?? 0,
      rulesEvaluated: PUBLIC_AUDIT_RULE_COUNT,
      totalFindings: audit.totalFindings ?? findings.length,
      findings,
      bookCallUrl:
        process.env.ZYBIT_BOOK_CALL_URL ?? 'https://calendly.com/asad-getzybit/30min',
    };

    console.log(`Sending ${audit.id} (${audit.domain}, ${findings.length} findings) → ${to}`);
    const res = await sendAuditReportEmail(to, report);
    if (!res.success) {
      console.error(`  failed: ${res.error}`);
    } else {
      console.log(`  ok`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

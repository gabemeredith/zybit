import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { sendAuditReportEmail } from '@/lib/email/auditReportEmail';
import type { AuditReport, AuditFindingForEmail } from '@/lib/email/auditReportEmail';
import { recordAuditCost } from '@/lib/audit/publicAuditRateLimit';
import { captureAuditScreenshot, runVisionPass } from '@/lib/audit/visionPass';
import { runUrlAudit } from '../../../../../../lighthouse/lib/runner/runUrlAudit';
import { eq, desc } from 'drizzle-orm';

// Give the full pipeline plenty of time. Set VERCEL_MAX_DURATION in project
// settings to 300 on Pro to unlock the full window.
export const maxDuration = 300;

type AuditRow = {
  id: string;
  email: string;
  domain: string;
  url: string;
  role: string;
  status: string;
};

function severityFromScore(priorityScore: number): 'high' | 'medium' | 'low' {
  if (priorityScore >= 0.6) return 'high';
  if (priorityScore >= 0.3) return 'medium';
  return 'low';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  }) + ' ET';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Secret guard — same pattern as cron routes
  const auth = req.headers.get('Authorization');
  const secret = process.env.FORGE_CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { auditId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { auditId } = body ?? {};
  if (!auditId) {
    return NextResponse.json({ error: 'auditId required' }, { status: 400 });
  }

  const db = getDb();

  const auditResult = await db.execute<AuditRow>(sql`
    SELECT id, email, domain, url, role, status
    FROM public_audits WHERE id = ${auditId} LIMIT 1
  `);
  const audit = auditResult.rows[0] as AuditRow | undefined;

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
  }
  if (audit.status === 'done') {
    return NextResponse.json({ status: 'already_done' });
  }
  if (audit.status !== 'running') {
    return NextResponse.json({ error: `Unexpected status: ${audit.status}` }, { status: 409 });
  }

  let generateResult;
  let pipelineError: string | null = null;

  try {
    generateResult = await runUrlAudit({
      url: audit.url,
      maxPages: 20,
    });
  } catch (err) {
    pipelineError = err instanceof Error ? err.message : String(err);
  }

  if (pipelineError || !generateResult) {
    await db.execute(sql`
      UPDATE public_audits
      SET status = 'failed', error = ${pipelineError ?? 'Unknown pipeline error'}, completed_at = now()
      WHERE id = ${auditId}
    `);
    return NextResponse.json({ error: pipelineError }, { status: 500 });
  }

  const { siteId, counts } = generateResult;

  // Pull the top findings from the DB (the pipeline wrote them there)
  const dbFindings = await db
    .select()
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, siteId))
    .orderBy(desc(zybitFindings.priorityScore))
    .limit(10);

  const topFindings: AuditFindingForEmail[] = dbFindings.slice(0, 4).map((f, i) => ({
    id: f.id,
    rank: i + 1,
    severity: severityFromScore(f.priorityScore),
    confidence: f.confidence,
    ruleId: f.ruleId,
    title: f.title,
    evidence: f.evidence
      .map((e: { label: string; value: string | number }) => `${e.label}: ${e.value}`)
      .join(' · '),
    whatToChange: f.prescription?.whatToChange ?? f.recommendation?.[0] ?? '',
    estimatedImpactMonthlyUsd: f.impactEstimate?.unit === 'usd' ? Number(f.impactEstimate.value) : null,
  }));

  // Vision pass — non-fatal, best-effort
  const screenshot = await captureAuditScreenshot(audit.url);
  const visionObs = screenshot?.buffer
    ? await runVisionPass(
        audit.domain,
        screenshot.buffer,
        topFindings[0]
          ? { title: topFindings[0].title, whatToChange: topFindings[0].whatToChange }
          : null,
      )
    : null;

  const bookCallUrl =
    process.env.ZYBIT_BOOK_CALL_URL ?? 'https://calendly.com/asad-getzybit/30min';

  const report: AuditReport = {
    domain: audit.domain,
    url: audit.url,
    prospect: { email: audit.email, role: audit.role },
    generatedAt: formatDate(new Date()),
    pagesScanned: counts.snapshots,
    totalFindings: counts.findings,
    findings: topFindings,
    bookCallUrl,
    screenshotUrl: screenshot?.screenshotUrl || null,
    visionObs,
  };

  await sendAuditReportEmail(audit.email, report);

  // Approximate cost: $0.01 per snapshot page
  const estimatedCostUsd = Math.max(0.05, counts.snapshots * 0.01);
  await recordAuditCost(estimatedCostUsd);

  await db.execute(sql`
    UPDATE public_audits
    SET
      status = 'done',
      findings = ${JSON.stringify(topFindings)},
      pages_scanned = ${counts.snapshots},
      total_findings = ${counts.findings},
      cost_usd = ${estimatedCostUsd.toFixed(4)},
      completed_at = now()
    WHERE id = ${auditId}
  `);

  return NextResponse.json({
    status: 'done',
    domain: audit.domain,
    pagesScanned: counts.snapshots,
    totalFindings: counts.findings,
  });
}

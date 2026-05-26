import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { sendAuditReportEmail } from '@/lib/email/auditReportEmail';
import type { AuditReport, AuditFindingForEmail, AuditBrandDna } from '@/lib/email/auditReportEmail';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import type { DesignTokens } from '@/lib/phase2/snapshots/tokenExtractor';
import { normalizePathRef, type PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { recordAuditCost, checkDailyBudget } from '@/lib/audit/publicAuditRateLimit';
import { captureAuditScreenshot, runVisionPass } from '@/lib/audit/visionPass';
import { validatePublicUrl } from '@/lib/audit/urlValidator';
import { deriveIndustry } from '@/lib/audit/deriveIndustry';
import { recordAuditUserActivity } from '@/lib/audit/recordAuditUserActivity';
import { runUrlAudit } from '../../../../../../lighthouse/lib/runner/runUrlAudit';
import { eq, desc } from 'drizzle-orm';

// Give the full pipeline plenty of time. Set VERCEL_MAX_DURATION in project
// settings to 300 on Pro to unlock the full window.
export const maxDuration = 300;
// urlValidator uses node:dns, runUrlAudit reaches outside the Next bundle, and
// recordAuditCost uses node:crypto via getDb — pin to Node so an Edge default
// flip can't break this route silently.
export const runtime = 'nodejs';

// Minimum charge against the daily budget for any attempted run. Even a
// pipeline failure has usually paid some Firecrawl/Browserless cost, and
// charging zero would let an attacker who can reliably trigger failures
// invisibly burn through the budget cap.
const MIN_AUDIT_COST_USD = 0.05;

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


/**
 * Build the brand-DNA payload for the report email by joining the
 * Browserless-captured design tokens (rows in `phase2_site_design_snapshot`,
 * written by `runUrlAudit`'s parallel capture step) with the structural
 * snapshot's CTA vocabulary. Returns `null` when neither side has data —
 * the email renderer treats null as "skip the section".
 */
async function collectBrandDna(args: {
  organizationId: string;
  siteId: string;
  auditUrl: string;
}): Promise<AuditBrandDna | null> {
  // Use the same `normalizePathRef` the snapshot repository uses on writes
  // — otherwise a trailing-slash URL (e.g. `/pricing/`) lands as `/pricing/`
  // here but `/pricing` in the row, silently returning empty `ctaVocabulary`
  // (PR #85 review issue #1).
  const pathRef = (() => {
    try {
      return normalizePathRef(args.auditUrl);
    } catch {
      return '/';
    }
  })();

  const db = getDb();
  let tokens: DesignTokens | null = null;
  let cssSystemFromDesign: string | null = null;
  try {
    const row = await createDesignSnapshotRepository().findBySitePath(
      args.organizationId,
      args.siteId,
      pathRef,
    );
    if (row) {
      tokens = (row.designTokens ?? null) as DesignTokens | null;
      cssSystemFromDesign = row.cssSystem ?? null;
    }
  } catch {
    // fail-soft — the section is optional. The audit row is already
    // updated to 'done'; we don't want a brand-DNA read failure to flip
    // the audit into a failed state.
  }

  // CTA vocabulary lives on the structural snapshot, not on the design
  // snapshot row — pull from the existing phase2_page_snapshots row the
  // structural fetch wrote earlier in the same run.
  //
  // The CTA-text register is "detected conversion copy" — what the page
  // sells with, not its navigation. Including nav/header entries (Products,
  // Solutions, Developers, Pricing — the labels we ship today on Stripe and
  // Linear captures) confuses the email's "CTA voice" claim with the IA
  // labels. Filter those landmarks out and prefer high-weight entries when
  // selecting the top 5.
  const ctaVocabulary: string[] = [];
  let cssSystemFromSnapshot: string | null = null;
  try {
    const snap = await db.execute<{ data: PageSnapshotData }>(sql`
      SELECT data FROM phase2_page_snapshots
      WHERE site_id = ${args.siteId} AND path_ref = ${pathRef}
      LIMIT 1
    `);
    const data = snap.rows[0]?.data;
    if (data) {
      cssSystemFromSnapshot = (data.cssSystem ?? null) as string | null;
      const candidates = (data.ctas ?? [])
        .filter((c) => c.landmark !== 'nav' && c.landmark !== 'header')
        .slice()
        // Rank by visualWeight so a hero "Start now" beats a footer link.
        .sort((a, b) => (b.visualWeight ?? 0) - (a.visualWeight ?? 0));
      const seen = new Set<string>();
      for (const cta of candidates) {
        const t = (cta.text ?? '').trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        ctaVocabulary.push(t);
        if (ctaVocabulary.length >= 5) break;
      }
    }
  } catch {
    // fail-soft
  }

  const dna: AuditBrandDna = {
    primaryColor: tokens?.primaryColor ?? null,
    secondaryColor: tokens?.secondaryColor ?? null,
    typeScale: tokens?.typeScale ?? null,
    cssSystem: cssSystemFromDesign ?? cssSystemFromSnapshot,
    ctaVocabulary,
  };

  // Return null when every field is empty so the route surfaces "no brand
  // DNA available" cleanly instead of an all-null payload that the renderer
  // would have to special-case downstream.
  if (
    !dna.primaryColor &&
    !dna.secondaryColor &&
    (!dna.typeScale || dna.typeScale.length === 0) &&
    !dna.cssSystem &&
    dna.ctaVocabulary.length === 0
  ) {
    return null;
  }
  return dna;
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

  // Re-check the daily budget right before spending. The submit-time check at
  // /api/audit/public/submit reads spend that is only recorded *after* a
  // pipeline finishes — so a burst of submissions near the cap can all pass
  // the check, all confirm, and all dispatch concurrently. Re-checking here
  // closes the burst-window: each run sees whatever spend has been recorded
  // by audits that finished ahead of it.
  const budget = await checkDailyBudget();
  if (!budget.allowed) {
    await db.execute(sql`
      UPDATE public_audits
      SET status = 'failed', error = ${budget.reason ?? 'Daily audit capacity is full.'}, completed_at = now()
      WHERE id = ${auditId} AND status = 'running'
    `);
    return NextResponse.json({ error: budget.reason ?? 'Daily audit capacity is full.' }, { status: 429 });
  }

  // Re-validate the stored URL right before the network fetch. The submit-time
  // DNS check could be stale by up to 24h (token expiry window), opening a
  // DNS-rebinding window where an attacker swaps the A record from a public
  // IP to an RFC-1918 address after passing the initial guard.
  const revalidation = await validatePublicUrl(audit.url);
  if (!revalidation.valid) {
    await db.execute(sql`
      UPDATE public_audits
      SET status = 'failed', error = ${`URL re-validation failed: ${revalidation.reason}`}, completed_at = now()
      WHERE id = ${auditId} AND status = 'running'
    `);
    return NextResponse.json({ error: revalidation.reason }, { status: 400 });
  }

  let generateResult;
  let pipelineError: string | null = null;

  try {
    generateResult = await runUrlAudit({
      url: revalidation.url.toString(),
      maxPages: 20,
      // Run the insights pipeline in public-audit mode so behavioral rules
      // fail closed and structural-only rules pre-rewrite their copy. The
      // post-hoc DELETE/UPDATE scrub that used to live here is gone — the
      // pipeline now ships prospect-safe findings end-to-end.
      mode: 'public-audit',
      // Capture-time vision signals for the first 3 pages (homepage +
      // first two deep pages from the crawl). Closes the unnamed-CTA
      // root cause for the prospect-facing surface — hero rule reads
      // `visualPrimaryCta.text` when its own CTA text is empty.
      // ~$0.001/page × 3 = $0.003 added to per-audit cost. No-op when
      // GEMINI_API_KEY or BROWSERLESS_KEY are unset.
      visionPagesLimit: 3,
    });
  } catch (err) {
    pipelineError = err instanceof Error ? err.message : String(err);
  }

  if (pipelineError || !generateResult) {
    // Charge the minimum even on failure — Firecrawl/Browserless are usually
    // billed before runUrlAudit throws, and a free failure path is a budget bypass.
    await recordAuditCost(MIN_AUDIT_COST_USD);
    await db.execute(sql`
      UPDATE public_audits
      SET status = 'failed',
          cost_usd = ${MIN_AUDIT_COST_USD.toFixed(4)},
          error = ${pipelineError ?? 'Unknown pipeline error'},
          completed_at = now()
      WHERE id = ${auditId} AND status = 'running'
    `);
    return NextResponse.json({ error: pipelineError }, { status: 500 });
  }

  const { siteId, counts } = generateResult;

  // If the crawl returned zero pages, sending a "0 findings" report would
  // read as "Zybit found nothing wrong with your site" — actively misleading.
  // The likely real cause is bot protection (Cloudflare/Akamai), an
  // unfriendly robots.txt, or JS-only navigation hiding links from the
  // HTTP crawler. Bail out, record the minimum cost (Firecrawl charges us
  // for the failed crawl), mark the audit `unreachable`, and let the status
  // page render a dedicated UX explaining why and what to do next.
  if (counts.snapshots === 0) {
    await recordAuditCost(MIN_AUDIT_COST_USD);
    await db.execute(sql`
      UPDATE public_audits
      SET
        status = 'unreachable',
        pages_scanned = 0,
        total_findings = 0,
        cost_usd = ${MIN_AUDIT_COST_USD.toFixed(4)},
        error = ${'No pages could be crawled — likely bot protection, robots.txt, or JS-only navigation.'},
        completed_at = now()
      WHERE id = ${auditId} AND status = 'running'
    `);
    return NextResponse.json({
      status: 'unreachable',
      domain: audit.domain,
      pagesScanned: 0,
    });
  }

  // Findings reach us already rewritten by `runAuditRules` in `public-audit`
  // mode — undeclared rules emitted nothing, structural-only rules had
  // their copy replaced before persistence. We still read from the DB
  // (not from `generateResult.sample.findings`) because `upsertFindings`
  // is the source of truth for what the prospect's auto-provisioned
  // dashboard will show, and we want the email and the dashboard to
  // render the exact same rows.
  const dbFindings = await db
    .select()
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, siteId))
    .orderBy(desc(zybitFindings.priorityScore))
    .limit(50);

  const topFindings: AuditFindingForEmail[] = dbFindings.slice(0, 4).map((f, i) => ({
    id: f.id,
    rank: i + 1,
    severity: severityFromScore(f.priorityScore),
    confidence: f.confidence,
    ruleId: f.ruleId,
    title: f.title,
    whyItMatters: f.prescription?.whyItMatters ?? null,
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

  // Brand-DNA pull — runUrlAudit fires a parallel desktop Browserless
  // capture and upserts to phase2_site_design_snapshot. Read the row here
  // so the email can render the "Your brand DNA" section. Fail-soft: the
  // section is omitted when nothing landed (Browserless error, budget
  // exhausted, or just not configured locally).
  const brandDna = await collectBrandDna({
    organizationId: generateResult.organizationId,
    siteId,
    auditUrl: audit.url,
  });

  const report: AuditReport = {
    auditId: audit.id,
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
    brandDna,
  };

  // Approximate cost: $0.01 per snapshot page. Recorded against the budget
  // regardless of email outcome — the cost was already incurred.
  const estimatedCostUsd = Math.max(MIN_AUDIT_COST_USD, counts.snapshots * 0.01);
  await recordAuditCost(estimatedCostUsd);

  // sendAuditReportEmail returns { success, error } rather than throwing,
  // so we have to inspect the result — not just await it.
  let emailError: string | null = null;
  try {
    const sendResult = await sendAuditReportEmail(audit.email, report);
    if (!sendResult.success) {
      emailError = sendResult.error ?? 'Unknown send error';
    }
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
  }

  if (emailError) {
    // Pipeline succeeded but delivery failed — surface in DB so the audit
    // doesn't sit in 'running' forever and an operator can re-send. Guarded
    // on status = 'running' so we don't overwrite a lazy-flipped 'failed'
    // from /api/audit/public/status with a stale write.
    await db.execute(sql`
      UPDATE public_audits
      SET
        status = 'failed',
        findings = ${JSON.stringify(topFindings)},
        pages_scanned = ${counts.snapshots},
        total_findings = ${counts.findings},
        cost_usd = ${estimatedCostUsd.toFixed(4)},
        error = ${`Report email failed: ${emailError}`},
        completed_at = now()
      WHERE id = ${auditId} AND status = 'running'
    `);
    return NextResponse.json({ error: emailError }, { status: 500 });
  }

  // Capture the completion timestamp at the moment we flip status=done so
  // the post-audit write-through can stamp `last_audit_at` with a value
  // that lines up with the audit record's own `completed_at`. `new Date()`
  // inside `after()` would drift by however long the callback waits before
  // running.
  const completedAt = new Date();

  await db.execute(sql`
    UPDATE public_audits
    SET
      status = 'done',
      findings = ${JSON.stringify(topFindings)},
      pages_scanned = ${counts.snapshots},
      total_findings = ${counts.findings},
      cost_usd = ${estimatedCostUsd.toFixed(4)},
      completed_at = ${completedAt.toISOString()}
    WHERE id = ${auditId} AND status = 'running'
  `);

  // Post-audit profile + rules-fired write-through. Fire-and-forget so a
  // slow Neon write can't push the route past Vercel's response budget;
  // the writer itself is fail-soft. The snapshot-read is also wrapped in
  // try/catch — without that guard a Neon timeout or empty-string siteId
  // would propagate out of the callback and silently skip the entire
  // write-through, undoing the declared fail-soft contract.
  after(async () => {
    try {
      // One extra query for richer industry signal — the latest snapshot's
      // meta usually has the strongest classification hint after the URL.
      let snapData:
        | { meta?: { title?: string | null; description?: string | null }; headings?: Array<{ text: string }> }
        | undefined;
      try {
        const snapResult = await db.execute<{ data: { meta?: { title?: string | null; description?: string | null }; headings?: Array<{ text: string }> } }>(sql`
          SELECT data FROM phase2_page_snapshots
          WHERE site_id = ${siteId}
          ORDER BY fetched_at DESC
          LIMIT 1
        `);
        snapData = snapResult.rows[0]?.data;
      } catch (err) {
        // Snapshot read failed — degrade to URL-only industry derivation
        // rather than skipping the entire write-through.
        console.error('[audit/run] snapshot read for industry failed', {
          auditId: audit.id,
          siteId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const industry = deriveIndustry(audit.url, {
        title: snapData?.meta?.title ?? null,
        description: snapData?.meta?.description ?? null,
        headings: snapData?.headings?.slice(0, 3).map(h => h.text) ?? [],
      });

      await recordAuditUserActivity({
        auditId: audit.id,
        siteId,
        firedRules: dbFindings.map(f => ({ findingId: f.id, ruleId: f.ruleId })),
        generatedAt: completedAt,
        industry,
      });
    } catch (err) {
      // recordAuditUserActivity is already fail-soft, but defensively catch
      // anything unexpected so an after() exception never reaches the
      // runtime (where it would be invisible since the response is sent).
      console.error('[audit/run] post-audit write-through failed', {
        auditId: audit.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return NextResponse.json({
    status: 'done',
    domain: audit.domain,
    pagesScanned: counts.snapshots,
    totalFindings: counts.findings,
  });
}

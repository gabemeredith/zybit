/**
 * Re-run the fix-preview pipeline against an existing public audit row and
 * resend the report email. Lets us verify fix-preview code changes against
 * real audit data without re-running the full crawl/insights pipeline.
 *
 * Usage:
 *   npx tsx scripts/regenerate-fix-previews-and-resend.ts --to me@example.com --id pub_abc123
 *   npx tsx scripts/regenerate-fix-previews-and-resend.ts --to me@example.com --domain stripe.com
 *   npx tsx scripts/regenerate-fix-previews-and-resend.ts --to me@example.com --recent 1
 */

import 'dotenv/config';
import { getDb } from '@/lib/db/client';
import { publicAudits, zybitFindings } from '@/lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  sendAuditReportEmail,
  type AuditFindingForEmail,
  type AuditReport,
} from '@/lib/email/auditReportEmail';
import { PUBLIC_AUDIT_RULE_COUNT } from '@/lib/audit/publicAuditRuleCount';
import { severityFromScore, formatAuditDate } from '@/lib/audit/auditReportFormatting';
import { generateFixPreviews } from '@/lib/audit/fixPreview';

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

  // Force fix-preview generation even if the env var isn't set locally —
  // this script's whole purpose is to regenerate previews.
  if (process.env.AUDIT_FIX_PREVIEW_ENABLED !== '1') {
    console.log('[note] forcing AUDIT_FIX_PREVIEW_ENABLED=1 for this run');
    process.env.AUDIT_FIX_PREVIEW_ENABLED = '1';
  }

  for (const audit of rows) {
    console.log(`\n=== ${audit.id} — ${audit.domain} ===`);
    const stored = (audit.findings ?? []) as Array<Record<string, unknown>>;
    if (stored.length === 0) {
      console.error('  no stored findings — skipping');
      continue;
    }

    // The `publicAudits` row doesn't carry org/site IDs. Override the
    // pipeline's domain + design lookups with the data we already have from
    // the stored audit row, and no-op `persist` so we don't double-write
    // findings on the real `zybit_findings` rows.
    let regenerated = false;
    const previewsByFindingId = new Map<
      string,
      { beforeUrl: string; afterUrl: string | null; tier: 1 | 2 | 3; rationale: string | null }
    >();
    // Track which findings the orchestrator ran for — so we can distinguish
    // "no preview because we never tried" (fall back to stored URL) from
    // "no preview because the orchestrator explicitly declined" (e.g.
    // rule-skipped, no-html, all tiers bailed → null out the URLs so we
    // don't ship the stale cached pair).
    const attemptedFindingIds = new Set<string>();

    console.log(`  regenerating fix-previews for ${stored.length} stored findings…`);

    // The persisted `publicAudits.findings` JSON is the email projection and
    // does NOT include `pathRef`. Look the canonical rows up in
    // `forge_findings` by id so the per-finding screenshot hits the right
    // page (otherwise everything renders the homepage).
    const findingIds = stored.slice(0, 4).map((f, i) => String(f.id ?? `f${i}`));
    const dbRows = findingIds.length
      ? await db
          .select({
            id: zybitFindings.id,
            pathRef: zybitFindings.pathRef,
            ruleId: zybitFindings.ruleId,
            prescription: zybitFindings.prescription,
            title: zybitFindings.title,
          })
          .from(zybitFindings)
          .where(inArray(zybitFindings.id, findingIds))
      : [];
    const dbById = new Map(dbRows.map((r) => [r.id, r]));

    try {
      const outcomes = await generateFixPreviews(
        {
          organizationId: 'regen-script',
          siteId: 'regen-script',
          auditUrl: audit.url,
          findings: stored.slice(0, 4).map((f, i) => {
            const id = String(f.id ?? `f${i}`);
            const dbRow = dbById.get(id);
            const pathRef = dbRow?.pathRef ?? '/';
            const dbPrescription = dbRow?.prescription ?? null;
            return {
              id,
              ruleId: String(dbRow?.ruleId ?? f.ruleId ?? 'unknown'),
              title: String(dbRow?.title ?? f.title ?? ''),
              pathRef,
              // Prefer the canonical prescription from the DB row — the email
              // projection mangles whyItMatters / whyItWorks into different
              // fields and we want the advisor to see the original copy.
              prescription: dbPrescription ?? {
                whatToChange: String(f.whatToChange ?? ''),
                whyItWorks: String((f.whyItWorks as string | undefined) ?? ''),
                experimentVariantDescription: String(
                  (f.experimentVariantDescription as string | undefined) ?? '',
                ),
                ...(typeof f.whyItMatters === 'string' ? { whyItMatters: f.whyItMatters } : {}),
              },
            };
          }),
        },
        {
          lookupDomain: async () => audit.domain,
          lookupDesign: async () => null,
          lookupCtaVocabulary: async () => [],
          persist: async () => {
            /* no DB writes from the regen script */
          },
        },
      );
      for (const outcome of outcomes) {
        attemptedFindingIds.add(outcome.findingId);
        console.log(
          `    ${outcome.findingId.slice(0, 12)}… → ${outcome.preview ? `tier ${outcome.preview.tier}` : `skipped (${outcome.reason ?? 'no preview'})`}`,
        );
        if (outcome.preview) {
          previewsByFindingId.set(outcome.findingId, {
            beforeUrl: outcome.preview.beforeUrl,
            afterUrl: outcome.preview.afterUrl,
            tier: outcome.preview.tier,
            rationale: outcome.preview.rationale,
          });
        }
      }
      regenerated = true;
    } catch (err) {
      console.error(
        `  generateFixPreviews threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const findings: AuditFindingForEmail[] = stored.slice(0, 4).map((f, i) => {
      const id = String(f.id ?? `f${i}`);
      const fresh = previewsByFindingId.get(id);
      const attempted = attemptedFindingIds.has(id);
      // If we attempted regen but got no preview (rule-skipped, no-html,
      // all tiers bailed) — explicitly null out so we don't ship the stale
      // cached pair. Only fall back to stored URLs when we never tried.
      const useStored = !attempted && !fresh;
      return {
        id,
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
        screenshotBeforeUrl: fresh
          ? fresh.beforeUrl
          : useStored
            ? (f.screenshotBeforeUrl as string | null | undefined) ?? null
            : null,
        screenshotAfterUrl: fresh
          ? fresh.afterUrl
          : useStored
            ? (f.screenshotAfterUrl as string | null | undefined) ?? null
            : null,
        fixPreviewTier: fresh
          ? fresh.tier
          : useStored
            ? (f.fixPreviewTier as 1 | 2 | 3 | null | undefined) ?? null
            : null,
        fixRationale: fresh
          ? fresh.rationale
          : useStored
            ? (f.fixRationale as string | null | undefined) ?? null
            : null,
      };
    });

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

    console.log(
      `  sending (${findings.length} findings, ${regenerated ? 'fresh' : 'cached'} previews) → ${to}`,
    );
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

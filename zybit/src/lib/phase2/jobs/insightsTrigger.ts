/**
 * Volume-triggered insights refresh, shared by every pull-sync cron
 * (PostHog, GA4, ...). After a sync inserts new events for a site, this
 * decides whether enough new sessions have accumulated to re-run the
 * Phase 2 insights pipeline and upsert fresh findings.
 *
 * Extracted from the PostHog cron so the GA4 cron behaves identically;
 * the two crons are the only callers.
 */

import { createHash } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { zybitSiteMeta, zybitFindings } from '@/lib/db/schema';
import { runPhase2InsightsPipeline } from '@/lib/phase2';
import type { AuditFinding } from '@/lib/phase2/rules/types';

/** Deterministic finding PK (mirrors /api/dashboard/findings/route.ts). */
export function findingPk(siteId: string, ruleId: string, pathRef: string | null): string {
  const raw = `${siteId}|${ruleId}|${pathRef ?? '__site__'}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export async function countSiteSessions(siteId: string): Promise<number> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT COUNT(DISTINCT session_id) AS cnt FROM phase1_events WHERE site_id = ${siteId}`,
  );
  const rows = result.rows as Array<{ cnt: string | number }>;
  return Number(rows[0]?.cnt ?? 0);
}

async function upsertFindings(
  organizationId: string,
  siteId: string,
  auditFindings: AuditFinding[],
  windowStart: number,
  windowEnd: number,
): Promise<number> {
  if (auditFindings.length === 0) return 0;
  const db = getDb();
  const now = new Date();

  const values = auditFindings.map((f) => ({
    id: findingPk(siteId, f.ruleId, f.pathRef),
    organizationId,
    siteId,
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    priorityScore: f.priorityScore,
    pathRef: f.pathRef,
    title: f.title,
    summary: f.summary,
    recommendation: f.recommendation,
    evidence: f.evidence,
    refs: f.refs ?? null,
    learnAdjustment: f.learnAdjustment ?? null,
    status: 'open' as const,
    lastSeenAt: now,
    insightWindowStart: new Date(windowStart),
    insightWindowEnd: new Date(windowEnd),
  }));

  await db
    .insert(zybitFindings)
    .values(values)
    .onConflictDoUpdate({
      target: zybitFindings.id,
      set: {
        severity: sql`excluded.severity`,
        confidence: sql`excluded.confidence`,
        priorityScore: sql`excluded.priority_score`,
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        recommendation: sql`excluded.recommendation`,
        evidence: sql`excluded.evidence`,
        refs: sql`excluded.refs`,
        learnAdjustment: sql`excluded.learn_adjustment`,
        lastSeenAt: sql`excluded.last_seen_at`,
        insightWindowStart: sql`excluded.insight_window_start`,
        insightWindowEnd: sql`excluded.insight_window_end`,
        updatedAt: now,
      },
    });

  return auditFindings.length;
}

export interface InsightsTriggerResult {
  insightsTriggered: boolean;
  insightsSynced: number;
  sessionDelta: number;
}

/**
 * Re-run insights for a site when new-session volume since the last run
 * crosses the per-site threshold. Idempotent: only mutates `zybit_site_meta`
 * when it actually runs (or to initialise a brand-new site).
 */
export async function maybeRunInsightsForSite(args: {
  organizationId: string;
  siteId: string;
}): Promise<InsightsTriggerResult> {
  const { organizationId, siteId } = args;
  const db = getDb();
  const now = new Date();

  const [currentSessions, metaRows] = await Promise.all([
    countSiteSessions(siteId),
    db.select().from(zybitSiteMeta).where(eq(zybitSiteMeta.siteId, siteId)).limit(1),
  ]);

  const meta = metaRows[0] ?? null;
  const prevSessions = meta?.sessionCountAtLastRun ?? 0;
  const threshold = meta?.insightThreshold ?? 100;
  const sessionDelta = currentSessions - prevSessions;
  const shouldRunInsights = sessionDelta >= threshold;

  if (shouldRunInsights) {
    const endMs = Date.now();
    const startMs = endMs - 7 * 86_400_000;
    const window = {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    };

    const insightsResult = await runPhase2InsightsPipeline({
      organizationId,
      siteId,
      window,
      maxFindings: 25,
    });

    const auditFindings = (insightsResult.auditReport?.findings ?? []) as AuditFinding[];
    const insightsSynced = await upsertFindings(
      organizationId,
      siteId,
      auditFindings,
      startMs,
      endMs,
    );

    await db
      .insert(zybitSiteMeta)
      .values({
        siteId,
        organizationId,
        sessionCountAtLastRun: currentSessions,
        insightThreshold: threshold,
        lastInsightRunAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: zybitSiteMeta.siteId,
        set: {
          sessionCountAtLastRun: currentSessions,
          lastInsightRunAt: now,
          updatedAt: now,
        },
      });

    return { insightsTriggered: true, insightsSynced, sessionDelta };
  }

  if (!meta) {
    await db
      .insert(zybitSiteMeta)
      .values({
        siteId,
        organizationId,
        sessionCountAtLastRun: 0,
        insightThreshold: threshold,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  return { insightsTriggered: false, insightsSynced: 0, sessionDelta };
}

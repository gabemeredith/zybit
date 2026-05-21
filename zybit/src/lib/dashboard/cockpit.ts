import { and, count, desc, eq, inArray, max } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase2PageSnapshots, zybitExperiments, zybitFindings } from '@/lib/db/schema';
import { createPhase1Repository } from '@/lib/phase1';
import { buildInsightInputFromEvents, runInsightInputGate } from '@/lib/phase2';
import { snapshotStaleDays } from '@/lib/phase2/snapshots/refresh';
import type { RollupContext } from '@/lib/phase2/types';

export interface CockpitIntegration {
  id: string;
  provider: string;
  status: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
}

export interface CockpitTopFinding {
  id: string;
  title: string;
  summary: string;
  severity: string;
  priorityScore: number;
  pathRef: string | null;
}

export interface CockpitData {
  site: { id: string; name: string; domain: string } | null;
  pipeline: {
    integrations: CockpitIntegration[];
    lastSync: string | null;
    healthy: boolean;
    /** Canonical events ingested for this site in the last 7 days. */
    eventCount7d: number;
  } | null;
  gate: {
    trustworthy: boolean;
    sessionCount7d: number;
    warnings: Array<{ code: string; level: string; message: string }>;
  } | null;
  findings: {
    openCount: number;
    topFinding: CockpitTopFinding | null;
  };
  experiments: {
    runningCount: number;
    totalCount: number;
    /**
     * When experiment results were last refreshed. The compute-outcomes
     * cron bumps `updatedAt` on every running/concluded experiment each
     * pass, so MAX(updatedAt) is the measurement-freshness signal (Zybit-086).
     */
    lastComputedAt: string | null;
  };
  /**
   * Snapshot freshness (Zybit-023). MAX(fetchedAt) across the site's page
   * snapshots, and whole-days since — surfaced so a stale Understand layer
   * is visible to the PM. Null when the site has no snapshots yet.
   */
  snapshots: {
    lastSnapshotAt: string | null;
    staleDays: number | null;
  };
  lastInsightAt: string | null;
}

const SESSION_DISPLAY_THRESHOLD = 100;

export { SESSION_DISPLAY_THRESHOLD };

export type IntegrationHealthState = 'watching' | 'no-data' | 'degraded' | 'disconnected';

export interface IntegrationHealth {
  state: IntegrationHealthState;
  label: string;
  tone: 'green' | 'amber' | 'red' | 'gray';
}

/** Sync older than this is treated as stale (connector cron runs hourly). */
const STALE_SYNC_MS = 2 * 60 * 60 * 1000;

/**
 * Pure: classify a connected integration into a PM-readable health state.
 * "Zybit is watching" vs "No data yet" vs "Degraded" vs "Disconnected".
 */
export function deriveIntegrationHealth(
  integration: { status: string; lastSyncedAt: string | null; lastErrorCode: string | null },
  now: number = Date.now(),
): IntegrationHealth {
  if (integration.status === 'disabled') {
    return { state: 'disconnected', label: 'Disconnected', tone: 'gray' };
  }
  if (integration.lastErrorCode || integration.status === 'error') {
    return {
      state: 'degraded',
      label: integration.lastErrorCode
        ? `Degraded — ${integration.lastErrorCode}`
        : 'Degraded',
      tone: 'red',
    };
  }
  if (!integration.lastSyncedAt) {
    return { state: 'no-data', label: 'No data yet', tone: 'amber' };
  }
  const age = now - new Date(integration.lastSyncedAt).getTime();
  if (Number.isFinite(age) && age > STALE_SYNC_MS) {
    return { state: 'degraded', label: 'Degraded — sync stale', tone: 'amber' };
  }
  return { state: 'watching', label: 'Zybit is watching', tone: 'green' };
}

export async function getCockpitData(organizationId: string): Promise<CockpitData> {
  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId, limit: 1 });
  const site = sites[0] ?? null;

  if (!site) {
    return {
      site: null,
      pipeline: null,
      gate: null,
      findings: { openCount: 0, topFinding: null },
      experiments: { runningCount: 0, totalCount: 0, lastComputedAt: null },
      snapshots: { lastSnapshotAt: null, staleDays: null },
      lastInsightAt: null,
    };
  }

  const now = Date.now();
  const window7d = {
    start: new Date(now - 7 * 86_400_000).toISOString(),
    end: new Date(now).toISOString(),
  };

  const [
    integrations,
    events,
    config,
    openFindingRows,
    topFindingRows,
    experimentRows,
    experimentComputedRows,
    snapshotFreshnessRows,
  ] = await Promise.all([
      repository.listIntegrations({ organizationId, siteId: site.id }),
      repository.listEventsInWindow({ organizationId, siteId: site.id, window: window7d }),
      repository.getPhase2SiteConfig({ organizationId, siteId: site.id }),
      getDb()
        .select({ count: count() })
        .from(zybitFindings)
        .where(and(eq(zybitFindings.siteId, site.id), eq(zybitFindings.status, 'open'))),
      getDb()
        .select({
          id: zybitFindings.id,
          title: zybitFindings.title,
          summary: zybitFindings.summary,
          severity: zybitFindings.severity,
          priorityScore: zybitFindings.priorityScore,
          pathRef: zybitFindings.pathRef,
        })
        .from(zybitFindings)
        .where(and(eq(zybitFindings.siteId, site.id), eq(zybitFindings.status, 'open')))
        .orderBy(desc(zybitFindings.priorityScore))
        .limit(1),
      getDb()
        .select({ status: zybitExperiments.status, n: count() })
        .from(zybitExperiments)
        .where(eq(zybitExperiments.siteId, site.id))
        .groupBy(zybitExperiments.status),
      getDb()
        .select({ lastComputedAt: max(zybitExperiments.updatedAt) })
        .from(zybitExperiments)
        .where(
          and(
            eq(zybitExperiments.siteId, site.id),
            inArray(zybitExperiments.status, ['running', 'completed', 'stopped']),
          ),
        ),
      getDb()
        .select({ lastFetchedAt: max(phase2PageSnapshots.fetchedAt) })
        .from(phase2PageSnapshots)
        .where(eq(phase2PageSnapshots.siteId, site.id)),
    ]);

  const resolvedConfig = config ?? {
    siteId: site.id,
    organizationId,
    cohortDimensions: [],
    onboardingSteps: [],
    ctas: [],
    narratives: [],
    updatedAt: new Date(0).toISOString(),
  };

  const ctx: RollupContext = {
    siteId: site.id,
    window: window7d,
    config: resolvedConfig,
    events,
  };
  const rollup = buildInsightInputFromEvents(ctx, new Date().toISOString());
  const gate = runInsightInputGate({ rollup, config: resolvedConfig, window: window7d });

  const lastSync =
    integrations
      .map((i) => i.lastSyncedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  const openCount = Number((openFindingRows[0] as { count: number } | undefined)?.count ?? 0);
  const topFinding = topFindingRows[0] ?? null;

  const runningCount = Number(
    experimentRows.find((r) => r.status === 'running')?.n ?? 0
  );
  const totalCount = experimentRows.reduce((sum, r) => sum + Number(r.n), 0);

  const rawLastComputed = experimentComputedRows[0]?.lastComputedAt ?? null;
  const lastComputedAt =
    rawLastComputed instanceof Date
      ? rawLastComputed.toISOString()
      : rawLastComputed
        ? new Date(rawLastComputed).toISOString()
        : null;

  const rawLastSnapshot = snapshotFreshnessRows[0]?.lastFetchedAt ?? null;
  const lastSnapshotDate =
    rawLastSnapshot instanceof Date
      ? rawLastSnapshot
      : rawLastSnapshot
        ? new Date(rawLastSnapshot)
        : null;
  const lastSnapshotAt = lastSnapshotDate ? lastSnapshotDate.toISOString() : null;
  const staleDays = snapshotStaleDays(lastSnapshotDate);

  const lastInsightAt =
    topFinding
      ? (
          await getDb()
            .select({ lastSeenAt: zybitFindings.lastSeenAt })
            .from(zybitFindings)
            .where(eq(zybitFindings.siteId, site.id))
            .orderBy(desc(zybitFindings.lastSeenAt))
            .limit(1)
        )[0]?.lastSeenAt?.toISOString() ?? null
      : null;

  return {
    site: { id: site.id, name: site.name, domain: site.domain },
    pipeline: {
      integrations: integrations.map((i) => ({
        id: i.id,
        provider: i.provider,
        status: i.status,
        lastSyncedAt: i.lastSyncedAt ?? null,
        lastErrorCode: i.lastErrorCode ?? null,
      })),
      lastSync,
      healthy: integrations.length > 0 && integrations.every((i) => !i.lastErrorCode),
      eventCount7d: events.length,
    },
    gate: {
      trustworthy: gate.ok,
      sessionCount7d: rollup.insightInput.totals.sessions,
      warnings: gate.warnings.map((w) => ({
        code: w.code,
        level: w.level,
        message: w.message,
      })),
    },
    findings: { openCount, topFinding },
    experiments: { runningCount, totalCount, lastComputedAt },
    snapshots: { lastSnapshotAt, staleDays },
    lastInsightAt,
  };
}

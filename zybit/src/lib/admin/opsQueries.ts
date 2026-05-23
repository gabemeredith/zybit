/**
 * Operator dashboard read queries (Zybit-156).
 *
 * The first incident-response surface for the team: one query per row-family
 * fetches the cross-org snapshot needed to answer "is this customer's data
 * flowing?" without SSHing into Neon. Read-only and intentionally narrow —
 * see `docs/sprints/operator-dashboard.md` for scope and `OpsTable.tsx` for
 * the presentation.
 *
 * Mutations live elsewhere (or nowhere yet) — this module is queries only.
 */

import { sql, eq, and } from 'drizzle-orm';
import type { getDb } from '@/lib/db/client';
import {
  organizations,
  phase1Sites,
  phase1Events,
  phase2Integrations,
  phase2PageSnapshots,
  zybitFindings,
} from '@/lib/db/schema';

export interface OpsRow {
  organizationId: string;
  organizationName: string;
  plan: string;
  siteId: string;
  siteDomain: string;
  siteCreatedAt: string;
  connectors: OpsConnector[];
  /** ISO string of MAX(occurredAt) across this site's events. null if no events ever. */
  lastEventAt: string | null;
  /** Days since the newest snapshot for the site. null if no snapshots. */
  snapshotAgeDays: number | null;
  snapshotCount: number;
  openFindings: number;
}

export interface OpsConnector {
  provider: string;
  status: string;
  consecutiveFailures: number;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
}

type Db = ReturnType<typeof getDb>;

const MAX_ROWS = 200;

export async function listOpsRows(db: Db): Promise<OpsRow[]> {
  // One-shot org+site join, then five focused per-site queries kept small by
  // the row cap. The cap exists so the dashboard remains fast at MVP scale;
  // we will replace with proper pagination once the table outgrows it.
  const baseRows = await db
    .select({
      siteId: phase1Sites.id,
      siteDomain: phase1Sites.domain,
      siteCreatedAt: phase1Sites.createdAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      plan: organizations.plan,
    })
    .from(phase1Sites)
    .innerJoin(organizations, eq(organizations.id, phase1Sites.organizationId))
    .orderBy(phase1Sites.createdAt)
    .limit(MAX_ROWS);

  if (baseRows.length === 0) return [];
  const siteIds = baseRows.map((r) => r.siteId);

  const [connectorRows, lastEventRows, snapshotRows, findingsRows] = await Promise.all([
    db
      .select({
        siteId: phase2Integrations.siteId,
        provider: phase2Integrations.provider,
        status: phase2Integrations.status,
        consecutiveFailures: phase2Integrations.consecutiveFailures,
        lastSyncedAt: phase2Integrations.lastSyncedAt,
        lastErrorCode: phase2Integrations.lastErrorCode,
      })
      .from(phase2Integrations)
      .where(inSiteIds(phase2Integrations.siteId, siteIds)),
    db
      .select({
        siteId: phase1Events.siteId,
        lastEventAt: sql<Date | null>`MAX(${phase1Events.occurredAt})`.as('last_event_at'),
      })
      .from(phase1Events)
      .where(inSiteIds(phase1Events.siteId, siteIds))
      .groupBy(phase1Events.siteId),
    db
      .select({
        siteId: phase2PageSnapshots.siteId,
        count: sql<number>`COUNT(*)::int`.as('count'),
        newestAt: sql<Date | null>`MAX(${phase2PageSnapshots.fetchedAt})`.as('newest_at'),
      })
      .from(phase2PageSnapshots)
      .where(inSiteIds(phase2PageSnapshots.siteId, siteIds))
      .groupBy(phase2PageSnapshots.siteId),
    db
      .select({
        siteId: zybitFindings.siteId,
        count: sql<number>`COUNT(*)::int`.as('count'),
      })
      .from(zybitFindings)
      .where(
        and(
          inSiteIds(zybitFindings.siteId, siteIds),
          eq(zybitFindings.status, 'open'),
        ),
      )
      .groupBy(zybitFindings.siteId),
  ]);

  const connectorsBySite = groupConnectorsBySite(connectorRows);
  const lastEventBySite = new Map(
    lastEventRows.map((r) => [r.siteId, toIsoOrNull(r.lastEventAt)]),
  );
  const snapshotBySite = new Map(
    snapshotRows.map((r) => [
      r.siteId,
      { count: r.count, newestAt: toIsoOrNull(r.newestAt) },
    ]),
  );
  const findingsBySite = new Map(findingsRows.map((r) => [r.siteId, r.count]));

  const now = Date.now();
  return baseRows.map((row) => {
    const snapshots = snapshotBySite.get(row.siteId) ?? { count: 0, newestAt: null };
    return {
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      plan: row.plan,
      siteId: row.siteId,
      siteDomain: row.siteDomain,
      siteCreatedAt: toIso(row.siteCreatedAt),
      connectors: connectorsBySite.get(row.siteId) ?? [],
      lastEventAt: lastEventBySite.get(row.siteId) ?? null,
      snapshotAgeDays:
        snapshots.newestAt === null
          ? null
          : Math.floor((now - Date.parse(snapshots.newestAt)) / (24 * 60 * 60 * 1000)),
      snapshotCount: snapshots.count,
      openFindings: findingsBySite.get(row.siteId) ?? 0,
    };
  });
}

function inSiteIds<T>(column: T, siteIds: string[]) {
  // drizzle-orm `inArray` works fine but we keep a tiny shim so the query
  // sites are obvious and import surface stays small.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sql`${column as any} = ANY(${siteIds})`;
}

function groupConnectorsBySite(
  rows: Array<{
    siteId: string;
    provider: string;
    status: string;
    consecutiveFailures: number;
    lastSyncedAt: Date | null;
    lastErrorCode: string | null;
  }>,
): Map<string, OpsConnector[]> {
  const out = new Map<string, OpsConnector[]>();
  for (const r of rows) {
    const list = out.get(r.siteId) ?? [];
    list.push({
      provider: r.provider,
      status: r.status,
      consecutiveFailures: r.consecutiveFailures,
      lastSyncedAt: toIsoOrNull(r.lastSyncedAt),
      lastErrorCode: r.lastErrorCode,
    });
    out.set(r.siteId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.provider.localeCompare(b.provider));
  return out;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

// ---------------------------------------------------------------------------
// Pure presentation helpers — exported so the table component and the tests
// share the exact same formatting logic.
// ---------------------------------------------------------------------------

export function formatTimeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export type ConnectorHealth = 'healthy' | 'degraded' | 'disconnected' | 'unknown';

export function connectorHealth(c: OpsConnector): ConnectorHealth {
  if (c.status === 'disconnected') return 'disconnected';
  if (c.status === 'degraded' || c.consecutiveFailures >= 3) return 'degraded';
  if (c.status === 'active' || c.status === 'connected') return 'healthy';
  return 'unknown';
}

export type SiteHealth = 'green' | 'amber' | 'red' | 'inactive';

/**
 * Single-glance verdict for the row. Used by the dashboard to sort the most
 * urgent rows to the top regardless of insertion order.
 */
export function siteHealth(row: OpsRow, now: number = Date.now()): SiteHealth {
  if (row.connectors.length === 0) return 'inactive';
  const anyDisconnected = row.connectors.some((c) => connectorHealth(c) === 'disconnected');
  if (anyDisconnected) return 'red';

  const anyDegraded = row.connectors.some((c) => connectorHealth(c) === 'degraded');
  const eventAgeHours = row.lastEventAt
    ? (now - Date.parse(row.lastEventAt)) / (60 * 60 * 1000)
    : Infinity;
  if (anyDegraded || eventAgeHours > 24) return 'amber';

  return 'green';
}

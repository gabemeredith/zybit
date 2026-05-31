/**
 * Read-only database browser — `GET /lighthouse/api/data/meta` and
 * `GET /lighthouse/api/data/rows`.
 *
 * A dev/admin window onto every row in the database. Read-only by
 * construction: every query is a Drizzle `select` over a hardcoded table
 * allowlist (no raw SQL, no write paths). Shows all orgs (real + Lighthouse
 * synthetic); the org/site selectors narrow the view. Same exposure level as
 * the `/admin/ops` operator dashboard — gated behind the Lighthouse admin
 * password.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { and, count, desc, eq, getTableColumns, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  appUsers,
  organizations,
  phase1Events,
  phase1Sites,
  phase2Integrations,
  phase2PageSnapshots,
  phase2SiteConfigs,
  zybitExperimentOutcomes,
  zybitExperiments,
  zybitFindings,
} from '@/lib/db/schema';
import { requireAuth } from '../auth';

/** Marks how a table is scoped to Lighthouse synthetic data. */
type TableKind = 'org' | 'orgChild' | 'siteChild';

interface TableDef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  label: string;
  kind: TableKind;
  /** Column (JS name) to sort by, newest first. Ignored if absent. */
  orderBy: string;
}

/** The only tables the browser can read. */
const TABLES: Record<string, TableDef> = {
  organizations: { table: organizations, label: 'organizations', kind: 'org', orderBy: 'createdAt' },
  app_users: { table: appUsers, label: 'app_users', kind: 'orgChild', orderBy: 'createdAt' },
  phase1_sites: { table: phase1Sites, label: 'phase1_sites', kind: 'orgChild', orderBy: 'createdAt' },
  phase2_site_configs: {
    table: phase2SiteConfigs,
    label: 'phase2_site_configs',
    kind: 'siteChild',
    orderBy: 'updatedAt',
  },
  phase2_integrations: {
    table: phase2Integrations,
    label: 'phase2_integrations',
    kind: 'siteChild',
    orderBy: 'createdAt',
  },
  phase1_events: { table: phase1Events, label: 'phase1_events', kind: 'siteChild', orderBy: 'createdAt' },
  phase2_page_snapshots: {
    table: phase2PageSnapshots,
    label: 'phase2_page_snapshots',
    kind: 'siteChild',
    orderBy: 'fetchedAt',
  },
  forge_findings: {
    table: zybitFindings,
    label: 'forge_findings (findings)',
    kind: 'siteChild',
    orderBy: 'priorityScore',
  },
  forge_experiments: {
    table: zybitExperiments,
    label: 'forge_experiments',
    kind: 'siteChild',
    orderBy: 'createdAt',
  },
  zybit_experiment_outcomes: {
    table: zybitExperimentOutcomes,
    label: 'zybit_experiment_outcomes',
    kind: 'siteChild',
    orderBy: 'concludedAt',
  },
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * `GET /lighthouse/api/data/meta` — the table allowlist plus the Lighthouse
 * orgs and their sites, so the GUI can build its selectors in one call.
 */
export async function getDataMeta(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;
  const db = getDb();
  const [orgs, sites] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
    db
      .select({ id: phase1Sites.id, name: phase1Sites.name, domain: phase1Sites.domain, organizationId: phase1Sites.organizationId })
      .from(phase1Sites),
  ]);
  const sitesByOrg = new Map<string, Array<{ id: string; name: string; domain: string }>>();
  for (const s of sites) {
    const list = sitesByOrg.get(s.organizationId) ?? [];
    list.push({ id: s.id, name: s.name, domain: s.domain });
    sitesByOrg.set(s.organizationId, list);
  }
  json(res, 200, {
    tables: Object.entries(TABLES).map(([name, def]) => ({ name, label: def.label, kind: def.kind })),
    orgs: orgs.map((o) => ({ ...o, sites: sitesByOrg.get(o.id) ?? [] })),
  });
}

/**
 * `GET /lighthouse/api/data/rows?table=&orgId=&siteId=&page=&pageSize=` —
 * one page of rows from an allowlisted table.
 */
export async function getDataRows(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const tableName = url.searchParams.get('table') ?? '';
  const def = TABLES[tableName];
  if (!def) return json(res, 400, { error: 'unknown_table', detail: tableName });

  const orgId = url.searchParams.get('orgId') || '';
  const siteId = url.searchParams.get('siteId') || '';
  const page = Math.max(0, Number.parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50));

  const cols = getTableColumns(def.table);
  const filters: SQL[] = [];

  // No org chosen → show everything (all orgs, real + synthetic). When an org
  // is picked, narrow to it; `organizations` keys on `id`, everything else on
  // `organizationId`. A site picks further among `siteChild` tables.
  if (orgId) {
    filters.push(def.kind === 'org' ? eq(def.table.id, orgId) : eq(def.table.organizationId, orgId));
  }
  if (def.kind === 'siteChild' && siteId) filters.push(eq(def.table.siteId, siteId));
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters);

  const db = getDb();
  // Newest-first when the order column exists; the builder's type narrows once
  // `.orderBy` is chained, so branch the whole chain rather than reassign.
  const rowsPromise =
    def.orderBy in cols
      ? db.select().from(def.table).where(where).orderBy(desc(cols[def.orderBy])).limit(pageSize).offset(page * pageSize)
      : db.select().from(def.table).where(where).limit(pageSize).offset(page * pageSize);
  const [rows, totalRes] = await Promise.all([
    rowsPromise,
    db.select({ value: count() }).from(def.table).where(where),
  ]);

  json(res, 200, {
    table: tableName,
    columns: Object.keys(cols),
    rows,
    page,
    pageSize,
    total: totalRes[0]?.value ?? 0,
  });
}

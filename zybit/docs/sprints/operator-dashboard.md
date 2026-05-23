# Operator dashboard (Zybit-156) — scope

**Status:** Scoped, not built. **Date:** 2026-05-23.

Today the only "operator visibility" we have is `/app/admin`, which lists
`appUsers` rows for the invite-grant flow (`src/app/admin/page.tsx`). There
is **no cross-org view** of: sync health, last-event timestamps, error-budget
state, plan, snapshot staleness, or how many findings each org has.

For a closed pilot this means: when a customer DMs *"Zybit hasn't shown me
anything in 3 days"*, the on-call engineer has to SSH into Neon and hand-write
SQL. Zybit-156 is the small operator surface that closes that gap.

---

## Scope (MVP — one page, no writes)

A single page at `/app/admin/ops` rendering one table:

| org / site | plan | connectors | last event | error budget | snapshots | findings | actions |
|---|---|---|---|---|---|---|---|
| Acme / acme.com | Starter | PostHog ✅ | 4m ago | 0 fails | 12 (3d old) | 5 open | [view] |
| Beta / beta.io | Growth | Segment ⚠️ degraded | 6h ago | 3 fails | none | 0 open | [view] |

Columns:
- **plan** — `organizations.plan`
- **connectors** — `phase2_integrations.{provider, status}`, dot per provider
- **last event** — `MAX(phase1_events.occurredAt)` per site, relative time
- **error budget** — `phase2_integrations.consecutiveFailures` (the circuit-breaker counter)
- **snapshots** — count + age of newest `phase2_page_snapshots`
- **findings** — `forge_findings` open count per site
- **actions** — `[view]` deep-links to `/app/admin/ops/[siteId]` detail page (later)

### Auth

Same gate as the existing admin page: `ADMIN_COOKIE` env-var check
(`src/lib/admin/cookie.ts`). No new auth model — operator dashboard is for
the Zybit team, not customers.

### Read path

One SQL query per row family — five queries total, all already indexed
because the underlying tables are queried per-org in the live product. Cap
the table at 200 rows; paginate if we ever hit it (we won't this year).

### Out of scope for MVP

- No write actions (no "force resync", no "disable org") in v1. The
  pilot-blocking gap is *visibility*, not control. Add controls only when
  the on-call engineer reports doing the same SQL repeatedly.
- No charts. The table is the deliverable.
- No real-time refresh. Page refresh re-queries.

### File layout

```
src/app/admin/ops/page.tsx            — server component, runs the queries
src/app/admin/ops/OpsTable.tsx        — pure presentational table
src/lib/admin/opsQueries.ts           — five queries, exported pure-ish fns
src/lib/admin/__tests__/opsQueries.test.ts
```

### Effort

About 1.5 dev-days. The queries are routine; the design is a sortable HTML
table; auth is reused.

### Unblocks

- Pilot incident response — "is the customer's data flowing?" answered in
  one click.
- Stripe billing audit — see which orgs are on which plan and whether they
  match the Stripe records (cross-check in a separate one-off script).
- Sales conversations — "this org has 12 connected days and zero open
  findings, why?" becomes inspectable.

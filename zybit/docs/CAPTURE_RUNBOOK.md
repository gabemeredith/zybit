# Headless Capture Runbook

## Overview

The headless capture pipeline (`src/lib/phase2/capture/`) takes real browser screenshots and DOM measurements of a site's pages using a remote Browserless instance. The output — a `PageCapture` artifact — gives audit rules precise bounding boxes, real computed styles, LCP/CLS metrics, and network data instead of the HTML-parser heuristics from snapshots.

Capture is opt-in per deployment via the `capture_v2_enabled` Edge Config flag (or `CAPTURE_V2_ENABLED=1` env var).

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BROWSERLESS_URL` | Yes | WebSocket base URL for your Browserless instance, e.g. `wss://chrome.browserless.io` |
| `BROWSERLESS_KEY` | Yes | Browserless API token appended as `?token=…` |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob token for screenshot storage |
| `CAPTURE_V2_ENABLED` | No | Set to `1` to enable capture when Edge Config is unavailable |
| `FORGE_CRON_SECRET` | Yes | Bearer token for cron route auth (`Authorization: Bearer <secret>`) |
| `CAPTURE_SITE_URL_OVERRIDE` | No | Base URL used by the nightly refresh cron when a site's integration config lacks `siteUrl` |
| `CAPTURE_BUDGET_USD_PER_SITE_DAY` | No | Not used at runtime — budget is stored per-site in `phase2_site_configs.capture_budget_usd_day` (default $1.00) |

---

## Triggering a capture

### Single page (on-demand)
```
POST /api/phase2/capture/run
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "siteId": "site_abc",
  "organizationId": "org_xyz",
  "url": "https://example.com/pricing"
}
```

Returns `{ runId, captured, failedBreakpoints, totalCostUsd }`.

### Batch (fire-and-forget)
```
POST /api/phase2/capture/batch
Authorization: Bearer <api-key>

{
  "siteId": "site_abc",
  "organizationId": "org_xyz",
  "entries": [
    { "url": "https://example.com/", "pathRef": "/" },
    { "url": "https://example.com/pricing", "pathRef": "/pricing" }
  ]
}
```

Returns `{ runId, totalPaths }` immediately. Poll `/api/phase2/capture/status/<runId>` for progress.

### Nightly cron
Runs at 02:00 UTC. Re-captures any path whose most recent capture is older than 23 hours, up to 10 paths per site, respecting the daily budget cap.

---

## Budget

Each site has a `capture_budget_usd_day` column in `phase2_site_configs` (default $1.00/day). Cost is tracked in `forge_site_meta.capture_spend_day_usd` with automatic daily reset. Update a site's budget:

```sql
UPDATE phase2_site_configs
SET capture_budget_usd_day = 5.00
WHERE site_id = 'site_abc';
```

Cost estimate: ~$0.00035/second of browser time, minimum $0.001 per capture.

---

## Adding fixture files

Fixtures live in `src/lib/phase2/__fixtures__/captures/<site-slug>/<path-slug>.json`.

Each fixture is a full `PageCapture` JSON object. To create one from a real capture:

1. Run the capture API against a staging URL.
2. Read the returned capture data from `phase2_page_captures.capture_data` in the DB.
3. Save the JSON to the fixtures directory.
4. Write a test in `src/lib/phase2/capture/__tests__/` importing the fixture.

Fixtures must not contain real customer data. Use anonymised or synthetic sites only.

---

## Debugging failed captures

### Check the run status
```
GET /api/phase2/capture/status/<runId>
```

### Common failure codes

| Code | Cause | Fix |
|---|---|---|
| `ALL_BREAKPOINTS_FAILED` | Browserless unreachable or site 4xx/5xx | Check `BROWSERLESS_URL`/token; confirm site URL is reachable from Browserless region |
| `BUDGET_EXCEEDED` | Daily spend cap hit | Wait for midnight UTC reset or increase `capture_budget_usd_day` |
| `FEATURE_DISABLED` | `capture_v2_enabled` flag is off | Toggle flag in Vercel Edge Config dashboard |
| `ECONNRESET` / `timeout` on connect | Network blip; browser.ts retries 3× with backoff | Usually self-healing; check Browserless status page if persistent |

### Increasing log verbosity

All capture log lines use `service: 'capture-record'` or `service: 'capture-cron'`. Filter in your log aggregator:

```
service:(capture-record OR capture-cron)
```

---

## Tuning

- **Breakpoints**: by default captures desktop + mobile + tablet. Pass `breakpoints: ["desktop"]` to reduce cost for on-demand calls.
- **Page timeout**: `PAGE_TIMEOUT_MS = 25000` in `record.ts`. Increase if capturing SPAs with long hydration times.
- **Concurrency**: `globalBrowserSemaphore = new Semaphore(16)` in `browser.ts`. The nightly cron processes sites sequentially so this is only relevant for parallel batch calls.

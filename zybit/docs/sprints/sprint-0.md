# Sprint 0 — Verification & Hardening

**Duration:** 1 week
**Goal:** Confirm everything that's "built" actually works under live conditions. No new features. Gate: core loop verified end-to-end with real credentials.
**E2E smoke test (Zybit-120) runs in parallel — does NOT gate this sprint's completion.**

---

## Gate criteria

- [ ] Stripe: checkout → webhook → plan-write → 402 enforcement verified with stripe-cli
- [ ] Auth rate limiting live on `/api/auth/request-link`
- [ ] Edge Config kill-switch write confirmed working (< 30s propagation)
- [ ] Browserless live-verified against 3 real SPAs; latency + cost documented
- [ ] Snapshot refresh cadence policy implemented
- [ ] Experiment collision overlap-with-warning implemented

---

## Zybit-114 — Live Stripe round-trip verification
**Estimate:** 1d | **Owner:** —

**Context:** Code path was audited and two round-trip bugs fixed (post-checkout redirect, in-process plan cache). Only live verification with real test keys remains.

**Steps:**
1. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH` in `.env.local`
2. `stripe listen --forward-to localhost:3000/api/billing/webhook`
3. POST `/api/billing/checkout` → complete test checkout → assert `organizations.plan` updated in Neon
4. Assert `checkPlanLimit` returns 402 once site-seat limit exceeded for that plan tier
5. `stripe trigger customer.subscription.deleted` → assert downgrade to `starter`
6. `stripe trigger customer.subscription.updated` with higher `price_id` → assert plan upgrade reflected

**Files:** `src/app/api/billing/webhook/route.ts`, `src/lib/billing/checkPlanLimit.ts`

**Acceptance:** All 6 Stripe events flow without 5xx. DB state matches expected plan. `checkPlanLimit` returns 402 past tier limit; returns 200 after upgrade.

---

## Zybit-115 — Auth rate limiting
**Estimate:** 1d | **Owner:** —

**Context:** B2B security teams audit login flows. Magic-link endpoint currently has no rate limit — spammable, embarrassing to discover in a sales process.

**Steps:**
1. Add `zybit_rate_limits (key TEXT PRIMARY KEY, count INT, reset_at TIMESTAMPTZ)` to schema + migration
2. In `/api/auth/request-link/route.ts`:
   - Per-email limit: max 3 requests / 10 min. Key = `email:{sha256(email)}`
   - Per-IP limit: max 10 requests / 10 min. Key = `ip:{x-forwarded-for}`
   - Dedup: if an unexpired token for this email already exists in `zybit_magic_links`, return 200 without generating a new one (prevents inbox spam on repeated clicks)
   - On limit exceeded: return `429` with `Retry-After` header and human-readable message

**Files:**
- `src/app/api/auth/request-link/route.ts`
- `src/lib/db/schema.ts` — add `zybit_rate_limits` table
- `drizzle/` — new migration

**Acceptance:** 4th request for same email within 10 min → 429. Duplicate request reuses existing token (no second Resend call). IP throttle blocks > 10 distinct email attempts in 10 min.

---

## Zybit-116 — Edge Config kill-switch write path
**Estimate:** 1d | **Owner:** —

**Context:** Proxy reads `experiment.status` from DB (via `/api/proxy/config` fallback when Edge Config miss). When an experiment is stopped, the status change needs to propagate to EC within 30s for the kill switch to be usable in an emergency.

**Steps:**
1. In `computeOutcomes.ts`, find the block where `status` is set to `'stopped'`
2. Immediately after the DB write, call `writeExperimentToEdgeConfig(experimentId, { status: 'stopped' })`
3. `writeExperimentToEdgeConfig` in `src/lib/experiments/proxy/config.ts` using `@vercel/edge-config` client
4. Make it best-effort (log failure, don't throw — the DB write is the source of truth)
5. Verify: stop a test experiment manually, confirm proxy returns control variant within 30s

**Files:** `src/lib/experiments/computeOutcomes.ts`, `src/lib/experiments/proxy/config.ts`

**Acceptance:** Stop experiment → proxy returns unmodified HTML within 30s. EC write failure logged but doesn't block outcome computation.

---

## Zybit-117 — Browserless live verification
**Estimate:** 1–2d | **Owner:** —

**Context:** `browserFetcher.ts` has unit tests but has never been run against live sites with a real `BROWSERLESS_TOKEN`.

**Steps:**
1. Set `BROWSERLESS_TOKEN` in `.env.local`
2. Run fetcher against 3 test sites: a Next.js App Router page (SSR with client components), a React SPA, a Vue SPA
3. Measure: latency, content completeness (headings found / expected), cost per page
4. Test `isSpaHtml()` classification accuracy against all 3
5. Document findings in `docs/CAPTURE_RUNBOOK.md` (already exists — append section)
6. Fix any failures found (timeout config, UA issues, bot detection workarounds)

**Files:** `src/lib/phase2/snapshots/browserFetcher.ts`, `src/lib/phase2/snapshots/fetcher.ts`, `docs/CAPTURE_RUNBOOK.md`

**Acceptance:** All 3 captures complete < 10s, < $0.05/page. Content completeness > 80% for all 3. `isSpaHtml()` correctly classifies all 3.

---

## Zybit-118 — Snapshot refresh cadence policy
**Estimate:** 0.5d | **Owner:** —

**Policy:**
- Active site (running experiment OR insights in last 14d) → nightly refresh at 2am UTC
- Dormant site → weekly refresh (Sunday 2am UTC)
- Manual trigger always available

**Steps:**
1. In `sync-refresh-captures` cron handler, add dormancy check: skip re-fetch if `lastInsightsAt < 14d` AND no running experiments for this site
2. Add `snapshotRefreshedAt` to cockpit API response (`/api/dashboard/status`)
3. Render "Snapshot refreshed N days ago" in `CockpitView.tsx` integration health section

**Files:** `src/app/api/phase2/cron/sync-refresh-captures/route.ts`, `src/app/api/dashboard/status/route.ts`, `src/components/app/CockpitView.tsx`

**Acceptance:** Dormant site skips nightly re-fetch (verifiable via structured log). Active site refreshes nightly. Cockpit shows snapshot age.

---

## Zybit-119 — Experiment overlap: warn-and-proceed
**Estimate:** 1d | **Owner:** —

**Decision:** Overlap allowed by default. Second experiment on the same page triggers mandatory acknowledgment. `overlappingExperimentIds` stored on the experiment so outcomes can be flagged.

**Steps:**
1. Add `overlappingExperimentIds: text('overlapping_experiment_ids').array().default([])` to `forge_experiments` schema + migration
2. In experiment start handler (`POST /api/dashboard/experiments`):
   - Query for other `running` experiments on same `(siteId, pathRef)`
   - If found: return `200` with `{ requiresAcknowledgment: true, overlappingExperiments: [...] }` instead of starting immediately
   - Client sends second request with `{ acknowledgeOverlap: true }` → start proceeds, `overlappingExperimentIds` populated
3. In `ExperimentControls.tsx`: render yellow warning modal when `requiresAcknowledgment: true` — name the conflicting experiment, explain the risk, require explicit confirmation button

**Files:** `src/app/api/dashboard/experiments/route.ts`, `src/lib/db/schema.ts`, `src/components/app/ExperimentControls.tsx`, new migration

**Acceptance:** Starting experiment on a page with a running experiment → warning modal names the conflict. Explicit confirmation → experiment starts with `overlappingExperimentIds` populated. Outcome display flags overlapping experiments with amber badge.

---

## Zybit-120 — E2E smoke test (parallel track)
**Estimate:** 4–5d | **Owner:** —
**Note:** Runs in parallel with Sprint 1. Does NOT gate Sprint 0 or the demo.

**What to build:** A CI-runnable Vitest test covering the full loop against a real Neon test schema.

**Loop to cover:**
1. Create org + site via M2M API key
2. POST 50 synthetic events to `/api/intake` (2 cohorts: 30% vs 50% conversion rate)
3. Trigger insights pipeline (`/api/phase2/cron/run-insights`)
4. Assert ≥ 1 finding created with `evidence.length > 0` and `prescription` populated
5. POST experiment brief from finding
6. Assert proxy handler returns modified HTML for a variant-bucketed `_zybit_vid`
7. POST outcome events (conversions for variant > control)
8. Trigger `compute-outcomes` cron
9. Assert `zybit_experiment_outcomes` row created with `result: 'positive'`

**Files to create:**
- `src/tests/e2e/fullLoop.e2e.ts`
- `src/tests/fixtures/syntheticEvents.ts`
- `.github/workflows/e2e.yml` (nightly only; separate from PR CI)

**Acceptance:** Green against clean Neon test DB. Fails loudly (not silently) on any step. CI job runs nightly and pages via Cronitor on failure.

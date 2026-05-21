# Sprint 4 — Observability & Multi-Customer Ops

**Duration:** 1 week
**Goal:** First paying customer is supportable remotely. Incidents can be debugged without SSH access. Broken integrations don't retry silently forever.

---

## Gate criteria

- [ ] Axiom drain connected — all structured logs queryable remotely
- [ ] Connector circuit breaker live — failed integrations pause after threshold
- [ ] Per-cron failure email alert active
- [ ] Operator view shows all orgs, sites, sync health at a glance

---

## Zybit-153 — Axiom log drain
**Estimate:** 1d | **Owner:** —

**What:** Connect Vercel's log drain to Axiom so all structured JSON logs from crons, proxy, and API routes are queryable remotely.

**Steps:**
1. Create Axiom dataset `zybit-prod`
2. Add Vercel log drain: Settings → Log Drains → Axiom endpoint with `AXIOM_TOKEN`
3. Verify structured logger output (`src/lib/observability/logger.ts`) arrives in Axiom with correct fields (`level`, `service`, `message`, `timestamp`)
4. Create 3 Axiom saved queries: (a) cron failures last 24h, (b) proxy 5xx last 1h, (c) connector sync errors by site

**No code changes required** — logger already writes structured JSON. Just wiring.

**Files:** `README.md` (add Axiom setup to env var table)

---

## Zybit-154 — Connector circuit breaker
**Estimate:** 2d | **Owner:** —

**What:** A connector with `consecutiveFailures >= 10` should pause automatically rather than retrying every 30 minutes forever. PM is notified and must manually resume.

**Steps:**
1. In `posthog/sync.ts` and `ga4/sync.ts`, after incrementing `consecutiveFailures`, check: if `>= 10`, set `status: 'paused'` on the integration record and send `sendIntegrationPausedEmail()` (new Resend template)
2. Add `POST /api/phase2/integrations/:id/resume` route — resets `consecutiveFailures` to 0, sets `status: 'active'`
3. Surface paused state in `CockpitView.tsx`: red banner "PostHog sync paused after repeated failures — [Resume]" with the Resume button calling the route
4. Manual resume clears the failure count and immediately triggers a sync attempt

**Files:** `src/lib/phase2/connectors/posthog/sync.ts`, `src/lib/phase2/connectors/ga4/sync.ts`, `src/lib/email/integrationPausedEmail.ts` (new — sent to `asad@getzybit.com`), `src/app/api/phase2/integrations/[id]/resume/route.ts` (new), `src/components/app/CockpitView.tsx`

---

## Zybit-155 — Cron failure email alert
**Estimate:** 1d | **Owner:** —

**What:** When any cron job fails (not just Cronitor timeout — actual error thrown), send an ops alert email. Currently logs to stdout only.

**Steps:**
1. Wrap all cron handlers with a `withCronAlert` higher-order function:
   - On catch: log structured error + call `sendCronFailureAlert({ cronName, error, orgId? })`
   - `sendCronFailureAlert` sends Resend email to `asad@getzybit.com` (internal only)
2. Apply to: `compute-outcomes`, `sync-posthog`, `sync-ga4`, `health-alert`, `check-selector-staleness`

**Files:** `src/lib/observability/withCronAlert.ts` (new), `src/lib/email/cronFailureEmail.ts` (new), each cron route handler

---

## Zybit-156 — Operator org dashboard
**Estimate:** 2d | **Owner:** —

**What:** A protected `/app/operator` route (requires `role: 'operator'` on the user record, set manually in DB for now) showing all orgs, site counts, sync health, and experiment states at a glance.

**UI:** Simple table:
- Org name | Plan | Sites | Last sync | Running experiments | Status (healthy/degraded/silent)
- Click row → org detail: sites list, integration health, recent cron outcomes
- No customer data exposed (findings, events) — operational health only

**Files:**
- `src/app/app/operator/page.tsx` (new)
- `src/app/api/operator/status/route.ts` (new — operator-auth-gated)
- `src/lib/auth/serverAuth.ts` — add `operator` role check

---

## Zybit-157 — GA4 "Identify/Propose only" documentation and onboarding gate
**Estimate:** 0.5d | **Owner:** — | **Status:** ✅ Shipped (2026-05-21)

**What:** GA4 connector is aggregate-grain only — cannot join to visitor assignments for outcome measurement. If a customer connects only GA4, they will get findings but the measurement loop will silently produce no outcomes. This must be surfaced explicitly.

**Steps:**
1. In `CockpitView.tsx`, if the only connected integration is GA4: show amber banner "GA4 connected — findings and proposals are available, but outcome measurement requires PostHog or Segment."
2. In the integration connection flow, add a GA4-specific note: "GA4 provides behavioral data for identifying friction. To measure A/B test outcomes, also connect PostHog or Segment."
3. In `compute-outcomes` cron, if site has only GA4 and no PostHog/Segment: skip compute (no visitor-level data to join) and log structured warning rather than running and producing 0-confidence results

**Files:** `src/components/app/CockpitView.tsx`, integration onboarding UI, `src/lib/experiments/computeOutcomes.ts`

**Shipped notes:**
- Pure predicate `isGa4OnlyMeasurementGap` lives in `src/lib/phase2/connectors/measurementGrain.ts` — single source of truth, used by both the cockpit and the cron. 8 unit tests.
- Step 1 (amber cockpit banner) and step 3 (`computeAllOutcomes` skips GA4-only sites with a `logger.warn` structured warning) are done.
- Step 2 deviation: GA4 has **no UI connection flow** — it is connected via the integrations API only; onboarding offers PostHog/Segment exclusively. There is no "GA4 connection screen" to attach the note to, so the cockpit banner is the catch-all surface. No onboarding change made.

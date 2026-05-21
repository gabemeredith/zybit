<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Zybit — Agent Context

## What Zybit is

Zybit is a conversion intelligence platform for product managers. It runs a six-step loop: **Understand** (audit the product via page snapshots) → **Watch** (ingest real user behavioral data) → **Identify** (surface evidence-backed friction findings) → **Propose** (generate A/B prescriptions) → **Test** (deploy variants to production traffic via proxy) → **Learn** (feed outcomes back into the rule engine to improve future findings).

**Full product doctrine and build philosophy:** [`DOCTRINE.md`](./DOCTRINE.md) — read it before making any architectural decisions.

---

## Build conventions (non-negotiable)

- **Deterministic over generative.** Audit rules are pure functions — same input, same output. No LLM-generated numbers or invented evidence.
- **PM-first at every layer.** Every output (finding title, evidence summary, UI label) is for a product manager, not an engineer.
- **Every file has a purpose.** No scaffolding, no placeholders, no "we might need this later."
- **Third-party where it's better.** Auth = invite-only magic-link sessions in `src/lib/auth/` (Clerk was removed in `a786d37`). Email = Resend. Billing = Stripe. Headless browser = Browserless.io. Cron monitoring = Cronitor. Observability = Axiom. Do not rebuild what third parties do well.
- **Third-party where it's better.** Email = Resend. Billing = Stripe. Headless browser = Browserless.io. Cron monitoring = Cronitor. Observability = Axiom. Do not rebuild what third parties do well. (Auth is owned: invite-only magic-link system, no Clerk.)
- **`npm run verify` must pass** before any commit: lint + TypeScript + build.

---

## Codebase map

```
zybit/
  src/lib/phase2/rules/       — 12 audit rules (5 design + 7 pain), 193 tests
  src/lib/phase2/connectors/  — PostHog (pull-sync) + Segment (webhook)
  src/lib/phase2/snapshots/   — Static HTML parse + visual-weight analysis
  src/lib/phase2/rollups/     — Event → InsightInput aggregation pipeline
  src/lib/phase1/             — Readiness scoring + legacy insights engine
  src/lib/auth/               — Invite-only magic-link auth + M2M API keys
  src/lib/billing/            — Stripe integration (plans, limits, usage metering)
  src/lib/experiments/        — Bucketing, HTML modifier, edge proxy (partial)
  src/lib/observability/      — Cronitor, error budget, structured logger
  src/lib/db/                 — Drizzle schema + Postgres client (Neon)
  src/app/api/phase1/         — Readiness + insights HTTP API
  src/app/api/phase2/         — Canonical events, insights run, connectors, snapshots
  src/app/api/dashboard/      — Findings and experiments CRUD
  src/app/api/billing/        — Stripe checkout, portal, usage, webhook
  src/app/api/proxy/          — Edge proxy assignment + config
  src/app/app/                — PM dashboard (findings, experiments, onboarding, settings)
  drizzle/                    — SQL migrations (apply before first run with Postgres)
  docs/                       — Technical reference
```

---

## Current build state

| Loop Step | Status | Notes |
|-----------|--------|-------|
| **Understand** (snapshot audit) | ⚠️ Partial | HTTP + DOM parse works; SPA/JS-rendered pages trigger Browserless fallback (`browserFetcher.ts`). snapshotMethod field on records. CSS system detection (Tailwind/styled-components/Emotion/CSS-Modules/Bootstrap) now runs at parse time and stored as `cssSystem` on `PageSnapshotData` (Zybit-122). |
| **Watch** (PostHog + Segment + GA4) | ✅ Built | PostHog + Segment built; PostHog visitor-ID bridge shipped; GA4 connector shipped — service-account JWT (Web Crypto), `runReport` offset pagination, cursor, `runGA4PullSyncJob` + `/cron/sync-ga4` every 30m. GA4 is aggregate-grain (Identify/Propose only, not joinable to assignments). |
| **Identify** (12 audit rules) | ✅ Built | 5 design + 7 pain rules, 193 passing tests — sufficient; do not add more rules |
| **Propose** (findings + prescriptions) | ✅ Built | Ranked by priority score + revenue impact, PM-readable. Selector validation badge (500ms debounced, Zybit-121). CSS system hint in experiment builder when 'Swap CSS classes' selected (Zybit-122). Dead-state UX shows session progress bar vs threshold (Zybit-125). |
| **Test** (variant deployment) | ⚠️ Partial | Bucketing + HTML modifier + proxy routes built. Network-error fail-open, modification-error fail-open, kill switch (`experiment.status === 'running'`), origin timeout (10s) all shipped in `handler.ts`. SPA shell detection logs warning. DNS verify now probes HTTPS after CNAME check (`proxyLive` flag) to distinguish CNAME-only from fully-live proxy. Overlap warn-and-proceed (Zybit-119): running experiments on same site trigger acknowledgment banner; `overlappingExperimentIds` stored for audit. Draft→running "Launch experiment" button added to ExperimentControls. |
| **Measure** (outcome computation) | ✅ Built | OBF alpha-spending (`stats.ts`), daily cron, 408 passing tests. PostHog visitor-ID bridge + auto-stop/guardrail PM email shipped. "Last computed at" surfaced in cockpit (Zybit-086, `MAX(experiment.updatedAt)`). |
| **Learn** (outcome feedback loop) | ⚠️ Partial | Layer 1 shipped — per-site re-ranking via `applyLearnRerank` (`src/lib/phase2/rules/learnReranker.ts`): cascade match (Tier 1–4) + D-with-guardrails formula. Wired into `runInsightsPipeline`, persisted as `learn_adjustment` jsonb on `forge_findings` (drizzle/0013), surfaced as backlog pill, finding-detail "Past tests" panel, and LEARNED timeline entry. Layer 2 (per-site rule-threshold calibration) and Layer 3 (cross-site priors) not built. |
| **Visible loop view** | ✅ Built | Timeline merge + per-entry rendering + empty state + detail links; guardrail-breach amber badge (Zybit-091), multi-site pill selector (Zybit-092), and LEARNED entries (Zybit-093) all shipped. |
| **Preview before deploy** | ✅ Built | Side-by-side control/variant iframes on experiment detail page; CSP `frame-ancestors 'self'` on preview response |
| **GA4 connector** | ✅ Built | `client.ts` (JWT+OAuth+runReport), `secrets.ts`, `cursor.ts`, `mapping.ts`, `sync.ts`, job + cron. 18 unit tests. |
| **Billing** (Stripe + plan limits) | ⚠️ Partial | Metering + hard enforcement (sites/experiments 402) + events soft-cap shipped. Round-trip code bugs fixed: post-checkout redirect pointed at a non-existent `/dashboard/settings` (→ `/app/settings`); cross-instance-stale plan cache removed so enforcement reads the webhook-written plan immediately; webhook validates planId before persisting. Remaining: live stripe-cli verification of the real checkout→webhook→plan-write round-trip (needs Stripe test keys — see BACKLOG Zybit-040). |
| **Observability** | ⚠️ Partial | Cronitor + error budget + structured logger built and wired into crons; Axiom drain not yet connected |
| **Integration health (cockpit)** | ✅ Built | `deriveIntegrationHealth()` in `cockpit.ts`; `PipelineHealth` in `CockpitView.tsx` shows "Zybit is watching" / "No data yet" / "Degraded" + last-sync + 7-day event count (Zybit-111) |
| **Activation (onboarding)** | ⚠️ Partial | MRR/AOV now required to finish onboarding (Zybit-113, no skip). First-insight email exists. |
| **Auth security** | ✅ Built | Magic-link auth. Rate limiting on `/api/auth/request-link`: 3 req/10min per email, 10 req/10min per IP via `auth_rate_limits` table (Zybit-115). Single active token per email (old tokens invalidated on re-request). |

## Immediate build order

> **Status (2026-05-21):** Sprint 0 merged (PR #49): auth rate limiting (Zybit-115), experiment overlap warn-and-proceed (Zybit-119). Sprint 1 in progress on `claude/sprint1-selector-insights-WyT3k`: **selector validation badge (Zybit-121)**, **CSS system detector (Zybit-122)**, **findings dead-state UX (Zybit-125)**. CI: 34 test files, 417 tests passing.

1. **Live Stripe round-trip verification** (~1 day): with stripe-cli + test keys, drive checkout → `checkout.session.completed`/`customer.subscription.*` webhooks → confirm `organizations.plan` write → confirm `checkPlanLimit` 402. Code path audited & bugs fixed; only live verification remains. See BACKLOG Zybit-040.
2. **Learn — Layer 2 (per-site rule-threshold calibration)**: Layer 1 (re-ranking) shipped; Layer 2 would mutate `ruleTuning.ts`-equivalent constants per-site based on outcome history. Layer 3 (cross-site priors) deferred until 50+ customers.
3. **Axiom drain** for the structured logger (observability is otherwise wired).

**Never build:** sentiment analysis, GitHub PR generation, own event collection SDK / PostHog replacement, more audit rules, cross-site priors before 50+ customers.

**For full specifications:** `docs/ARCHITECTURE.md` — "Priority Build Items" section. `docs/BACKLOG.md` — Epics J, K, L, M.

**For the gap analysis and build plan:** [`../product_gap.md`](../product_gap.md)

---

## Document map

| Document | Purpose | Update when... |
|----------|---------|----------------|
| `DOCTRINE.md` | Product vision, who it's for, build conventions, current state | Features ship, scope changes, or "Where we are today" drifts from reality |
| `docs/ARCHITECTURE.md` | Technical architecture, what's built, what's not | Features complete or new components are added |
| `docs/BACKLOG.md` | Prioritized epics and stories | Stories ship, priorities change |
| `../product_gap.md` | Gap analysis, build plan, sequencing | Gaps are closed or re-scoped |
| `README.md` | Project overview, local setup, env vars | Status changes, env vars added or removed |
| `docs/PHASE2_EVIDENCE_MODEL.md` | Canonical event schema, audit rule contracts | Event schema or rule interface changes |
| `docs/PHASE2_LIVE_TUNING_PLAYBOOK.md` | Operator runbook for rule calibration | Rule thresholds or tuning approach changes |

---

## End-of-session obligations

**After every session where you write or modify code, update the relevant documentation.** These documents are the project's source of truth — they must reflect reality, not aspirations. Do not skip this step.

### Checklist

1. **Did you ship a feature that was listed as "not built" or "partial"?**
   - Update `docs/ARCHITECTURE.md` — move it from "What Needs to Be Built" into "What Exists"
   - Update the "Current build state" table above in this file
   - Update `DOCTRINE.md` — "Where we are today" section

2. **Did you complete a backlog story?**
   - Update `docs/BACKLOG.md` — mark the story **Shipped** with a brief note

3. **Did you close or partially close a gap from the gap analysis?**
   - Update `../product_gap.md` — update the status table row for the affected gap

4. **Did you add, rename, or remove API routes, env vars, or major source directories?**
   - Update `README.md` — env var table and repository structure
   - Update `DOCTRINE.md` — codebase map
   - Update `docs/ARCHITECTURE.md` — relevant component tables

5. **Did you change the canonical event schema or an audit rule interface?**
   - Update `docs/PHASE2_EVIDENCE_MODEL.md`

6. **Did you add, remove, or substantially change an audit rule?**
   - Update the rule count in `docs/ARCHITECTURE.md`
   - Update rule counts in `DOCTRINE.md` if referenced

### How to update

- Be factual and minimal. Change only what changed.
- Do not remove historical context — revise sections to reflect current state rather than erasing prior descriptions.
- If the change is a small bug fix, a one-line status note is sufficient.
- If the change closes a major gap, update all affected documents in the checklist above.
- Include documentation changes in the same commit as the code change.

### Consistency requirement

The following must always agree with each other:

- "Current build state" table in this file (`AGENTS.md`)
- "Where we are today" section in `DOCTRINE.md`
- "What Exists" section in `docs/ARCHITECTURE.md`
- Status table at the top of `../product_gap.md`

If you notice any of these are out of sync — even if you didn't cause the drift — fix them.

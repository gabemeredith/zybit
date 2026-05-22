# Sprint Status & Remaining Work — Sprints 0–5

**Created:** 2026-05-21 · **Last audited:** 2026-05-22
**Why this exists:** the single source of truth for what is genuinely shipped
across sprints 0–5 vs. what remains. Supersedes the stale "all merged" claims
that `AGENTS.md` once carried. Audited by file-existence + behaviour checks
and a live end-to-end run against the production Neon DB on 2026-05-22.

There are **38 real tickets** (the ROADMAP ID ranges 129–132, 138–140,
149–152, 158–160, 166–168 are allocation padding — no specs exist for them).

---

## Scoreboard

| Sprint | Tickets | Done | Partial | Not built | Other |
|--------|---------|------|---------|-----------|-------|
| 0 — Verification & Hardening | 7 | 6 | 1 | 0 | — |
| 1 — Demo Readiness | 8 | 5 | 1 | 2 | — |
| 2 — Selector Robustness | 5 | 5 | 0 | 0 | — |
| 3 — Design Capture & AI Advisor | 8 | 0 | 1 | 5 | 2 in open PR #58 |
| 4 — Observability & Multi-Customer Ops | 5 | 4 | 0 | 1 | — |
| 5 — Learn Layer 2 | 5 | 2 | 0 | 1 | 2 superseded |
| **Total** | **38** | **22** | **3** | **9** | **4** |

**The deterministic six-step loop (Understand → Watch → Identify → Propose →
Test → Measure → Learn) is built, live-verified, and customer-ready.** What
remains is one demo-polish gap, the entire AI/design-capture product surface
(Sprint 3), and one ops dashboard.

---

## Per-ticket audit

### Sprint 0 — Verification & Hardening

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-114 | Live Stripe round-trip | ✅ **Done** — verified end-to-end 2026-05-22 (18/18 checks: checkout → webhook → plan write → `checkPlanLimit` 402) |
| Zybit-115 | Auth rate limiting | ✅ Done — `rateLimit.ts`; `auth_rate_limits` table (migration 0014) applied to Neon 2026-05-22 |
| Zybit-116 | Edge Config kill-switch write | ✅ Done |
| Zybit-117 | Browserless live verification | ✅ Done — runbook (`CAPTURE_RUNBOOK.md`); live capture needs `BROWSERLESS_TOKEN` |
| Zybit-118 | Snapshot refresh cadence policy | ⚠️ **Partial** — `refresh-snapshots` cron exists; per-site dormancy/cadence policy not implemented |
| Zybit-119 | Experiment overlap warn-and-proceed | ✅ Done |
| Zybit-120 | Full-loop E2E smoke test | ✅ Done — `pipeline.e2e.test.ts` regression net |

### Sprint 1 — Demo Readiness

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-121 | Selector validation in builder | ✅ Done (`api/selector-validate`) |
| Zybit-122 | CSS-system detector + fragility warning | ✅ Done |
| Zybit-123 | SPA/hybrid auto-detection | ✅ Done — re-scoped as a launch-time guard (see note 1) |
| Zybit-124 | Insights dead-state UX | ⚠️ **Partial** — `WelcomeState` shows progress vs. threshold; no dedicated `InsightsDeadState` surface |
| Zybit-125 | Copy-hint heuristic in builder | ✅ Done |
| Zybit-126 | PostHog bridge health probe | ✅ Done |
| Zybit-127 | Demo site seed + stable demo env | ❌ **Not built** — no `scripts/seed-demo.ts` |
| Zybit-128 | Synthetic outcome data for demo | ❌ **Not built** |

### Sprint 2 — Selector Robustness — ✅ COMPLETE

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-133 | Selector staleness cron | ✅ Done |
| Zybit-134 | Stable selector ranking (stability tiers) | ✅ Done |
| Zybit-135 | Snapshot drift dashboard (per-path) | ✅ Done |
| Zybit-136 | `data-zybit-ref` injection audit | ✅ Done |
| Zybit-137 | Segment webhook schema guard | ✅ Done (`guardSegmentBatch`) |

### Sprint 3 — Design Capture & AI Variant Advisor

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-141 | `phase2_site_design_snapshot` schema | 🔶 **In PR #58** (open, unmerged) — migration `0016` applied to Neon 2026-05-22 |
| Zybit-142 | Full-fidelity DesignCapture via Browserless | 🔶 **In PR #58** (open, unmerged) |
| Zybit-143 | Design token extraction | ❌ **Not built** |
| Zybit-144 | AI Variant Advisor API route | ❌ **Not built** |
| Zybit-145 | AI Variant Advisor UI | ❌ **Not built** |
| Zybit-146 | DOM tree element picker + screenshot | ❌ **Not built** |
| Zybit-147 | Side-by-side live preview while editing | ⚠️ **Partial** — preview iframes exist on experiment detail; ephemeral while-editing route not built |
| Zybit-148 | Rate limiting + cost guard for AI advisor | ❌ **Not built** |

### Sprint 4 — Observability & Multi-Customer Ops

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-153 | Axiom log drain | ✅ Done — active once `AXIOM_DATASET` is set in Vercel (`AXIOM_TOKEN` confirmed working) |
| Zybit-154 | Connector circuit breaker | ✅ Done |
| Zybit-155 | Cron failure email alert | ✅ Done |
| Zybit-156 | Operator org dashboard | ❌ **Not built** — no `/app/operator` route |
| Zybit-157 | GA4 "Identify/Propose only" gate | ✅ Done |

### Sprint 5 — Learn — Layer 2

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-161 | `zybit_rule_overrides` schema | ⚠️ **Superseded** — see note 2 |
| Zybit-162 | Calibration job | ⚠️ **Superseded** — see note 2 |
| Zybit-163 | Rule engine reads per-site overrides | ✅ Done — `calibratedFloor`/`calibratedCap` route 11/12 rules through per-site multipliers |
| Zybit-164 | "Tuned for your site" label | ✅ Done — calibration receipt + backlog badge + detail panel + LEARNED timeline note |
| Zybit-165 | Calibration visibility for operators | ❌ **Not built** — depends on Zybit-156 (operator dashboard) |

---

## Remaining work — the definitive list

### ❌ Not built (9 tickets)

| Ticket | Feature | Est. | Customer-blocking? |
|--------|---------|------|--------------------|
| Zybit-127 | Demo site seed (`scripts/seed-demo.ts`) | ~1d | No — sales/demo aid |
| Zybit-128 | Synthetic outcome data for demo measurement view | ~0.5d | No — sales/demo aid |
| Zybit-143 | Design token extraction (`tokenExtractor.ts`) | ~1d | No — Sprint 3 surface |
| Zybit-144 | AI Variant Advisor API (Gemini, Propose-only) | ~2d | No — Sprint 3 surface |
| Zybit-145 | AI Variant Advisor UI | ~1d | No — Sprint 3 surface |
| Zybit-146 | DOM tree element picker + screenshot thumbnail | ~2d | No — Sprint 3 surface |
| Zybit-148 | AI advisor rate limiting + cost guard | ~0.5d | No — gates Zybit-144 |
| Zybit-156 | Operator org dashboard (`/app/operator`) | ~2d | **Soft** — needed to support customers remotely |
| Zybit-165 | Operator calibration visibility | ~1d | No — depends on Zybit-156 |

### ⚠️ Partial — needs finishing (3 tickets)

| Ticket | Feature | What's missing |
|--------|---------|----------------|
| Zybit-118 | Snapshot refresh cadence | Per-site dormancy/cadence policy on top of the existing cron |
| Zybit-124 | Insights dead-state UX | A dedicated `InsightsDeadState` surface beyond `WelcomeState`'s progress bar |
| Zybit-147 | Side-by-side live preview | Ephemeral preview route used *while editing* a brief (current preview is on the saved experiment only) |

### 🔶 In open PR — review & merge (2 tickets)

- **Zybit-141 / Zybit-142** — Sprint 3 design-snapshot schema + writer, in **PR #58**.
  Migration `0016` has already been applied to Neon. Merge order: PR #59 → PR #58.

### ⚠️ Superseded — product decision needed (2 tickets)

- **Zybit-161 / Zybit-162** — Sprint 5 specced a persisted `zybit_rule_overrides`
  table + a standalone calibration job. The shipped Layer 2 calibration
  (`ruleCalibration.ts`) computes per-site rule-threshold multipliers **on the
  fly** from outcome history, inside `runInsightsPipeline` — same intent, no
  schema, no job. **Decision required:** is on-the-fly calibration sufficient,
  or is a persisted, operator-*editable* override table still wanted? If the
  former, close 161/162 as superseded. If the latter, they become real work.

---

## Notes

**Note 1 — Zybit-123 (re-scoped).** The sprint-1.md spec assumed the onboarding
wizard had a binary SSR/SPA toggle to replace; it never did, and the snapshot
fetcher (`fetcher.ts`) already auto-detects SPAs and falls back to Browserless.
The genuine live gap was in *Test*: the proxy detected an SPA shell but only
logged a warning, then served unmodified control HTML to variant-bucket traffic
— a silent no-op experiment polluting outcome history. Zybit-123 shipped as a
launch-time guard: `targetPageIsSpaShell` fetches the target page,
`launchExperimentAction` returns a `spa_warning`, `ExperimentBriefCard` shows a
warn-and-acknowledge banner.

**Note 2 — see "Superseded" above.**

---

## Recommended order to "first paying customer"

The core loop is customer-ready. Remaining sequencing:

1. **Merge PR #59 → PR #58** — closes the empty-selector loophole and lands the
   Sprint 3 data layer (Zybit-141/142). Migration `0016` already applied.
2. **Zybit-156 — operator dashboard** (~2d) — the only soft customer-blocker;
   needed to support a customer remotely.
3. **Sprint 1 demo polish** — Zybit-127/128 (demo seed + synthetic outcomes)
   and Zybit-124 finish, if a populated demo environment is wanted for sales.
4. **Sprint 3 proper** — Zybit-143 → 144 → 145 → 146 → 148, in dependency
   order. Prerequisites: `GEMINI_API_KEY` + a Vercel Blob plan tier.
5. **Zybit-118 / Zybit-147** — smaller hardening, any time.
6. **Decide Zybit-161/162** — keep superseded, or build the persisted override
   table; that decision also unblocks Zybit-165.

### Environment / ops actions (no code)

- Set `AXIOM_DATASET=axiom-audit` in Vercel — activates the Zybit-153 log drain.
- Provision `GEMINI_API_KEY` + Vercel Blob tier before Sprint 3.
- Migration journal (`drizzle/meta/_journal.json`) is stale — it lists only
  0000–0002 though 0000–0016 are applied, and there is no
  `drizzle.__drizzle_migrations` tracking table (migrations applied manually).
  Reconcile before relying on `drizzle-kit migrate`.

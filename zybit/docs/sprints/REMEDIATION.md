# Sprint Remediation Plan

**Created:** 2026-05-21
**Why this exists:** A file-existence + behaviour audit of sprints 0–5 against
the sprint docs found documentation drift — `AGENTS.md` stated "Sprint 0/1/2
merged to main", but sprints 1 and 2 are only partially built and sprint 3 is
not built at all. This document is the single source of truth for what is
genuinely shipped vs. outstanding, and the build plan for the gaps.

---

## Audit result — per-ticket status

| Ticket | Feature | Status |
|--------|---------|--------|
| Zybit-114 | Stripe round-trip code | ✅ Built (live verification still pending — needs reachable env) |
| Zybit-115 | Auth rate limiting | ✅ Built |
| Zybit-116 | Edge Config kill-switch write | ❌ Not built |
| Zybit-117 | Browserless runbook | ✅ Built |
| Zybit-118 | Snapshot refresh cron | ⚠️ Partial — route exists, dormancy check missing |
| Zybit-119 | Experiment overlap | ✅ Built |
| Zybit-120 | Full-loop E2E smoke test | ⚠️ Partial — `scripts/e2e-test.mjs` + `pipeline.e2e.test.ts` exist; not the full spec'd loop |
| Zybit-121 | Selector validation | ✅ Built (`api/selector-validate`) |
| Zybit-122 | CSS system detector | ✅ Built |
| Zybit-123 | SPA/hybrid auto-detection | ❌ Not built |
| Zybit-124 | Insights dead-state UX | ⚠️ Partial — `WelcomeState` shows progress vs threshold; gate logic exists |
| Zybit-125 | Copy-hint heuristic | ❌ Not built |
| Zybit-126 | PostHog bridge health probe | ❌ Not built |
| Zybit-127 | Demo site seed | ❌ Not built |
| Zybit-128 | Synthetic outcome data | ❌ Not built |
| Zybit-133 | Selector staleness cron | ❌ Not built |
| Zybit-134 | Stable selector ranking | ⚠️ Partial — `buildSuggestions` exists, no stability tiers |
| Zybit-135 | Snapshot drift dashboard | ❌ Not built |
| Zybit-136 | data-zybit-ref injection audit | ✅ Built |
| Zybit-137 | Segment webhook schema guard | ⚠️ Partial |
| Zybit-141–148 | Sprint 3 — design capture, AI advisor, element picker | ❌ Not built (entire sprint) |
| Zybit-153 | Axiom log drain | ✅ Shipped |
| Zybit-154 | Connector circuit breaker | ✅ Shipped |
| Zybit-155 | Cron failure email | ✅ Shipped |
| Zybit-156 | Operator org dashboard | ❌ Not built |
| Zybit-157 | GA4 measurement-gap warning | ✅ Shipped |
| Zybit-161–165 | Sprint 5 — rule overrides | ⚠️ Superseded — see below |

---

## Build plan — Sprint 0/1/2 outstanding items

Ordered by value-for-effort. Each is an independent unit of work; do not batch
them into one unverified commit.

1. **Zybit-120 — full-loop E2E** (~0.5d). Audit `scripts/e2e-test.mjs` and
   `src/lib/phase2/rules/__tests__/pipeline.e2e.test.ts` against the spec's
   loop (snapshot → events → insights → experiment → outcome → learn). Extend
   to cover any missing leg. Highest value: a regression net before customers.
2. **Zybit-126 — PostHog bridge health probe** (~1d). Inject a marker the proxy
   can read (`_zybit_bridge_loaded`); add a `bridgeHealthy` field to
   `cockpit.ts`; surface "PostHog bridge not detected" when assignments exist
   but no bridged conversions. Prevents silent outcome undercounting.
3. **Zybit-116 — Edge Config kill-switch write** (~1d). On experiment
   stop/conclude, write the disabled state to Vercel Edge Config so the proxy
   fails closed at the edge without a DB round-trip.
4. **Zybit-133 — selector staleness cron** (~1d). Daily cron re-checks stored
   experiment selectors against the latest snapshot; emails the PM on a miss.
5. **Zybit-125 — copy-hint heuristic** (~1d). Deterministic copy-quality hint
   in the Propose phase (not an audit rule — a builder-side suggestion).
6. **Zybit-127/128 — demo seed + synthetic outcomes** (~1d). `scripts/seed-demo.ts`
   for a populated demo org. Useful for sales, not customer-blocking.
7. **Zybit-135 — snapshot drift dashboard** (~1d). Surface per-path snapshot
   health in the cockpit. `snapshots.staleDays` already exists — extend it.
8. **Zybit-123 — SPA/hybrid auto-detection** (~0.5d), **Zybit-124 finish**,
   **Zybit-134 stability tiers**, **Zybit-137 finish** — smaller hardening.

---

## Build plan — Sprint 3 (design capture + AI advisor), entirely unbuilt

Sprint 3 is the largest gap. It is **not** customer-blocking for a first pilot
(the deterministic loop works without it) but it is the next product surface.
Build in dependency order:

1. **Zybit-141 — `phase2_site_design_snapshot` schema** (~0.5d). New Drizzle
   table + migration. `captureMethod: 'browserless' | 'structural'`.
2. **Zybit-142 — DesignCapture via Browserless** (~2d). `designCapture.ts` —
   computed styles + screenshot to Vercel Blob. Degrades to `structural` when
   Browserless is unavailable (see ROADMAP locked decision).
3. **Zybit-143 — design token extraction** (~1d). `tokenExtractor.ts` — pull
   colour/spacing/type scale from the capture.
4. **Zybit-144 — AI Variant Advisor API** (~2d). `ai-suggest/route.ts` +
   `aiAdvisor.ts`. Gemini `gemini-2.0-flash` via `@google/generative-ai`.
   **Doctrine guard:** AI only in Propose, never Identify. PM approves output.
5. **Zybit-145 — AI Variant Advisor UI** (~1d). `AiVariantAdvisor.tsx`.
6. **Zybit-146 — DOM element picker** (~2d). `ElementPicker.tsx` — tree view +
   screenshot thumbnail, no iframe (CORS/CSP — see ROADMAP).
7. **Zybit-147 — side-by-side preview** (~1d). Already partly built (preview
   iframes on experiment detail) — extend to the ephemeral route.
8. **Zybit-148 — AI rate limiting** (~0.5d). Per-org cap on `ai-suggest`.

**Prerequisites before starting:** `GEMINI_API_KEY` and a Vercel Blob plan
tier (see `DEVLOG.md` 2026-05-20 open questions).

---

## Sprint 4 / Sprint 5 status

**Sprint 4** — 4 of 5 shipped (153, 154, 155, 157). Outstanding:
- **Zybit-156 — operator org dashboard** (~2d). `/app/operator` route, operator
  role check, all-org sync-health table. Needed to support customers remotely.

**Sprint 5** — rule overrides (Zybit-161–165) is **largely superseded**. Sprint
5 specced a persisted `rule_overrides` table + calibration job. The shipped
Layer 2 calibration (`ruleCalibration.ts`) computes per-site rule-threshold
multipliers on the fly from outcome history — same intent, no schema. Before
building Sprint 5, decide: is on-the-fly calibration sufficient, or is a
persisted, operator-editable override table still wanted? If the latter, only
Zybit-165 (operator calibration visibility) remains genuinely new.

---

## Recommended order to "first real customer"

1. Live Stripe round-trip verification (needs reachable env + stripe-cli).
2. Zybit-120 (E2E regression net) + Zybit-126 (bridge health).
3. Zybit-156 (operator dashboard) — remote supportability.
4. Then Sprint 3 (product surface) and Sprint 0/1/2 hardening remainder.

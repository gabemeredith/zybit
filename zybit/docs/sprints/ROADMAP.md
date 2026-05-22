# Zybit — Sprint Roadmap

**Goal:** First 3 paying customers running real A/B experiments against real production traffic.
**Horizon:** 11–13 weeks from Sprint 0 start.
**Team:** 2 engineers.

---

## Sprint arc

**Status legend:** ✅ complete · 🟢 mostly complete · 🟡 in progress · 🔲 not started

| Sprint | Name | Duration | Status | Gate |
|--------|------|----------|--------|------|
| [0](sprint-0.md) | Verification & Hardening | 1w | 🟢 6/7 done (Zybit-118 partial) | Core loop confirmed live; Stripe verified; auth protected |
| [1](sprint-1.md) | Demo Readiness | 1.5w | 🟢 5/8 done (124 partial; 127/128 not built) | Full demo script runnable without ad-hoc fixes |
| [2](sprint-2.md) | Selector Robustness | 1.5w | ✅ 5/5 complete | Selector staleness detected, PM notified before silent breakage |
| [3](sprint-3.md) | Design Capture & AI Variant Advisor | 3w | 🟡 0/9 (141/142 in PR #58; 143–146/148/149 not built) | PM goes from finding → AI-drafted variant → launch in <10 min |
| [4](sprint-4.md) | Observability & Multi-Customer Ops | 1w | 🟢 4/5 done (156 not built) | First paying customer supportable remotely |
| [5](sprint-5.md) | Learn — Layer 2 | 2w | 🟢 2/5 done; 161/162 superseded; 165 not built | Per-site rule thresholds calibrated from outcome history |

**Total: ~10w sprint time + 1–2w customer incident slack = 11–13w to customer 3.**

> **Audit (2026-05-22):** 39 tickets — 22 done, 3 partial, 10 not built, 2 in
> open PR #58, 2 superseded. The deterministic six-step loop is built and
> live-verified. Remaining work is concentrated in Sprint 3 (the AI/design
> surface, now including Zybit-149 — a client-side variant runtime for complex
> & SPA-safe changes) plus the Zybit-156 operator dashboard. Per-ticket detail
> and the definitive remaining-work list: [`REMEDIATION.md`](REMEDIATION.md).

---

## Architectural decisions — locked

> **Reconciled with `docs/PRD.md` (2026-05-22).** The PRD ratifies a synthesis:
> page-level understanding is the foundation, product-level (flow graph, client
> runtime, journey experiments) layers on top. The "Proxy mechanism — locked"
> decision below is amended accordingly. All other decisions in this section
> stand.

**Delivery mechanism:** Two substrates of one delivery layer, chosen per site by
how the customer's pages render. (1) **Edge proxy** — mutate origin HTML
in-flight via Vercel Middleware, for server-rendered HTML/marketing sites; no git
involvement, no source-code changes. (2) **Client runtime** — an embeddable
script-tag SDK that applies experiments after SPA hydration, for SPAs and
authenticated products (PRD Milestone 1, Zybit-149). Both consume the same
`VariantModification` schema and the same bucketing logic. The proxy is not
deprecated; it remains the delivery path for HTML sites.

**Visual element picker (Sprint 3):** DOM tree view + Browserless screenshot thumbnail stored in Vercel Blob. No iframe embedding — CSP and CORS make that path 12+ days for a broken result. PM clicks element in the tree → selector populates → thumbnail highlights it. 7 days, reliable.

**Design capture degraded mode:** When Browserless is unavailable (bot protection, plan tier), the AI Variant Advisor still runs using structural snapshot only. UI shows "Visual confidence: limited — computed styles unavailable." `phase2_site_design_snapshot.captureMethod` field distinguishes `'full'` from `'structural'`. The advisor prompt includes this signal so the model can adjust its confidence.

**Experiment collision:** Overlap allowed by default. A second experiment on the same page triggers a mandatory acknowledgment warning ("results may be confounded if both target the same element"). `forge_experiments.overlappingExperimentIds: string[]` stored on launch so outcomes can be flagged. `exclusionGroup` mutual exclusion is a later feature (deferred until customers run enough concurrent experiments to need it).

**AI in the loop:** AI is used only in the Propose phase (Sprint 3). Identification stays fully deterministic — 12 rules, pure functions, no model. AI Variant Advisor input is constrained to real selectors from the snapshot; output is constrained to the `VariantModification[]` schema. PM approves before anything deploys. AI never acts autonomously.

**GA4:** Aggregate-grain only. Documented as Identify/Propose support only — not joinable to visitor assignments for measurement. Full loop requires PostHog or Segment.

---

## What "demoable" means (end of Sprint 1)

The demo script **ends at "experiment launched."** Measurement loop completing requires 7+ days of real traffic. The synthetic traffic generator (Zybit-129) creates a pre-populated demo site with seeded outcome data for showing the measurement view.

Demo flow:
1. Cockpit → PostHog synced, findings ready
2. Findings backlog → 3–5 findings ranked by revenue impact
3. Finding detail → evidence panel, prescription, "Build experiment"
4. ExperimentBuilder → selector suggestions from snapshot, copy hint heuristic, pre-filled fields
5. Experiment launched → proxy live
6. [Synthetic env only] Measurement tab showing lift trajectory

---

## What "first paying customer ready" means (end of Sprint 4)

1. Stripe verified live
2. Auth rate-limited
3. Selector staleness detected and PM notified
4. Experiment overlap warned and recorded
5. Axiom drain live for remote debugging
6. Connector circuit breaker so broken integrations don't retry forever

---

## Never build

- Sentiment analysis
- GitHub PR generation or source-code modification
- Own event SDK / PostHog replacement
- More than 12 audit rules
- Autonomous deployment (PM approval gate is non-negotiable)
- Cross-site priors before 50+ customers (Layer 3 Learn)

---

## ID allocation

| Range | Sprint |
|-------|--------|
| Zybit-114 — Zybit-120 | Sprint 0 |
| Zybit-121 — Zybit-132 | Sprint 1 |
| Zybit-133 — Zybit-140 | Sprint 2 |
| Zybit-141 — Zybit-152 | Sprint 3 |
| Zybit-153 — Zybit-160 | Sprint 4 |
| Zybit-161 — Zybit-168 | Sprint 5 |

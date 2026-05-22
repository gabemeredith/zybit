# Zybit — Product Requirements Document

**Status:** Ratified — source of truth for the product direction.
**Date:** 2026-05-22
**Supersedes:** `docs/pivot.md` (the binary "Path A vs Path B" framing is resolved
here in favour of a synthesis). Reconciles with `DOCTRINE.md` and
`docs/sprints/ROADMAP.md`.

---

## 1. Why this document exists

`docs/pivot.md` posed a real question — *is Zybit a single-page cosmetic CRO
tool, or a system that understands a software product's flow and changes it?* —
but framed it as a binary: either keep the page-level product (Path A) or freeze
it and re-platform around flows (Path B).

That binary is false. The product vision is **both**: Zybit understands a
product *through and through* **and** understands each individual page. Page-level
understanding is the foundation; product-level understanding (how pages connect,
how users move between them) is a layer on top. They share one spine.

This PRD records that decision and the build sequence it implies.

---

## 2. The vision

Zybit is a conversion intelligence platform for product managers. It should:

1. **Understand each page** — its structure, hierarchy, CTAs, forms, and brand DNA.
2. **Understand the whole product** — how pages connect into flows, and how real
   users move through them.
3. **Ingest behavioural data** from whatever analytics the customer already runs
   (PostHog, Segment, GA4, …).
4. **Propose specific fixes** — page-level and flow-level — backed by evidence.
5. **Let the PM see the proposed change** before it ships.
6. **Deploy in one click** — on a marketing HTML site *and* inside a live
   product/SPA.
7. **Measure, learn, and iterate** — every outcome sharpens the next proposal.

The PM always approves before anything goes live. Autonomy is not in scope; the
loop is human-gated by design.

---

## 3. Current state — what is real

The deterministic six-step loop (Understand → Watch → Identify → Propose → Test →
Measure → Learn) is **built and live-verified** against production. ~16k lines of
domain logic, 193 passing rule tests, Stripe verified end-to-end. This is a
working product, not a prototype.

**The single architectural constraint:** of the seven loop steps, exactly **one**
is locked to a substrate. The edge proxy (`src/lib/experiments/proxy/`) mutates
*server-rendered HTML* in flight. Every other step is substrate-agnostic and
already works regardless of how the customer's pages render:

| Step | Substrate-agnostic? | Notes |
|------|--------------------|-------|
| Understand | ✅ | `snapshots/fetcher.ts` already falls back to Browserless for SPAs |
| Watch | ✅ | Connectors ingest events regardless of rendering |
| Identify | ✅ | 12 rules are pure functions over events + snapshots |
| Propose | ✅ | Deterministic prescriptions; `VariantModification` schema is DOM-level |
| **Test** | ❌ | **Edge proxy only mutates server-rendered HTML** |
| Measure | ✅ | `stats.ts`, `computeOutcomes.ts` join events to outcomes |
| Learn | ✅ | L1 re-ranking + L2 calibration are pure functions over outcomes |

The "SPA problem" is therefore **not a re-platform**. It is one missing sibling
component: a client-side runtime alongside the proxy.

---

## 4. Gap analysis — vision vs. today

| Vision pillar | Status | Gap to close |
|---------------|--------|--------------|
| Understand each page | ✅ Built | `snapshots/` — parser, visual-weight, fold guess |
| Brand DNA | 🟡 In-flight | `phase2_site_design_snapshot` (PR #58) has `computedStyles`/`designTokens`/`cssSystem`; token extraction (Zybit-143) unbuilt |
| Understand the whole product | ❌ Missing | **Flow graph** — pages understood only in isolation today |
| How pages connect / how users move | ❌ Missing | **Flow graph** — events carry `path`+`sessionId`, so the data already exists; nothing builds the graph |
| Ingest behavioural data | ✅ Built | PostHog, Segment, GA4 connectors live |
| Propose fixes | 🟡 Partial | Deterministic prescriptions exist; AI advisor (Zybit-144) unbuilt; single-page only |
| See the change before deploy | 🟡 Partial | Server-side preview iframe on saved experiments; element picker + while-editing preview unbuilt |
| One-click deploy — HTML sites | ✅ Built | Edge proxy |
| One-click deploy — products/SPAs | ❌ Missing | **Client runtime** |
| Measure, learn, iterate | ✅ Built | Outcome computation + Learn L1/L2 |

Three structural gaps: **client runtime**, **flow graph**, **journey-level
experiment/outcome model**. Everything else is either built or is finishing
Sprint 3 as already scoped.

---

## 5. Architectural principle — one spine, two substrates, three new layers

```
                         ┌──────────────────────────────┐
                         │         SHARED SPINE          │
                         │  (substrate-agnostic, built)  │
                         │                               │
                         │  connectors · 12 rules ·      │
                         │  stats engine · findings &    │
                         │  experiment lifecycle ·       │
                         │  Learn L1/L2 · dashboard ·    │
                         │  bucketing · VariantModification│
                         └───────────────┬───────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              │                                                      │
   ┌──────────┴───────────┐                          ┌──────────────┴────────────┐
   │  DELIVERY: edge proxy │                          │  DELIVERY: client runtime │
   │  server-rendered HTML │                          │  SPAs / authenticated apps│
   │  (built)              │                          │  (NEW — Milestone 1)      │
   └──────────────────────┘                          └───────────────────────────┘

   NEW LAYERS (built on the spine, substrate-agnostic):
   • Flow graph              — how pages connect + how users move (Milestone 2)
   • Journey experiments     — a flow is the unit of optimization (Milestone 3)
   • Brand DNA + AI Propose  — design capture, AI variant advisor, preview (Milestone 4)
```

**The proxy is not deprecated.** It remains the delivery path for server-rendered
HTML/marketing sites. The client runtime is a *sibling*, not a replacement —
chosen per site by how the customer's pages render. Both consume the same
`VariantModification` schema and the same bucketing logic.

---

## 6. Build sequence

Four milestones. The client runtime is first — it unblocks the product/app
substrate that the rest of the vision depends on. Milestone 4 (design/AI/preview)
is largely independent and can run in parallel with Milestones 2–3 on a second
engineer.

### Milestone 1 — Client Runtime (substrate unlock) · ~3 weeks

An embeddable script-tag SDK that applies experiments client-side, after SPA
hydration. This is the deployment-side counterpart already tracked as Zybit-149.

- Embeddable snippet; analytics-style install.
- Bucketing **ported from the proxy** (`bucketing.ts` reused unchanged).
- Apply all six `VariantModification` types via the DOM API.
- `MutationObserver` to wait for target selectors to exist post-hydration.
- SPA route awareness — hook the History API; re-evaluate the active experiment
  on client-side route change.
- **Anti-flicker (FOOC) guard** — synchronous, *targeted* pre-hide of experiment
  elements (never the whole body) with a hard timeout fallback. Highest-risk
  item in this milestone; budget care here.
- Runtime config + event-ingest endpoints — adapt the existing `/api/proxy/`
  config and assignment endpoints; do not rebuild.
- Install onboarding + verification probe (mirrors the PostHog bridge probe,
  Zybit-126).

**Gate:** a PM deploys a variant to a real React SPA via the snippet, sees no
flash of original content, assignment + conversion events flow, and the existing
`computeOutcomes` cron produces an outcome row.

### Milestone 2 — Flow Graph (product-level understanding) · ~2 weeks

Derive how pages connect from data Zybit already ingests.

- `flow` data model — an ordered set of steps (pages/routes) per site. Migration.
- Flow capture — aggregate route-transition sequences from canonical events
  (`path` + `sessionId` + `occurredAt`) via the existing `rollups/` pipeline.
  No crawling, no customer install.
- Flow graph surfaced in the dashboard — nodes are pages/states, edges are
  transitions, each edge annotated with observed drop-off.
- The per-page brand-DNA snapshot becomes the per-node profile.

**Gate:** every active site has a derived flow graph; a PM can see drop-off per
transition.

### Milestone 3 — Journey experiments + flow-aware rules · ~2 weeks

Make a flow the unit of optimization.

- Experiment references a `flowId`, carries per-step `VariantModification[]`,
  and a `journeyMetric` (the flow's end-to-end conversion event).
- One flow-aware audit rule — inter-step drop-off — deterministic, routed
  through the existing rule framework and calibration. One rule, not a suite.
- `computeOutcomes` evaluates journey-level conversion; `stats.ts` reused
  unchanged.

**Gate:** a flow-level finding → multi-step variant → deployed via the runtime →
journey-level outcome measured.

### Milestone 4 — Brand DNA capture + AI Propose + Preview · ~3 weeks (parallelizable)

Finish the Sprint 3 surface — kept, not scrapped, because the vision needs it.

- Merge the design-snapshot schema + writer (PR #58, Zybit-141/142).
- Design token extraction (Zybit-143).
- AI Variant Advisor (Zybit-144/145/148) — proposes page-level *and* flow-level
  variants, constrained to real selectors from the snapshot and to the
  `VariantModification[]` schema. PM approves before deploy. Identify stays
  fully deterministic; AI is Propose-only.
- DOM element picker + while-editing live preview (Zybit-146/147).

**Gate:** a PM goes finding → AI-drafted variant → preview → launch in under ten
minutes, on either a page or a flow.

**Total:** ~10 weeks for 2 engineers with Milestone 4 overlapping 2–3.

---

## 7. What carries, what is genuinely new

`pivot.md` claimed roughly half the product is throwaway. The code does not
support that. Corrected:

| Carries unchanged | Extended | Genuinely new |
|-------------------|----------|---------------|
| Stats engine (`stats.ts`) | Experiment model (+ `flowId`, journey metric) | Client runtime SDK |
| Connectors (PostHog/Segment/GA4) | `computeOutcomes` (+ journey-level) | Flow graph + `flow` model |
| Bucketing | Audit rule set (+ 1 flow-aware rule) | Flow-aware audit rule |
| Findings + experiment lifecycle | Dashboard (+ flow views) | — |
| Learn L1/L2, rule calibration | Understand (+ flow capture) | — |
| `VariantModification` schema | — | — |
| Edge proxy (kept for HTML sites) | — | — |
| 12 page-level audit rules | — | — |

Nothing is thrown away. The proxy is frozen for new investment only in the sense
that *new delivery work goes into the runtime* — the proxy keeps serving HTML
sites for as long as customers run them.

---

## 8. Decisions ratified

These resolve `pivot.md` §8 and reconcile its conflicts (§9).

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Page-level vs flow-level | **Both** — synthesis, layered. Not a binary. |
| D2 | Freeze Sprint 3? | **No.** Sprint 3's design/AI/preview work is load-bearing for the vision; it becomes Milestone 4. |
| D3 | ICP | High-traffic, user-is-decision-maker products (PLG SaaS, consumer/prosumer). Not regulated/low-traffic B2B. |
| D4 | First substrate for the runtime | React SPAs first. |
| D5 | Positioning | Outcome-focused conversion intelligence — judged on conversion lift, not PM productivity. |
| D6 | Loop packaging | Advisory (audit + proposal) and one-click deploy ship together; deploy works wherever the substrate is supported. |
| D7 | Doctrine reconciliation | `DOCTRINE.md` and `ROADMAP.md` updated alongside this PRD. |

**Re-ratified locked decisions** (previously in `ROADMAP.md` / `pivot.md` §9):

- *Proxy mechanism* — no longer the *only* delivery mechanism. The proxy and the
  client runtime are two substrates of one delivery layer. Re-ratified as such.
- *Deterministic over generative* — **unchanged.** Identify stays 12 pure-function
  rules. The flow-aware rule (Milestone 3) is also a pure function. AI is
  Propose-only.
- *Autonomous deployment — never build* — **unchanged.** The PM approval gate
  stays. This PRD does not introduce autonomy.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Anti-flicker (FOOC) on client-side mutation | Highest-risk item; targeted pre-hide + hard timeout; gate Milestone 1 on zero visible flash |
| Runtime needs a customer install (proxy needed none) | One snippet, analytics-style; PLG customers already install analytics. Accepted tradeoff — the proxy cannot touch SPAs at all |
| Flow capture depends on event quality | Connector payloads carry `path`; verify route granularity is usable as a flow step before Milestone 2 build |
| "Flow completion" ambiguity | Each flow must define its end-to-end conversion event unambiguously, or journey measurement is noisy |
| Time to revenue under the full build | Milestones are independently shippable; the client runtime alone (M1) is a sellable capability before M2–M4 land |

---

## 10. Relationship to other documents

- `DOCTRINE.md` — what Zybit is and how we build it. Updated alongside this PRD.
- `docs/sprints/ROADMAP.md` — sprint-level execution. "Architectural decisions —
  locked" updated to record two delivery substrates.
- `docs/pivot.md` — superseded by this PRD; retained as the record of the
  discussion that produced it.
- `docs/sprints/sprint-3R.md` — its client-runtime and flow tickets feed
  Milestones 1–3; its "freeze Sprint 3" premise is overridden by D2.
- `docs/ARCHITECTURE.md` — technical companion; to be updated as Milestones land.

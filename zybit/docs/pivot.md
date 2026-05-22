# Zybit — Pivot Decision Record

**Status:** Proposed — not ratified. This document captures a strategic discussion
and the decisions it forces. Nothing here is locked. Where it conflicts with
`docs/sprints/ROADMAP.md` "Architectural decisions — locked", that conflict is
called out explicitly in [§9](#9-conflicts-with-currently-locked-decisions).

**Date:** 2026-05-22
**Owner:** —

---

## 1. Why this document exists

The current product mutates server-rendered HTML in-flight via an edge proxy. It
applies six cosmetic, single-element modifications to **one page at a time**. A
strategic review concluded this is a defensible *beachhead* but not a
venture-scale *destination*, and surfaced a question the roadmap does not
currently answer:

> Is Zybit a single-page cosmetic CRO tool, or a system that understands a
> software product's flow and changes it?

This document records the analysis and lists what must be **decided** and
**built** to resolve it.

---

## 2. The core finding — what we can change today vs. what we'd need

### What the current product can change

`src/lib/experiments/types.ts` — `VariantModification` supports exactly six
single-element operations:

| Type | Effect |
|------|--------|
| `css-inject` | Inject CSS for a selector |
| `text-replace` | Swap an element's text |
| `element-hide` | `display: none` |
| `element-show` | `display: block` |
| `attribute-set` | Set one HTML attribute |
| `element-reorder` | Reorder direct children of one parent via CSS `order` |

**Scope ceilings:**
- **Cosmetic only.** No new elements, no content creation, no DOM restructuring.
- **Single page.** An experiment targets one `targetPath` (or a site-wide CSS
  wildcard). No multi-page experiment, no funnel/flow object, no page-ordering.
- **Static-HTML only.** The proxy rewrites HTML at request time; on a SPA the
  target nodes don't exist yet. PR #60 (Zybit-123) *detects and warns* about
  this — it does not fix it. The product works worst on exactly the modern
  React/Vue software products it would most want to change.

### What the "software-product" version would need

- A **client-side runtime** that applies modifications *after* the SPA hydrates
  (removes the SPA ceiling entirely).
- An **experiment model that spans a sequence of pages** — a flow, not a
  `targetPath`.
- The ability to **restructure**, not just restyle: add/remove/reorder steps in
  a flow.
- A **flow graph** of the product so audit rules can reason across pages.

This is a different architecture, not an increment on the proxy.

---

## 3. The two GTM paths, side by side

| Dimension | **Path A — Wedge-first (cosmetic CRO now)** | **Path B — Reposition (in-app product optimization)** |
|---|---|---|
| Buyer | Growth marketer / growth PM | PLG product manager / head of product |
| Category | "AI-assisted CRO" — known, crowded | "Automated product-flow optimization" — largely uncontested |
| Wedge use case | Optimize landing / pricing / signup pages | Optimize one in-app flow (onboarding → activation) |
| Competitors | VWO, Optimizely, AB Tasty, Unbounce — entrenched, already shipping AI suggestions | Statsig / Eppo (BYO hypothesis + code), Pendo / Appcues (overlays, no audit, no loop) — nobody does the full loop |
| Sales motion | Self-serve / low-touch, marketing budget | Design partners → mid-touch, product budget, higher ACV |
| Time to first revenue | ~1 quarter | ~3–4 quarters |
| Primary risk | Competing on a *feature* incumbents also ship; SPA ceiling shrinks the market | Long build before revenue; trust barrier on touching a live product |

---

## 4. The two roadmaps

### Path A — Wedge-first

1. **Now–Q1:** Finish Sprint 3 as scoped (AI Variant Advisor, design capture,
   element picker). GA the cosmetic CRO product.
2. **Q1–Q2:** Sell to growth teams; accumulate logos + outcome data.
3. **Q2–Q3:** Hit the SPA ceiling in the field; begin the client-runtime rebuild.
4. **Q3–Q4+:** Re-platform onto a client runtime, then re-pitch to a different
   buyer. **This step is a cliff, not a ramp** — new architecture *and* new
   sales motion at once.

### Path B — Reposition now

1. **Now:** Freeze Sprint 3 as scoped; re-scope around a client-side runtime.
2. **Q1–Q2:** Build the runtime + a multi-page/flow experiment model.
3. **Q2–Q3:** Build flow-aware audit rules and AI "propose" for structural
   changes.
4. **Q3–Q4:** Design partners on in-app onboarding optimization. Revenue lands
   later — but every line of code is load-bearing toward the moat.

---

## 5. Is the current product a step toward the flow-aware version?

**Partially — and that is the trap.** Roughly half carries, half is throwaway.

| Carries (substrate-agnostic platform skeleton) | Throwaway (substrate-specific) |
|---|---|
| Core loop orchestration (findings → experiment lifecycle → dashboard) | Proxy / edge HTML-rewriting delivery layer |
| Statistical engine (chi-squared, sequential testing, guardrails, auto-stop) | Single-page `targetPath` experiment model |
| Analytics connectors (PostHog, Segment, GA4) | Cosmetic single-page audit rules |
| Audit *rule framework* (calibration, re-ranking) | Most of Sprint 3 as scoped (advisor + capture built around the 6 cosmetic mods + single-page snapshot) |
| | Cosmetic outcome data (does **not** transfer to flow recommendations) |
| | Growth-marketer GTM relationship + positioning |

**Conclusion:** the current product is a stepping stone for the *team's
understanding and the platform skeleton* — but **not for the moat and not for
the delivery architecture.** The "expand" step in Path A is a simultaneous
re-platform *and* re-sell to a new buyer. The longer the cosmetic path runs, the
more throwaway accumulates — and Sprint 3 is the next ~19 days of exactly that.

---

## 6. Positioning — this is not "Cursor for PMs"

"Cursor for PMs" denotes an **authoring copilot** — helps a PM produce artifacts
(PRDs, prototypes, roadmaps) faster. That space is large, growing, crowded, and
low-moat: it is squeezed by real coding tools (Cursor, Lovable, v0) and by
incumbents bolting AI onto workflows they already own. Most such plays are
features, not companies.

Zybit (flow-aware version) is an **outcome agent** — it audits a live product,
proposes a change, deploys it, measures it, learns. It is judged in **revenue
lift**, not in PM productivity. That is the better category to stand in:

- A copilot's ceiling is "the PM is 20% faster" — a nice-to-have.
- An outcome agent's ceiling is "activation went up X%" — a budget line.

**How we compete with products built for PMs:**
1. Do not compete on authoring/workflow — incumbents own that surface, no moat.
2. Compete by **owning an outcome** — be the system of record for "what we
   changed in the product and what it did to conversion."
3. Defensibility is **judgment from data**, not the act of editing. As agentic
   tools improve, *making* a change gets cheap; knowing *which* change stays
   hard.
4. Sell to the budget that cares about the number (PLG activation/conversion).
5. Mind the **trust ramp**: lead with the advisory half (audit + evidence-backed
   proposal), graduate to autonomous deploy as trust is earned.

---

## 7. Discovery signal — Vansh Gupta interview (2026-05-22)

PM at Kinetic Healthcare Solutions (regulated B2B healthcare-transportation
benefits). Treated as **thesis-validation + ICP-disqualification**, not a
roadmap input (N=1, non-ICP).

**Validates the thesis.** Unprompted, he articulated the journey-context
argument: testing a screen in isolation (the Amazon cart page) is misleading
because real users arrive with context — "prototype testing requires full
workflow context, not just isolated screens." A practising PM confirming that
single-page A/B testing measures the wrong unit.

**Disqualifies regulated B2B as the ICP for an online optimization agent:**
- Buyer ≠ user; users "don't care about A vs B"; results "convoluted and
  unreliable." They cope by hiring recruitment agencies — a
  segmentation/recruitment problem, not a deployment-tooling one.
- Low traffic (quarterly releases, niche populations) → no volume for
  significance.
- Compliance-gated deploy → the autonomous back half of the loop is blocked.

**Secondary signals:**
- The loop **splits into two halves with different requirements** — advisory
  (audit/propose) is broad; autonomous (deploy/measure/learn) needs traffic +
  user-is-buyer + deploy freedom. Sell accordingly.
- The **flow graph is confirmed-valuable infrastructure** — "no centralized tool
  exists for managing [screen] interconnections." Build it well, but do **not**
  pivot into a design-dependency / impact-management tool (that is the
  copilot knife-fight).
- **Measurement-design constraint** ("right and wrong simultaneously"): a
  flow-aware experiment on a step must be evaluated against the **journey-level
  outcome**, not the local screen metric.

---

## 8. Decisions required

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Wedge-first (Path A) or reposition now (Path B)? | **Reposition** — but to a *narrow vertical* of Path B, not the full platform. |
| D2 | If repositioning: stop Sprint 3 as scoped? | **Yes.** Do not spend ~19 days deepening the cosmetic single-page path. |
| D3 | ICP definition | High-traffic, user-is-decision-maker products (PLG SaaS, consumer/prosumer). **Explicitly not** regulated B2B / low-traffic / buyer ≠ user. |
| D4 | First vertical | One flow, one customer type — e.g. onboarding → activation for high-traffic PLG SaaS on React. |
| D5 | Category / positioning | "Outcome agent for product flow," not "Cursor for PMs," not "AI CRO." |
| D6 | Loop packaging | Acknowledge advisory vs. autonomous split; only promise the full loop where the substrate supports it. |
| D7 | Doctrine reconciliation | Resolve conflicts with currently-locked decisions — see §9. |

---

## 9. Conflicts with currently-locked decisions

Path B reopens decisions that `ROADMAP.md` and `AGENTS.md` currently treat as
locked. These must be explicitly re-ratified or this pivot cannot proceed:

- **"Proxy mechanism — locked"** (`ROADMAP.md`): "Mutate origin HTML in-flight
  via Vercel Middleware." Path B replaces this with a client-side runtime.
- **"Never build: autonomous deployment"** (`ROADMAP.md`, `AGENTS.md`): the
  outcome-agent positioning's end state is autonomous deploy behind a trust
  ramp. The advisory-first wedge keeps the PM approval gate; the long-term
  direction does not.
- **Sprint 3 "architecture decisions locked (do not re-litigate)"**
  (`sprint-3.md`): D2 explicitly re-litigates Sprint 3 scope.
- **"Deterministic over generative"** (`AGENTS.md`): unchanged for
  *Identify*. Still holds — flow-aware audit rules remain deterministic pure
  functions. The pivot does not loosen this.

---

## 10. If the pivot is chosen — what to build first

A **narrow vertical of Path B**, scoped to a Sprint-3-sized horizon (not a
year-long platform build):

1. **Thinnest client-side runtime** — an embeddable SDK that applies
   modifications *after* SPA hydration. Kills the SPA ceiling for one substrate
   (React first).
2. **Flow experiment model** — an experiment spans an ordered sequence of pages;
   primary metric defaults to the **journey-level** outcome.
3. **Flow capture** — build the product's flow graph (the asset Vansh's
   "interconnections" pain confirms is valuable).
4. **Flow-aware audit rules** — deterministic rules over the flow graph
   (inter-step drop-off, dead ends, redundant steps). Reuse the existing rule
   *framework*; the cosmetic single-page rules do not carry.
5. **Reuse, don't rebuild:** statistical engine, connectors, findings/experiment
   lifecycle, dashboard, rule-calibration framework.

**Next action:** scope this as a concrete Sprint 3 *replacement* — what it must
do, what to cut, what to reuse from the current codebase — and bring it back for
ratification of D1–D7.

---

## 11. Open questions

- Can the business afford ~3–4 quarters to first revenue under Path B, or is a
  short Path-A wedge required for runway? (If so: time-box it and treat all
  cosmetic work as knowingly disposable.)
- Which React-based PLG products are reachable as design partners *now*?
- Does the advisory-only half have standalone willingness-to-pay (it would also
  serve low-traffic B2B that the full loop cannot)?

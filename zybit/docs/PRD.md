# Zybit — Product Requirements Document

**Status:** Ratified scope. **One milestone.** Read-only.
**Date:** 2026-05-22
**Supersedes:** the earlier four-milestone version of this file, and
`docs/pivot.md`. Both expanded the surface area; this document deliberately
contracts it.

---

## 1. The decision

Build **one** increment: the **flow-graph advisory**. Read-only. It reuses the
event pipeline and statistics engine that already exist. It requires the
customer to install nothing and trust nothing.

Everything else — client runtime, journey experiments, one-click in-app
deploy, the full AI advisor, the DOM element picker — is **deferred**. Not
cancelled: deferred until a customer who already gets value from the advisory
asks to deploy a fix. Phase 2 is **pulled by a customer, not scheduled by us.**

### Why only this

AI accelerates writing code. It does not accelerate the things that actually
gate this product: getting a real customer to point Zybit at their funnel,
learning what change moves their metric, and earning enough trust to deploy to
their live app. Those are bound by calendar time and human trust. Building six
workstreams quickly just means owning ~30k lines of maintenance before knowing
which one mattered.

The flow-graph advisory is the smallest thing that is, all at once:
- **Undeniably valuable on its own** — "here is your product's shape and where
  you lose users" needs no further feature to be worth paying for.
- **True to the vision** — it is the literal "understand the product through
  and through" pillar.
- **Zero install, zero trust barrier** — no SDK, no proxy change, no write
  access to anyone's app, no SOC 2 gate.

It can be in front of a customer in weeks, not quarters.

---

## 2. What it is

From the analytics data a customer **already** sends Zybit, derive a map of how
users move through their product — every route, every transition, where they
drop off — and surface ranked, evidence-backed findings on that graph.

Nothing is deployed. The PM sees: *here is your product's shape, here is where
you lose people, here is the specific friction and the proposed fix.*

---

## 3. Scope — what is IN this milestone

| # | Item | Notes |
|---|------|-------|
| 1 | **Flow graph derivation** | Route-transition graph per site from canonical events (`path` + `sessionId` + `occurredAt`), built via the existing `src/lib/phase2/rollups/` pipeline. No crawling. |
| 2 | **Flow data model** | Minimal storage for the derived graph (nodes = routes/states, edges = transitions with observed drop-off). One migration. |
| 3 | **Flow graph view** | The dashboard surface: the graph, rendered, with per-edge drop-off. This is the product the PM looks at. |
| 4 | **One flow-aware finding** | An inter-step drop-off rule — deterministic, pure function, routed through the existing rule framework + calibration. The existing 12 page-level rules run unchanged on the graph's nodes. |
| 5 | **Credibility slice** | *Just* enough of the brand-DNA/preview work that a finding's proposed fix is shown visually and believably. **Hard edge:** if it can't be drawn in a day, it's out. No element picker, no AI advisor, no token extraction. |

---

## 4. Scope — what is NOT NOW

Each of these is deferred until a customer pulls it.

- Client-side runtime / embeddable SDK
- Journey experiments / per-step variant deployment
- One-click deploy inside SPAs / authenticated apps
- New investment in the edge proxy (it keeps running as-is for HTML sites)
- The full AI Variant Advisor
- The DOM element picker
- Design-token extraction beyond the §3.5 credibility slice
- Cross-site priors (unchanged: not before 50+ customers)

If a customer who values the advisory says *"now let me deploy the fix"* — that
is the signal to build the runtime. If they never say it, two quarters of
runtime engineering were correctly not spent.

---

## 5. The one hard dependency

The flow graph is only as good as the customer's analytics. If their PostHog /
Segment is not emitting pageview/route events at usable granularity, the graph
is thin and the demo falls flat.

**This is a per-customer prerequisite check, done before promising the graph —
not an afterthought.** It is the first thing to verify in any pilot.

---

## 6. Honest caveat on the moat

A read-only advisory does **not** by itself produce outcome-labeled data —
"which variant won, by how much" requires the deploy loop, which is explicitly
deferred. What this milestone produces is:

1. **Proprietary flow-friction data** — where users drop off, per product.
2. **Validated learning** — whether PMs find the findings credible and act on
   them. *This is the real output of the milestone.*

That second item is the decision input for everything else: it tells you
whether phase 2 (the runtime, journey experiments, one-click deploy) is worth
building at all.

---

## 7. Success test

Put the advisory in front of **one** PLG customer.

- Did they say *"now let me fix this"*? → Phase 2 is pulled. Build the runtime.
- Did they not? → You learned the advisory isn't enough, and you saved two
  quarters of runtime engineering finding that out.

Either outcome is a win. That is the point of sequencing it this way.

---

## 8. Milestone shape

~2–3 weeks. One engineer (two compresses it, the graph view is the long pole).
The spine it builds on — connectors, rollups, the 12 rules, the rule framework,
the dashboard, the stats engine — already exists and is reused unchanged.

---

## 9. Relationship to other documents

- `DOCTRINE.md` — product vision; "immediate priorities" reconciled to this
  single milestone.
- `docs/sprints/ROADMAP.md` — "delivery mechanism" note reconciled: the client
  runtime is a deferred, customer-pulled phase, not a scheduled milestone.
- `docs/pivot.md` — superseded; retained only as the record of the discussion.
- `docs/sprints/sprint-3R.md` — its flow-graph tickets feed this milestone; its
  client-runtime and journey-experiment tickets are deferred per §4.

# Zybit docs — start here

This is the entry point. Use the personas below to find the right
starting doc, then follow the cross-links from there.

For the canonical **"what is built right now"** table, jump straight to
[`../AGENTS.md`](../AGENTS.md) — *"Current build state."* That table is
the single source of truth; every other status mention in the docs
points back to it.

---

## If you are…

**…a new cofounder, board member, or hire** — read in this order:
1. [`../README.md`](../README.md) — what Zybit is in one screen
2. [`../DOCTRINE.md`](../DOCTRINE.md) — product vision, who it's for, build philosophy
3. [`PRD.md`](./PRD.md) — what we've committed to building (one milestone, read-only)
4. [`competitive-landscape.md`](./competitive-landscape.md) — where we stand vs. PostHog, Mutiny, Optimizely
5. [`curriculum.md`](./curriculum.md) — the founder's reading list

**…preparing for a pilot or design-partner conversation** —
1. [`sprints/pilot-readiness.md`](./sprints/pilot-readiness.md) — operational gates + day-1 runbook
2. [`sprints/posthog-from-zero.md`](./sprints/posthog-from-zero.md) — customer-facing recipe to share
3. [`sprints/operator-dashboard.md`](./sprints/operator-dashboard.md) — what `/admin/ops` shows you during incident response

**…deciding what to build next** —
1. [`sprints/next-bets.md`](./sprints/next-bets.md) — the priority list (engineering + non-engineering)
2. [`sprints/preview-system.md`](./sprints/preview-system.md) — credibility-slice depth (in-flight proposal)
3. [`sprints/url-audit-lead-magnet.md`](./sprints/url-audit-lead-magnet.md) — public Day-0 audit (Phases A + B shipped 2026-05-23, PR #69; Phase C/D deferred)
4. [`sprints/sprint-3-deferred.md`](./sprints/sprint-3-deferred.md) — why PR #66 + the rest of Sprint 3 stay parked

**…onboarding to the codebase as a new engineer** —
1. [`../AGENTS.md`](../AGENTS.md) — codebase map, conventions, build-state table
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — per-component file paths, schema, design decisions
3. [`PHASE2_EVIDENCE_MODEL.md`](./PHASE2_EVIDENCE_MODEL.md) — canonical event schema + audit-rule contract
4. [`phase2-rules-architecture.md`](./phase2-rules-architecture.md) — how the 13 rules compose
5. [`BACKLOG.md`](./BACKLOG.md) — prioritized epics + ticket IDs

**…operating Zybit (cron alerts, customer escalations, live debugging)** —
1. [`CAPTURE_RUNBOOK.md`](./CAPTURE_RUNBOOK.md) — headless-capture (Browserless) ops
2. [`PHASE2_LIVE_TUNING_PLAYBOOK.md`](./PHASE2_LIVE_TUNING_PLAYBOOK.md) — tuning rule constants against live data
3. [`sprints/operator-dashboard.md`](./sprints/operator-dashboard.md) — `/admin/ops` what + why
4. [`sprints/pilot-readiness.md`](./sprints/pilot-readiness.md) — environment gates + day-1 runbook

**…doing strategic / GTM thinking** —
1. [`competitive-landscape.md`](./competitive-landscape.md) — landscape map, wedge analysis, threats
2. [`sprints/next-bets.md`](./sprints/next-bets.md) — what to do next and why
3. [`PRD.md`](./PRD.md) — committed scope; what we deliberately defer
4. [`pivot.md`](./pivot.md) — historical decision record that produced the current PRD

---

## All docs by category

### Top of repo (canonical references)

| File | One-line summary |
|---|---|
| [`../README.md`](../README.md) | Project overview, local setup, env vars |
| [`../AGENTS.md`](../AGENTS.md) | **Canonical "current build state" table** + codebase map + repo conventions |
| [`../DOCTRINE.md`](../DOCTRINE.md) | Product vision, who it's for, the six-step loop, build philosophy |
| [`../CLAUDE.md`](../CLAUDE.md) | Claude Code session notes (imports AGENTS.md) |
| [`../../product_gap.md`](../../product_gap.md) | Historical gap analysis + architectural reasoning (status table replaced by pointer to AGENTS.md) |

### Vision + scope

| File | One-line summary |
|---|---|
| [`PRD.md`](./PRD.md) | **Ratified scope:** one read-only milestone (flow-graph advisory). Everything else deferred until customer pull |
| [`pivot.md`](./pivot.md) | Superseded decision record — kept as the historical context that produced the PRD |
| [`BACKLOG.md`](./BACKLOG.md) | Prioritized epics, stories, ticket IDs |

### Technical reference

| File | One-line summary |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Per-component file paths, schema, design decisions (the *technical* reference; status lives in AGENTS.md) |
| [`PHASE2_EVIDENCE_MODEL.md`](./PHASE2_EVIDENCE_MODEL.md) | Canonical event schema + audit-rule contract — for integrators and design-partner engineers |
| [`phase2-rules-architecture.md`](./phase2-rules-architecture.md) | How the 13 audit rules compose; modularity + scalability analysis |

### Operator runbooks

| File | One-line summary |
|---|---|
| [`CAPTURE_RUNBOOK.md`](./CAPTURE_RUNBOOK.md) | Headless-capture (Browserless) pipeline — how it works, how to debug |
| [`PHASE2_LIVE_TUNING_PLAYBOOK.md`](./PHASE2_LIVE_TUNING_PLAYBOOK.md) | Tuning audit-rule constants against live PostHog traffic |

### Strategy + founder docs

| File | One-line summary |
|---|---|
| [`competitive-landscape.md`](./competitive-landscape.md) | Competitor map per loop layer, wedge analysis, PostHog threat assessment, where the moat lives |
| [`curriculum.md`](./curriculum.md) | Curated founders' reading list — 3 tracks, 35 resources, quarterly anchoring exercise |

### In-flight proposals (sprints/)

| File | One-line summary |
|---|---|
| [`sprints/next-bets.md`](./sprints/next-bets.md) | Forward-looking priority list (engineering bets + non-engineering cofounder items) |
| [`sprints/preview-system.md`](./sprints/preview-system.md) | Spec for the preview-of-suggested-changes system (3-phase, ~8-10 dev-days for v1) |
| [`sprints/url-audit-lead-magnet.md`](./sprints/url-audit-lead-magnet.md) | Public URL-paste audit endpoint — Phases A + B shipped 2026-05-23 (PR #69); Phase C founder-approval queue + Phase D marketing surface deferred |
| [`sprints/onboarding-redesign.md`](./sprints/onboarding-redesign.md) | Redesign that contracted onboarding from 4 → 3 steps (shipped) |
| [`sprints/operator-dashboard.md`](./sprints/operator-dashboard.md) | Zybit-156 — `/admin/ops` read-only ops view (shipped) |
| [`sprints/sprint-3-deferred.md`](./sprints/sprint-3-deferred.md) | Why PR #66 + the rest of Sprint 3 stay parked, and the explicit unfreeze trigger |
| [`sprints/pilot-readiness.md`](./sprints/pilot-readiness.md) | Operational checklist — env gates, pre-pilot questions, day-1 runbook, end-of-pilot decision tree |
| [`sprints/posthog-from-zero.md`](./sprints/posthog-from-zero.md) | Customer-facing recipe — zero to a connected Zybit account in ~30 minutes |

### Sprint history (sprints/sprint-N.md)

These are the original sprint plans. Treat as historical record;
current truth is in [`../AGENTS.md`](../AGENTS.md) + [`sprints/REMEDIATION.md`](./sprints/REMEDIATION.md).

| File | One-line summary |
|---|---|
| [`sprints/_archive/sprint-0.md`](./sprints/_archive/sprint-0.md) | Verification & hardening — confirm built features actually work under live conditions (archived: complete) |
| [`sprints/_archive/sprint-1.md`](./sprints/_archive/sprint-1.md) | Demo readiness — full demo script runnable end-to-end (archived: complete) |
| [`sprints/_archive/sprint-2.md`](./sprints/_archive/sprint-2.md) | Selector robustness — experiments never silently break after customer redeploys (archived: complete) |
| [`sprints/sprint-3.md`](./sprints/sprint-3.md) | Design capture & AI variant advisor (largely deferred per PRD — see `sprint-3-deferred.md`) |
| [`sprints/sprint-3R.md`](./sprints/sprint-3R.md) | Sprint 3 *replacement* proposal (client runtime & flow experiments) — superseded by the PRD |
| [`sprints/sprint-4.md`](./sprints/sprint-4.md) | Observability & multi-customer ops — supportable remotely |
| [`sprints/sprint-5.md`](./sprints/sprint-5.md) | Learn Layer 2 — per-site rule-threshold calibration |
| [`sprints/REMEDIATION.md`](./sprints/REMEDIATION.md) | Definitive per-ticket status across sprints 0–5 (use this, not the individual sprint docs) |
| [`sprints/ROADMAP.md`](./sprints/ROADMAP.md) | Original sprint-shaped technical roadmap (forward-looking work now lives in `next-bets.md`) |

---

## How this index is maintained

This file is regenerated by Claude Code, not hand-maintained.

- **When you add a new doc:** ask Claude Code to *"regenerate
  docs/INDEX.md to include the new doc(s)."*
- **When a doc's purpose changes substantially:** ask Claude Code to
  update its one-line summary here.
- **The persona-routed section** at the top is the most opinionated
  part of this file. It should be challenged every quarter during the
  curriculum's anchoring exercise — does the routing still match
  what new readers actually need?

---

## What changed when this index was created (2026-05-23)

Three duplications were collapsed so build-state lives in one place:

1. `DOCTRINE.md` "Where we are today" — replaced its per-feature
   status with a pointer to `AGENTS.md`. Kept the unique parts
   (immediate priorities, what we deliberately do not build).
2. `product_gap.md` — replaced its status header + "State of the
   Product Today" table with a pointer to `AGENTS.md`. Kept the
   historical gap-by-gap architectural reasoning.
3. `docs/ARCHITECTURE.md` — kept the technical component reference
   intact; added a one-line note at the top of "What Exists"
   clarifying that *status* lives in AGENTS.md and *technical detail*
   lives there. The two are complementary.

Net effect: when a feature ships, exactly **one** file
(`AGENTS.md`) needs its status updated. The rest stay valid.

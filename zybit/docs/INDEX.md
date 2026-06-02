# Zybit docs — start here

Entry point for the docs. For the canonical **"what is built right now"**
state, go straight to [`../AGENTS.md`](../AGENTS.md) — *"Current build
state."* That table is the single source of truth; every other status
mention points back to it.

> **Note (core-refocus, 2026-05-30):** the per-sprint logs
> (`docs/sprints/`) and the point-in-time handover docs were removed to
> cut documentation bloat. Session history now lives only in
> [`../DEVLOG.md`](../DEVLOG.md); definitive build state lives in
> [`../AGENTS.md`](../AGENTS.md). Recover anything older from git history.

---

## If you are…

**…new to Zybit (cofounder, hire, board)** — read in order:
1. [`../README.md`](../README.md) — what Zybit is in one screen
2. [`../DOCTRINE.md`](../DOCTRINE.md) — product vision, who it's for, build philosophy
3. [`PRD.md`](./PRD.md) — committed scope (one milestone, read-only)
4. [`competitive-landscape.md`](./competitive-landscape.md) — where we stand vs. PostHog, Mutiny, Optimizely

**…onboarding to the codebase** —
1. [`../AGENTS.md`](../AGENTS.md) — codebase map, conventions, build-state table
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — per-component file paths, schema, design decisions
3. [`PHASE2_EVIDENCE_MODEL.md`](./PHASE2_EVIDENCE_MODEL.md) — event schema + audit-rule contract
4. [`phase2-rules-architecture.md`](./phase2-rules-architecture.md) — how the audit rules compose
5. [`BACKLOG.md`](./BACKLOG.md) — prioritized epics + ticket IDs

**…operating Zybit (ops, debugging, tuning)** —
1. [`CAPTURE_RUNBOOK.md`](./CAPTURE_RUNBOOK.md) — headless-capture (Browserless) ops
2. [`PHASE2_LIVE_TUNING_PLAYBOOK.md`](./PHASE2_LIVE_TUNING_PLAYBOOK.md) — tuning rule constants against live data

**…doing strategy / GTM** —
1. [`competitive-landscape.md`](./competitive-landscape.md) — landscape, wedge, threats
2. [`PRD.md`](./PRD.md) — committed scope; what we defer
3. [`pivot.md`](./pivot.md) — historical decision record behind the current PRD
4. [`curriculum.md`](./curriculum.md) — the founder's reading list

---

## All docs

### Canonical (top of repo)

| File | Summary |
|---|---|
| [`../README.md`](../README.md) | Project overview, local setup, env vars |
| [`../AGENTS.md`](../AGENTS.md) | **Canonical "current build state"** + codebase map + repo conventions |
| [`../DOCTRINE.md`](../DOCTRINE.md) | Product vision, who it's for, the six-step loop, build philosophy |
| [`../DEVLOG.md`](../DEVLOG.md) | Per-session work log (replaces the old sprint docs) |
| [`../CLAUDE.md`](../CLAUDE.md) | Claude Code session notes (imports AGENTS.md) |
| [`../../product_gap.md`](../../product_gap.md) | Historical gap analysis + architectural reasoning |

### Vision + scope

| File | Summary |
|---|---|
| [`PRD.md`](./PRD.md) | Ratified scope: one milestone; everything else deferred until customer pull |
| [`pivot.md`](./pivot.md) | Superseded decision record — historical context behind the PRD |
| [`BACKLOG.md`](./BACKLOG.md) | Prioritized epics, stories, ticket IDs |
| [`competitive-landscape.md`](./competitive-landscape.md) | Landscape map, wedge analysis, threats |
| [`curriculum.md`](./curriculum.md) | Founder's reading list |

### Technical reference

| File | Summary |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Per-component file paths, schema, design decisions |
| [`PHASE2_EVIDENCE_MODEL.md`](./PHASE2_EVIDENCE_MODEL.md) | Canonical event schema + audit-rule contract |
| [`phase2-rules-architecture.md`](./phase2-rules-architecture.md) | How the audit rules compose |
| [`CAPTURE_RUNBOOK.md`](./CAPTURE_RUNBOOK.md) | Headless-capture (Browserless) ops |
| [`PHASE2_LIVE_TUNING_PLAYBOOK.md`](./PHASE2_LIVE_TUNING_PLAYBOOK.md) | Tuning rule constants against live data |
| [`fix-tn.md`](./fix-tn.md) | Fix/troubleshooting notes |
| [`region-replace-handover.md`](./region-replace-handover.md) | Build spec / handover for the `region-replace` modification type + fail-loud anchor guard (not started) |

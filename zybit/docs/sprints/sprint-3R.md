# Sprint 3R — Client Runtime & Flow Experiments

**Status:** Proposed — not ratified. This sprint **replaces** the original
Sprint 3 (Design Capture & AI Variant Advisor) *if* the pivot in
[`../pivot.md`](../pivot.md) is approved. It is contingent on decisions D1–D7
in that document. Do not start until the pivot is ratified.

**Duration:** ~4 weeks (2 engineers) — larger than the original 3-week Sprint 3.
**Goal:** Close the audit → propose → deploy → measure loop on **one multi-page
flow** in a **real SPA**, via a **client-side runtime** instead of the edge
proxy. This proves the flow-aware thesis on a contained build.

**Why this replaces the original Sprint 3:** the original sprint deepened the
single-page cosmetic path (AI advisor + design capture built around the six
cosmetic mods and a single-page snapshot). Per `pivot.md` §5 that work is
~throwaway against the flow-aware direction. This sprint spends the same
calendar on load-bearing infrastructure instead.

---

## Scope frame

**This sprint is the thinnest vertical of `pivot.md` Path B** — one flow, one
substrate (React SPAs first), one new audit rule. It is not the full platform.
AI "propose" for structural changes is explicitly deferred to a later sprint;
variants are built manually in this one.

**Conflicts with currently-locked decisions** (must be re-ratified — see
`pivot.md` §9):
- `ROADMAP.md` "Proxy mechanism — locked" — this sprint introduces a client
  runtime alongside the proxy.
- `sprint-3.md` "architecture decisions locked (do not re-litigate)" — this
  sprint supersedes that scope.

**Still holds:** "Deterministic over generative" (`AGENTS.md`). The new
flow-aware audit rule (Zybit-177) is a pure function, same as the existing 12.

---

## Gate criteria

- [ ] A PM can take a flow-level finding, build a multi-step variant, deploy it
      via the SDK snippet to a real React SPA, and see journey-level outcome
      measurement.
- [ ] Client runtime applies all six `VariantModification` types after SPA
      hydration, including across client-side route changes.
- [ ] No visible flash of original content (FOOC) on the target elements.
- [ ] Flow graphs derived from behavioral data for all active sites.
- [ ] One flow-aware audit rule (inter-step drop-off) emitting flow-level
      findings.
- [ ] Outcome computation evaluates end-to-end flow conversion, not a per-page
      metric.

---

## Tickets

ID block **Zybit-170 – Zybit-179** (the original Zybit-141–152 are superseded —
see "What to cut" below).

### Zybit-170 — Flow data model + migration
**Estimate:** 1d

New `flow` concept: an ordered list of steps, each step a page/route. Experiment
references a flow and carries per-step `VariantModification[]`. Add a
journey-outcome metric field (the flow's end-to-end conversion event).
- New tables: `flow` (id, siteId, name, ordered steps as JSONB or child rows).
- Extend `forge_experiments`: `flowId`, per-step modifications, `journeyMetric`.
- The single-page `targetPath` path stays for legacy proxy experiments.

### Zybit-171 — Flow capture from behavioral data
**Estimate:** 2.5d

Derive flow graphs by **observing**, not crawling. Aggregate route-transition
sequences from canonical events into a flow graph per site. Reuse the
`src/lib/phase2/rollups/` pipeline.
- Prerequisite check: confirm PostHog/Segment payloads carry route/page
  identifiers usable as flow steps. If not, this ticket grows.

### Zybit-172 — Client runtime SDK: core
**Estimate:** 4d

Embeddable script-tag snippet (analytics-style install). Loads experiment config
for the site, buckets the visitor (port bucketing from the proxy), waits for
target selectors to exist post-hydration (MutationObserver), applies all six
`VariantModification` types via the DOM API, persists assignment.
- Works on SPAs because it runs client-side after hydration — this is the whole
  point of the pivot.

### Zybit-173 — Client runtime SDK: SPA route awareness
**Estimate:** 2d

Hook the History API (`pushState`/`replaceState`/`popState`). On client-side
route change, re-evaluate which flow step is active and apply that step's
modifications. This is what makes an experiment span a *flow* rather than a
single page load.

### Zybit-174 — Anti-flicker (FOOC) guard
**Estimate:** 1.5d

Client-side mutation has a flash-of-original-content problem. Synchronous
pre-hide of target elements (not the whole body) with a hard timeout fallback,
applied before first paint. This is the hardest UX problem in client-side
experimentation — budget care here.

### Zybit-175 — Runtime config + event ingest endpoints
**Estimate:** 2d

`GET` experiment/flow config for a site; `POST` assignment + conversion events.
Adapt the existing `/api/proxy/` config + assignment endpoints rather than
rebuilding.

### Zybit-176 — Flow experiment builder UI
**Estimate:** 3d

Multi-step variant builder: attach modifications to each step of a flow; primary
metric defaults to journey completion. Reuse the existing experiment-builder
shell and selector-suggestion/validation components.

### Zybit-177 — Flow-aware audit rule: inter-step drop-off
**Estimate:** 2d

One deterministic rule over the flow graph: identify the step that loses the
most users relative to expectation. Emits a flow-level finding. Reuse the rule
framework (calibration, re-ranking). **Only one rule this sprint** — do not
build a flow-rule suite yet.

### Zybit-178 — Journey-level outcome measurement
**Estimate:** 2d

Outcome computation evaluates the flow's end-to-end conversion, not a per-page
metric (the "right and wrong simultaneously" constraint from `pivot.md` §7).
Adapt `computeOutcomes` and reuse `stats.ts` (chi-squared, sequential testing,
guardrails) unchanged.

### Zybit-179 — SDK install onboarding
**Estimate:** 1.5d

Snippet generation per site + install verification (detect a
`_zybit_runtime_loaded` signal, mirroring the existing PostHog bridge health
probe, Zybit-126).

**Total: ~23.5d ≈ 4 weeks for 2 engineers.**

---

## What to cut

| Cut | Was | Disposition |
|-----|-----|-------------|
| Zybit-141–148 (design capture, AI Variant Advisor, DOM element picker, side-by-side preview, AI rate-limiting) | Original Sprint 3 | Dropped. Element picker + live preview may return later, adapted to the runtime. AI "propose" deferred to a post-3R sprint. |
| Edge proxy (`src/lib/experiments/proxy/`, `src/app/api/proxy/`, middleware) | "Locked" delivery mechanism | Frozen — kept running for existing cosmetic experiments, no new investment. Removed once no live proxy experiments remain. |
| SPA guard (`spaGuard.ts`, PR #60) | Zybit-123 | Becomes moot for runtime experiments (the runtime works on SPAs). Keep only for legacy proxy experiments. |

---

## What to reuse (do not rebuild)

- **`stats.ts`** — chi-squared, OBF sequential testing, guardrails, auto-stop.
  Substrate-agnostic; used as-is by Zybit-178.
- **Connectors** — PostHog / Segment / GA4 ingestion unchanged.
- **Findings + experiment lifecycle + dashboard shell** — extended, not replaced.
- **Rule framework + calibration** (`ruleCalibration.ts`, re-ranking) — the new
  flow rule routes through it.
- **Bucketing logic** — ported from the proxy into the runtime (Zybit-172).
- **`VariantModification` schema** — the six types apply client-side via the DOM
  API; semantics unchanged.

---

## Risks

- **Anti-flicker (Zybit-174)** is the highest-risk item — a visible flash
  undermines trust in the product. If it slips, it slips the gate.
- **Snippet install friction** — the proxy needed zero customer install; the
  runtime needs one snippet. Accepted tradeoff: the proxy cannot do SPAs at all.
- **Flow capture depends on event quality** — if connector payloads lack route
  identifiers, Zybit-171 grows. Verify first (it is the prerequisite check in
  that ticket).
- **"Flow completion" must be defined unambiguously** per flow, or journey-level
  measurement (Zybit-178) produces noise.

---

## Out of scope (explicitly deferred)

- AI "propose" for structural flow changes — post-3R sprint.
- A suite of flow-aware audit rules — only one this sprint.
- Add/remove/reorder *steps* in a flow (structural flow editing) — this sprint
  modifies elements *within* steps; flow restructuring is a later capability.
- Non-React SPA support, server-rendered-only optimizations.

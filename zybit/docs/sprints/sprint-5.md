# Sprint 5 — Learn Layer 2: Per-Site Rule Calibration

**Duration:** 2 weeks
**Goal:** After 3+ concluded experiments per site, Zybit's rule engine adapts its thresholds to that site's specific traffic patterns. False positives decrease. Finding quality improves without human tuning.

**Prerequisite:** At least one customer has run 3+ concluded experiments. Do not start this sprint until that data exists — the calibration logic has nothing to train on until then.

---

## Gate criteria

- [ ] `zybit_rule_overrides` table stores per-site threshold adjustments
- [ ] Calibration job computes overrides from outcome history
- [ ] Rule engine reads overrides at evaluation time
- [ ] "Tuned for your site" label appears on findings where overrides applied

---

## Zybit-161 — `zybit_rule_overrides` schema
**Estimate:** 0.5d | **Owner:** —

**What:** Per-site, per-rule threshold overrides derived from outcome history.

```sql
zybit_rule_overrides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siteId       UUID NOT NULL REFERENCES phase1_sites(id),
  ruleId       TEXT NOT NULL,
  thresholdKey TEXT NOT NULL,   -- e.g. 'BOUNCE_RATE_THRESHOLD', 'MIN_SESSION_COUNT'
  defaultValue NUMERIC NOT NULL,
  overrideValue NUMERIC NOT NULL,
  computedAt   TIMESTAMPTZ NOT NULL,
  outcomeCount INT NOT NULL,    -- how many outcomes informed this override
  UNIQUE (siteId, ruleId, thresholdKey)
)
```

**Files:** `src/lib/db/schema.ts`, new migration

---

## Zybit-162 — Calibration job
**Estimate:** 5d | **Owner:** —

**What:** After each batch of outcome data, compute per-site threshold adjustments for rules that have enough concluded experiments.

**Algorithm per rule per site:**
1. Collect all concluded experiments that fired this rule for this site
2. Separate into `positive` (variant won) and `negative`/`inconclusive` outcomes
3. For each threshold parameter (e.g., `BOUNCE_RATE_THRESHOLD`):
   - Compute the median observed value at the time the rule fired for positive outcomes
   - Compute the median for negative outcomes
   - New threshold = weighted midpoint, biased toward positive-outcome values
   - Clamp to ±30% of the global default to prevent runaway adjustment
4. Write to `zybit_rule_overrides` (upsert)
5. Minimum: 3 concluded experiments before any override is written

**Cron:** Weekly, Sunday 4am UTC, after the nightly snapshot refresh.

**Files:**
- `src/app/api/phase2/cron/calibrate-rules/route.ts` (new)
- `src/lib/phase2/rules/calibration.ts` (new — pure calibration math, fully testable)
- `vercel.json` — add cron

---

## Zybit-163 — Rule engine reads per-site overrides
**Estimate:** 2d | **Owner:** —

**What:** When `runAuditRules()` runs, load any `zybit_rule_overrides` for the current site and pass them into each rule's evaluation context. Rules read from context rather than hardcoded constants.

**Steps:**
1. Add `thresholdOverrides?: Record<string, number>` to `AuditRuleContext` in `types.ts`
2. Update `runAuditRules()` orchestrator to query overrides for `ctx.siteId` before evaluation
3. Each rule: replace `const BOUNCE_RATE_THRESHOLD = 0.6` references with `ctx.thresholdOverrides?.BOUNCE_RATE_THRESHOLD ?? 0.6`
4. This is mechanical but touches all 12 rule files — do it systematically, rule by rule, with tests passing after each

**Files:** `src/lib/phase2/rules/types.ts`, `src/lib/phase2/rules/runAuditRules.ts`, all 12 rule files

---

## Zybit-164 — "Tuned for your site" label
**Estimate:** 1d | **Owner:** —

**What:** When a finding was produced using one or more per-site overrides, surface a badge so the PM understands the finding is calibrated to their traffic patterns.

**Steps:**
1. Add `calibrated: boolean` and `calibrationNote?: string` to `AuditFinding` output type
2. When any threshold override was applied during evaluation, set `calibrated: true` and `calibrationNote: "Thresholds adjusted based on 5 previous experiments on this site"`
3. Persist on `forge_findings.learnAdjustment` (alongside existing `learn_adjustment` jsonb)
4. Render a small "Tuned" badge in the findings backlog row and finding detail header

**Files:** `src/lib/phase2/rules/types.ts`, findings backlog component, finding detail page

---

## Zybit-165 — Calibration visibility for operators
**Estimate:** 1d | **Owner:** —

**What:** Operator dashboard (from Sprint 4) gets a calibration tab: which rules have been overridden for which sites, how many outcomes informed each override, and what the delta is.

**UI:** Table per site — rule | threshold | default | override | delta | outcome count | last computed.

**Files:** `src/app/app/operator/page.tsx`, `src/app/api/operator/status/route.ts`

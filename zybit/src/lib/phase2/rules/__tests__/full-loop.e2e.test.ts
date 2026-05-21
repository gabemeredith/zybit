/**
 * Full-loop E2E regression net (Zybit-120).
 *
 * Walks the whole optimize cycle as pure functions — no DB — so CI catches a
 * regression in any single leg:
 *
 *   detect      runAuditRules(events, snapshots) → findings
 *   measure     synthesize concluded experiment outcomes for a finding's rule
 *   learn (L1)  applyLearnRerank(findings, outcomes) → re-ranked + receipts
 *   learn (L2)  computeRuleCalibrations(outcomes) → per-rule floor multipliers
 *   re-detect   runAuditRules with the calibration applied → the loop closes:
 *               a borderline signal the base floor suppressed now surfaces.
 *
 * The DB-backed version of this loop is exercised by the Lighthouse runner;
 * this is the deterministic regression net that runs in unit CI.
 */

import { describe, it, expect } from 'vitest';
import { runAuditRules } from '@/lib/phase2/rules/index';
import { applyLearnRerank } from '@/lib/phase2/rules/learnReranker';
import { computeRuleCalibrations } from '@/lib/phase2/rules/ruleCalibration';
import { makeContext, makePageView, makeRageClick } from './fixtures';
import type { ExperimentOutcomeRow } from '@/lib/phase2/outcomes/repository';
import type { AuditRuleContext } from '@/lib/phase2/rules/types';

const RULE = 'rage-click-target';
const PATH = '/app';

function strongRageContext(): AuditRuleContext {
  // 150 sessions, 30 with rage clicks = 20% rage rate — well above the 5% floor.
  const events = [
    ...Array.from({ length: 150 }, (_, i) => makePageView(PATH, `s-${i}`)),
    ...Array.from({ length: 30 }, (_, i) => makeRageClick(PATH, 'Submit form', `s-${i}`)),
  ];
  return makeContext(events);
}

function borderlineRageContext(): AuditRuleContext {
  // 6 rage clicks across 150 sessions = 4% — below base 5% floor, above the
  // loosened 3.5% floor (×0.70).
  const events = [
    ...Array.from({ length: 150 }, (_, i) => makePageView(PATH, `b-${i}`)),
    ...Array.from({ length: 6 }, (_, i) => makeRageClick(PATH, 'Submit form', `b-${i}`)),
  ];
  return makeContext(events);
}

function winningOutcome(id: string): ExperimentOutcomeRow {
  return {
    id,
    experimentId: `exp-${id}`,
    ruleId: RULE,
    pathRef: PATH,
    modificationType: 'text-replace',
    result: 'positive',
    liftPct: 15,
    confidence: 0.95,
    guardrailBreached: null,
    concludedAt: new Date('2026-03-15T00:00:00Z'),
  };
}

describe('full optimize loop — detect → measure → learn → re-detect', () => {
  it('detects a finding from raw events', () => {
    const findings = runAuditRules(strongRageContext()).findings;
    const rage = findings.find((f) => f.ruleId === RULE && f.pathRef === PATH);
    expect(rage, 'expected a rage-click-target finding on /app').toBeDefined();
    // Detection emits a testable prescription so the loop can continue.
    expect(rage!.prescription?.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('Layer 1: past wins boost the matching finding and attach a receipt', () => {
    const findings = runAuditRules(strongRageContext()).findings;
    const outcomes = [winningOutcome('o1'), winningOutcome('o2'), winningOutcome('o3')];

    const reranked = applyLearnRerank(findings, outcomes);
    const rage = reranked.find((f) => f.ruleId === RULE && f.pathRef === PATH)!;
    const base = findings.find((f) => f.ruleId === RULE && f.pathRef === PATH)!;

    expect(rage.learnAdjustment).toBeDefined();
    expect(rage.learnAdjustment!.direction).toBe('boost');
    expect(rage.priorityScore).toBeGreaterThanOrEqual(base.priorityScore);
  });

  it('Layer 2: the same wins loosen the rule’s detection floor', () => {
    const outcomes = [winningOutcome('o1'), winningOutcome('o2'), winningOutcome('o3')];
    const cal = computeRuleCalibrations(outcomes).get(RULE);
    expect(cal?.direction).toBe('loosen');
    expect(cal!.multiplier).toBeLessThan(1);
  });

  it('loop closes: the loosened floor surfaces a borderline signal the base suppressed', () => {
    const outcomes = [winningOutcome('o1'), winningOutcome('o2'), winningOutcome('o3')];
    const calibration = computeRuleCalibrations(outcomes);

    // Base floor: 4% rage rate does not fire.
    const baseFindings = runAuditRules(borderlineRageContext()).findings;
    expect(baseFindings.some((f) => f.ruleId === RULE)).toBe(false);

    // After learning from past wins on this site, the same borderline signal fires.
    const ctx = borderlineRageContext();
    ctx.calibration = calibration;
    const learnedFindings = runAuditRules(ctx).findings;
    const rage = learnedFindings.find((f) => f.ruleId === RULE && f.pathRef === PATH);
    expect(rage, 'loosened floor should surface the 4% rage finding').toBeDefined();
    expect(rage!.calibration?.direction).toBe('loosen');
  });

  it('is deterministic: identical inputs produce identical findings', () => {
    const a = runAuditRules(strongRageContext()).findings.map((f) => f.id);
    const b = runAuditRules(strongRageContext()).findings.map((f) => f.id);
    expect(a).toEqual(b);
  });
});

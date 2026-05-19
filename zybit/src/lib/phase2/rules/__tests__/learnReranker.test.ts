import { describe, it, expect } from 'vitest';
import { applyLearnRerank, __learnRerankerInternals } from '@/lib/phase2/rules/learnReranker';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import type { ExperimentOutcomeRow } from '@/lib/phase2/outcomes/repository';

const { TIER_STRENGTH, LIFT_SCALE, DELTA_CLAMP, VISIBILITY_THRESHOLD } = __learnRerankerInternals;

// --- factories ---------------------------------------------------------------

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 'form-abandonment:/signup',
    ruleId: 'form-abandonment',
    category: 'abandonment',
    severity: 'warn',
    confidence: 0.8,
    priorityScore: 0.5,
    pathRef: '/signup',
    title: 'test',
    summary: 'test',
    recommendation: [],
    evidence: [],
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<ExperimentOutcomeRow> = {}): ExperimentOutcomeRow {
  return {
    id: `outcome-${Math.random().toString(36).slice(2)}`,
    ruleId: 'form-abandonment',
    pathRef: '/signup',
    modificationType: 'text-replace',
    result: 'positive',
    liftPct: 10,
    confidence: 0.96,
    guardrailBreached: null,
    concludedAt: new Date('2026-03-15T00:00:00Z'),
    ...overrides,
  };
}

// --- cascade selection -------------------------------------------------------

describe('cascade selection', () => {
  it('no outcomes → no adjustment, sorted by priorityScore', () => {
    const findings = [makeFinding({ priorityScore: 0.3 }), makeFinding({ id: 'b', priorityScore: 0.9 })];
    const result = applyLearnRerank(findings, []);
    expect(result[0].priorityScore).toBe(0.9);
    expect(result[1].priorityScore).toBe(0.3);
    expect(result[0].learnAdjustment).toBeUndefined();
    expect(result[1].learnAdjustment).toBeUndefined();
  });

  it('Tier 4 only (different page, same rule) → uses Tier 4', () => {
    const finding = makeFinding({ pathRef: '/checkout' });
    const outcome = makeOutcome({ pathRef: '/signup' });
    const result = applyLearnRerank([finding], [outcome]);
    expect(result[0].learnAdjustment?.tier).toBe(4);
  });

  it('Tier 2 match takes precedence over Tier 4', () => {
    const finding = makeFinding({ pathRef: '/checkout' });
    const samePathOutcome = makeOutcome({ pathRef: '/checkout' });
    const otherPathOutcome = makeOutcome({ pathRef: '/signup' });
    const result = applyLearnRerank([finding], [samePathOutcome, otherPathOutcome]);
    expect(result[0].learnAdjustment?.tier).toBe(2);
    // Only the Tier 2 match should be in basedOnOutcomeIds, not the Tier 4 one.
    expect(result[0].learnAdjustment?.basedOnOutcomeIds).toEqual([samePathOutcome.id]);
  });

  it('outcomes for a different rule are ignored entirely', () => {
    const finding = makeFinding();
    const outcome = makeOutcome({ ruleId: 'hero-hierarchy-inversion' });
    const result = applyLearnRerank([finding], [outcome]);
    expect(result[0].learnAdjustment).toBeUndefined();
  });
});

// --- weight math (D-with-guardrails) ----------------------------------------

describe('weight math', () => {
  it('single Tier 2 win at +10%, 0.96 conf → visible boost', () => {
    const finding = makeFinding();
    const outcome = makeOutcome({ liftPct: 10, confidence: 0.96 });
    const result = applyLearnRerank([finding], [outcome]);
    const expected = 10 * 0.96 * TIER_STRENGTH[2] * LIFT_SCALE;
    expect(result[0].learnAdjustment?.delta).toBeCloseTo(expected, 5);
    expect(result[0].learnAdjustment?.visible).toBe(true);
    expect(result[0].learnAdjustment?.direction).toBe('boost');
  });

  it('single Tier 4 win at +10%, 0.96 conf → invisible (below threshold)', () => {
    const finding = makeFinding({ pathRef: '/other' });
    const outcome = makeOutcome({ pathRef: '/signup', liftPct: 10, confidence: 0.96 });
    const result = applyLearnRerank([finding], [outcome]);
    const delta = result[0].learnAdjustment?.delta ?? 0;
    expect(Math.abs(delta)).toBeLessThan(VISIBILITY_THRESHOLD);
    expect(result[0].learnAdjustment?.visible).toBe(false);
    // priorityScore is still adjusted under the hood
    expect(result[0].priorityScore).toBeGreaterThan(0.5);
  });

  it('two Tier 2 wins of opposite direction net to ~0', () => {
    const finding = makeFinding();
    const win = makeOutcome({ result: 'positive', liftPct: 10, confidence: 0.96, id: 'win-1' });
    const loss = makeOutcome({ result: 'negative', liftPct: -10, confidence: 0.96, id: 'loss-1' });
    const result = applyLearnRerank([finding], [win, loss]);
    expect(Math.abs(result[0].learnAdjustment?.delta ?? 99)).toBeLessThan(0.001);
  });

  it('huge measured lift is clamped to ±LIFT_CLAMP', () => {
    const finding = makeFinding();
    const outlier = makeOutcome({ liftPct: 500, confidence: 0.96 });
    const result = applyLearnRerank([finding], [outlier]);
    const expectedClamped = 20 * 0.96 * TIER_STRENGTH[2] * LIFT_SCALE;
    expect(result[0].learnAdjustment?.delta).toBeCloseTo(expectedClamped, 5);
  });

  it('many unanimous wins are clamped to ±DELTA_CLAMP', () => {
    const finding = makeFinding();
    const wins = Array.from({ length: 20 }, (_, i) =>
      makeOutcome({ id: `w-${i}`, liftPct: 15, confidence: 0.96 })
    );
    const result = applyLearnRerank([finding], wins);
    expect(result[0].learnAdjustment?.delta).toBeCloseTo(DELTA_CLAMP, 5);
    // priorityScore is clamped to [0,1]
    expect(result[0].priorityScore).toBeLessThanOrEqual(1);
  });
});

// --- I-2 inconclusive policy (trust the math) -------------------------------

describe('inconclusive policy (I-2)', () => {
  it('inconclusive with low confidence and small lift → near-zero contribution', () => {
    const finding = makeFinding();
    const outcome = makeOutcome({ result: 'inconclusive', liftPct: 2, confidence: 0.55 });
    const result = applyLearnRerank([finding], [outcome]);
    // 2 × 0.55 × 0.6 × 0.01 = 0.0066 — well below visibility threshold
    expect(Math.abs(result[0].learnAdjustment?.delta ?? 0)).toBeLessThan(0.01);
    expect(result[0].learnAdjustment?.visible).toBe(false);
  });

  it('three near-zero inconclusives → no visible annotation', () => {
    const finding = makeFinding();
    const outcomes = [
      makeOutcome({ id: 'i-1', result: 'inconclusive', liftPct: 1, confidence: 0.6 }),
      makeOutcome({ id: 'i-2', result: 'inconclusive', liftPct: -1, confidence: 0.6 }),
      makeOutcome({ id: 'i-3', result: 'inconclusive', liftPct: 2, confidence: 0.5 }),
    ];
    const result = applyLearnRerank([finding], outcomes);
    expect(result[0].learnAdjustment?.visible).toBe(false);
  });
});

// --- G-3 guardrail policy (stack penalty) -----------------------------------

describe('guardrail policy (G-3)', () => {
  it('Tier 2 win on primary + guardrail breach → primary boost largely cancelled', () => {
    const finding = makeFinding();
    const outcome = makeOutcome({
      result: 'positive',
      liftPct: 9,
      confidence: 0.96,
      guardrailBreached: 'session_duration',
    });
    const result = applyLearnRerank([finding], [outcome]);
    // primary: 9 × 0.96 × 0.6 × 0.01 = +0.0518
    // penalty: -0.1 × 0.6 = -0.06
    // net: ~ -0.008 → small dampen, below visibility
    const delta = result[0].learnAdjustment?.delta ?? 99;
    expect(delta).toBeLessThan(0);
    expect(Math.abs(delta)).toBeLessThan(VISIBILITY_THRESHOLD);
  });

  it('Tier 2 loss + guardrail breach → strongly negative (both signals stack)', () => {
    const finding = makeFinding();
    const outcome = makeOutcome({
      result: 'negative',
      liftPct: -8,
      confidence: 0.96,
      guardrailBreached: 'session_duration',
    });
    const result = applyLearnRerank([finding], [outcome]);
    // primary: -8 × 0.96 × 0.6 × 0.01 = -0.046
    // penalty: -0.1 × 0.6 = -0.06
    // net: -0.106
    const delta = result[0].learnAdjustment?.delta ?? 0;
    expect(delta).toBeLessThan(-0.1);
    expect(result[0].learnAdjustment?.direction).toBe('dampen');
    expect(result[0].learnAdjustment?.visible).toBe(true);
  });

  it('Tier 4 guardrail breach has small but real penalty', () => {
    const finding = makeFinding({ pathRef: '/other' });
    const outcome = makeOutcome({
      pathRef: '/signup',
      result: 'positive',
      liftPct: 9,
      confidence: 0.96,
      guardrailBreached: 'session_duration',
    });
    const result = applyLearnRerank([finding], [outcome]);
    // primary: 9 × 0.96 × 0.15 × 0.01 = 0.013
    // penalty: -0.1 × 0.15 = -0.015
    // net: ~-0.002 — small dampen
    expect(result[0].learnAdjustment?.delta).toBeLessThan(0);
  });
});

// --- visibility threshold ---------------------------------------------------

describe('visibility threshold', () => {
  it('sub-threshold delta sets visible=false but still adjusts priorityScore', () => {
    const finding = makeFinding({ priorityScore: 0.5, pathRef: '/other' });
    const outcome = makeOutcome({ pathRef: '/signup', liftPct: 10, confidence: 0.96 });
    const result = applyLearnRerank([finding], [outcome]);
    // Tier 4 boost ~+0.014 — below threshold
    expect(result[0].learnAdjustment?.visible).toBe(false);
    expect(result[0].priorityScore).toBeGreaterThan(0.5);
    expect(result[0].priorityScore).toBeLessThan(0.52);
  });

  it('re-ranking moves boosted findings ahead of un-adjusted ones', () => {
    const a = makeFinding({ id: 'a', pathRef: '/a', priorityScore: 0.5 });
    const b = makeFinding({ id: 'b', pathRef: '/b', priorityScore: 0.55 });
    // b would normally rank first; boost a with a strong Tier 2 win to flip the order.
    const winForA = makeOutcome({ pathRef: '/a', liftPct: 15, confidence: 0.96 });
    const result = applyLearnRerank([a, b], [winForA]);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });
});

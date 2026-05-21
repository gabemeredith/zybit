import { describe, it, expect } from 'vitest';
import {
  computeRuleCalibrations,
  calibratedFloor,
  calibratedCap,
  __ruleCalibrationInternals,
} from '@/lib/phase2/rules/ruleCalibration';
import type { AuditRuleContext, RuleCalibration } from '@/lib/phase2/rules/types';
import type { ExperimentOutcomeRow } from '@/lib/phase2/outcomes/repository';
import { rageClickTarget } from '@/lib/phase2/rules/rageClickTarget';
import { makeContext, makeRageClick, makePageView } from './fixtures';

const { MIN_MULTIPLIER, MAX_MULTIPLIER, MIN_CONCLUSIVE_OUTCOMES } =
  __ruleCalibrationInternals;

function makeOutcome(overrides: Partial<ExperimentOutcomeRow> = {}): ExperimentOutcomeRow {
  return {
    id: `outcome-${Math.random().toString(36).slice(2)}`,
    experimentId: 'experiment-test',
    ruleId: 'form-abandonment',
    pathRef: '/signup',
    modificationType: 'text-replace',
    result: 'positive',
    liftPct: 12,
    confidence: 0.96,
    guardrailBreached: null,
    concludedAt: new Date('2026-03-15T00:00:00Z'),
    ...overrides,
  };
}

/** Minimal context carrying only a calibration map — enough for the helpers. */
function ctxWith(calibration?: AuditRuleContext['calibration']): AuditRuleContext {
  return { calibration } as AuditRuleContext;
}

describe('computeRuleCalibrations — gating', () => {
  it('no outcomes → empty map', () => {
    expect(computeRuleCalibrations([]).size).toBe(0);
  });

  it('fewer than the minimum conclusive outcomes → neutral (1.0)', () => {
    const outcomes = Array.from({ length: MIN_CONCLUSIVE_OUTCOMES - 1 }, () => makeOutcome());
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal?.multiplier).toBe(1);
    expect(cal?.direction).toBe('neutral');
    expect(cal?.conclusiveCount).toBe(MIN_CONCLUSIVE_OUTCOMES - 1);
  });

  it('ignores outcomes with a null ruleId', () => {
    const map = computeRuleCalibrations([makeOutcome({ ruleId: null })]);
    expect(map.size).toBe(0);
  });

  it('inconclusive outcomes do not count toward the conclusive gate', () => {
    const outcomes = [
      makeOutcome({ result: 'inconclusive', liftPct: 0, confidence: 0.1 }),
      makeOutcome({ result: 'inconclusive', liftPct: 0, confidence: 0.1 }),
      makeOutcome({ result: 'inconclusive', liftPct: 0, confidence: 0.1 }),
    ];
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal?.conclusiveCount).toBe(0);
    expect(cal?.direction).toBe('neutral');
  });
});

describe('computeRuleCalibrations — direction', () => {
  it('repeated wins loosen the threshold (multiplier < 1)', () => {
    const outcomes = [
      makeOutcome({ result: 'positive', liftPct: 15 }),
      makeOutcome({ result: 'positive', liftPct: 15 }),
      makeOutcome({ result: 'positive', liftPct: 15 }),
    ];
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal?.direction).toBe('loosen');
    expect(cal!.multiplier).toBeLessThan(1);
    expect(cal!.multiplier).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
  });

  it('repeated losses tighten the threshold (multiplier > 1)', () => {
    const outcomes = [
      makeOutcome({ result: 'negative', liftPct: -15 }),
      makeOutcome({ result: 'negative', liftPct: -15 }),
      makeOutcome({ result: 'negative', liftPct: -15 }),
    ];
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal?.direction).toBe('tighten');
    expect(cal!.multiplier).toBeGreaterThan(1);
    expect(cal!.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it('a wash of wins and losses stays roughly neutral', () => {
    const outcomes = [
      makeOutcome({ result: 'positive', liftPct: 10 }),
      makeOutcome({ result: 'negative', liftPct: -10 }),
      makeOutcome({ result: 'positive', liftPct: 10 }),
      makeOutcome({ result: 'negative', liftPct: -10 }),
    ];
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal?.multiplier).toBeCloseTo(1, 5);
    expect(cal?.direction).toBe('neutral');
  });

  it('guardrail breaches push toward tightening even on positive lift', () => {
    const outcomes = [
      makeOutcome({ result: 'positive', liftPct: 5, guardrailBreached: 'bounce_rate' }),
      makeOutcome({ result: 'positive', liftPct: 5, guardrailBreached: 'bounce_rate' }),
      makeOutcome({ result: 'positive', liftPct: 5, guardrailBreached: 'bounce_rate' }),
    ];
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal!.netSignal).toBeLessThan(0);
    expect(cal?.direction).toBe('tighten');
  });
});

describe('computeRuleCalibrations — bounds and grouping', () => {
  it('clamps the multiplier to [MIN, MAX] under extreme signal', () => {
    const wins = Array.from({ length: 20 }, () => makeOutcome({ result: 'positive', liftPct: 20 }));
    const cal = computeRuleCalibrations(wins).get('form-abandonment');
    expect(cal?.multiplier).toBe(MIN_MULTIPLIER);
  });

  it('calibrates each ruleId independently', () => {
    const map = computeRuleCalibrations([
      makeOutcome({ ruleId: 'rage-click-target', result: 'positive', liftPct: 15 }),
      makeOutcome({ ruleId: 'rage-click-target', result: 'positive', liftPct: 15 }),
      makeOutcome({ ruleId: 'rage-click-target', result: 'positive', liftPct: 15 }),
      makeOutcome({ ruleId: 'bounce-on-key-page', result: 'negative', liftPct: -15 }),
      makeOutcome({ ruleId: 'bounce-on-key-page', result: 'negative', liftPct: -15 }),
      makeOutcome({ ruleId: 'bounce-on-key-page', result: 'negative', liftPct: -15 }),
    ]);
    expect(map.get('rage-click-target')?.direction).toBe('loosen');
    expect(map.get('bounce-on-key-page')?.direction).toBe('tighten');
  });

  it('records the outcome ids it was based on', () => {
    const outcomes = [
      makeOutcome({ id: 'a', result: 'positive' }),
      makeOutcome({ id: 'b', result: 'positive' }),
      makeOutcome({ id: 'c', result: 'positive' }),
    ];
    const cal = computeRuleCalibrations(outcomes).get('form-abandonment');
    expect(cal?.basedOnOutcomeIds.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('calibratedFloor', () => {
  it('returns the base floor when no calibration is present', () => {
    expect(calibratedFloor(ctxWith(undefined), 'rage-click-target', 0.05)).toBe(0.05);
  });

  it('lowers the floor when the rule is loosened', () => {
    const map = new Map([
      ['rage-click-target', { ruleId: 'rage-click-target', multiplier: 0.7, direction: 'loosen' as const, netSignal: 0.3, conclusiveCount: 3, reason: '', basedOnOutcomeIds: [] }],
    ]);
    expect(calibratedFloor(ctxWith(map), 'rage-click-target', 0.05)).toBeCloseTo(0.035, 6);
  });

  it('raises the floor when the rule is tightened', () => {
    const map = new Map([
      ['rage-click-target', { ruleId: 'rage-click-target', multiplier: 1.3, direction: 'tighten' as const, netSignal: -0.3, conclusiveCount: 3, reason: '', basedOnOutcomeIds: [] }],
    ]);
    expect(calibratedFloor(ctxWith(map), 'rage-click-target', 0.05)).toBeCloseTo(0.065, 6);
  });
});

describe('calibratedCap', () => {
  it('returns the base cap when no calibration is present', () => {
    expect(calibratedCap(ctxWith(undefined), 'form-abandonment', 0.5)).toBe(0.5);
  });

  it('raises the cap when loosened (so the rule fires more readily)', () => {
    const map = new Map([
      ['form-abandonment', { ruleId: 'form-abandonment', multiplier: 0.7, direction: 'loosen' as const, netSignal: 0.3, conclusiveCount: 3, reason: '', basedOnOutcomeIds: [] }],
    ]);
    // 1 - (1 - 0.5) * 0.7 = 0.65
    expect(calibratedCap(ctxWith(map), 'form-abandonment', 0.5)).toBeCloseTo(0.65, 6);
  });

  it('lowers the cap when tightened and stays within [0, 1]', () => {
    const map = new Map([
      ['nav-dispersion', { ruleId: 'nav-dispersion', multiplier: 1.3, direction: 'tighten' as const, netSignal: -0.3, conclusiveCount: 3, reason: '', basedOnOutcomeIds: [] }],
    ]);
    // 1 - (1 - 0.3) * 1.3 = 0.09
    const out = calibratedCap(ctxWith(map), 'nav-dispersion', 0.3);
    expect(out).toBeCloseTo(0.09, 6);
    expect(out).toBeGreaterThanOrEqual(0);
    expect(out).toBeLessThanOrEqual(1);
  });
});

describe('integration — calibration changes real rule firing', () => {
  // 6 rage clicks across 150 page sessions = 4% rage rate, which sits below the
  // base 5% floor but above the loosened 3.5% floor.
  function borderlineRageContext(): AuditRuleContext {
    const events = [
      ...Array.from({ length: 150 }, (_, i) => makePageView('/app', `sess-${i}`)),
      ...Array.from({ length: 6 }, (_, i) => makeRageClick('/app', 'Submit form', `sess-${i}`)),
    ];
    return makeContext(events);
  }

  function calMap(cal: Partial<RuleCalibration>): Map<string, RuleCalibration> {
    return new Map([
      [
        'rage-click-target',
        {
          ruleId: 'rage-click-target',
          multiplier: 1,
          direction: 'neutral',
          netSignal: 0,
          conclusiveCount: 3,
          reason: '',
          basedOnOutcomeIds: [],
          ...cal,
        },
      ],
    ]);
  }

  it('base floor (no calibration) does not fire at 4% rage rate', () => {
    expect(rageClickTarget.evaluate(borderlineRageContext())).toEqual([]);
  });

  it('loosened floor surfaces the finding the base floor suppressed', () => {
    const ctx = borderlineRageContext();
    ctx.calibration = calMap({ multiplier: 0.7, direction: 'loosen' });
    expect(rageClickTarget.evaluate(ctx).length).toBeGreaterThanOrEqual(1);
  });

  it('tightened floor still suppresses a finding that base would already suppress', () => {
    const ctx = borderlineRageContext();
    ctx.calibration = calMap({ multiplier: 1.3, direction: 'tighten' });
    expect(rageClickTarget.evaluate(ctx)).toEqual([]);
  });
});

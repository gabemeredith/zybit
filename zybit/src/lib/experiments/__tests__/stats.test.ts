/**
 * Spec tests for src/lib/experiments/stats.ts.
 *
 * Expected values are computed independently from the math, not from the
 * current implementation. Sources:
 *   - Two-proportion pooled z-test (no continuity correction): standard
 *     formula; reference values cross-checked against R `prop.test(..., correct=FALSE)`.
 *   - Standard normal CDF / two-sided p-values: scipy.stats.norm.sf reference values.
 *   - Sample size: n = (z_alpha + z_beta)^2 * (p1*(1-p1) + p2*(1-p2)) / (p1-p2)^2.
 *
 * Tolerances reflect (a) the erfc approximation error (~1.5e-7) and
 * (b) the rounded z-table values used by the sample-size function.
 */

import { describe, it, expect } from 'vitest';
import {
  chiSquaredTwoProportions,
  guardrailOneSidedPValue,
  minimumSampleSizePerArm,
  isReadyToStop,
  classifyResult,
} from '../stats';

// ---------------------------------------------------------------------------
// chiSquaredTwoProportions — golden values
// ---------------------------------------------------------------------------

describe('chiSquaredTwoProportions', () => {
  it('matches reference p-value for moderate lift (100/1000 vs 130/1000)', () => {
    // p1=0.10, p2=0.13, pPool=0.115
    // SE = sqrt(0.115 * 0.885 * (1/1000 + 1/1000)) = 0.01426714...
    // z = 0.03 / 0.01426714 = 2.10271
    // two-sided p = 2 * scipy.stats.norm.sf(2.10271) ≈ 0.03548
    const r = chiSquaredTwoProportions(100, 1000, 130, 1000);
    expect(r).not.toBeNull();
    expect(r!.zScore).toBeCloseTo(2.10271, 3);
    expect(r!.pValue).toBeCloseTo(0.03548, 3);
    expect(r!.confidence).toBeCloseTo(0.96452, 3);
  });

  it('matches reference p-value for large lift (10/100 vs 30/100)', () => {
    // p1=0.10, p2=0.30, pPool=0.20
    // SE = sqrt(0.20 * 0.80 * (1/100 + 1/100)) = 0.05657
    // z = 0.20 / 0.05657 = 3.5355
    // two-sided p ≈ 2 * 0.000204 = 0.000408
    const r = chiSquaredTwoProportions(10, 100, 30, 100);
    expect(r).not.toBeNull();
    expect(r!.zScore).toBeCloseTo(3.5355, 3);
    expect(r!.pValue).toBeCloseTo(0.000408, 4);
  });

  it('returns zScore=0 and pValue=1 for identical rates', () => {
    const r = chiSquaredTwoProportions(100, 1000, 100, 1000);
    expect(r).not.toBeNull();
    expect(r!.zScore).toBe(0);
    expect(r!.pValue).toBeCloseTo(1, 6);
    expect(r!.confidence).toBeCloseTo(0, 6);
  });

  it('is anti-symmetric: swapping control/variant negates z and lift, p unchanged', () => {
    const a = chiSquaredTwoProportions(100, 1000, 130, 1000)!;
    const b = chiSquaredTwoProportions(130, 1000, 100, 1000)!;
    expect(b.zScore).toBeCloseTo(-a.zScore, 6);
    expect(b.pValue).toBeCloseTo(a.pValue, 6);
    expect(b.liftPct).toBeCloseTo(-a.liftPct, 6);
  });

  // -------- Edge cases returning null --------

  it('returns null when controlParticipants is zero', () => {
    expect(chiSquaredTwoProportions(0, 0, 5, 100)).toBeNull();
  });

  it('returns null when variantParticipants is zero', () => {
    expect(chiSquaredTwoProportions(5, 100, 0, 0)).toBeNull();
  });

  it('returns null when pooled rate is 0 (no conversions in either arm)', () => {
    expect(chiSquaredTwoProportions(0, 1000, 0, 1000)).toBeNull();
  });

  it('returns null when pooled rate is 1 (every visitor converted in both arms)', () => {
    expect(chiSquaredTwoProportions(1000, 1000, 1000, 1000)).toBeNull();
  });

  // -------- CONTRACT: liftPct is absolute percentage points, relLift is relative --------
  //
  // This contract is the one most likely to be misread by callers (and by
  // marketing copy). It must stay unambiguous. If a future refactor
  // normalizes "lift" to a single number, the field semantics it picks need
  // to be reflected in the schema column name and UI label.

  it('liftPct is absolute percentage points (variantRate - controlRate) * 100', () => {
    // 5% → 10% conversion: that's +5pp absolute (and +100% relative).
    const r = chiSquaredTwoProportions(50, 1000, 100, 1000)!;
    expect(r.controlRate).toBeCloseTo(0.05, 10);
    expect(r.variantRate).toBeCloseTo(0.10, 10);
    expect(r.liftPct).toBeCloseTo(5.0, 6); // pp, not relative
  });

  it('relLift is relative lift (variantRate - controlRate) / controlRate', () => {
    // 5% → 10% conversion: that's +100% relative (and +5pp absolute).
    const r = chiSquaredTwoProportions(50, 1000, 100, 1000)!;
    expect(r.relLift).toBeCloseTo(1.0, 6); // 100% relative
  });

  it('liftPct and relLift are NOT equal for a 5pp / 100% case — they measure different things', () => {
    const r = chiSquaredTwoProportions(50, 1000, 100, 1000)!;
    expect(r.liftPct).not.toBeCloseTo(r.relLift, 2);
  });

  it('relLift is 0 when controlRate is 0 (no divide-by-zero)', () => {
    // pPool > 0 since variant has conversions, so chi-squared is computable.
    const r = chiSquaredTwoProportions(0, 1000, 10, 1000);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.relLift)).toBe(true);
    expect(r!.relLift).toBe(0);
  });

  // -------- Extreme & adversarial inputs --------

  it('handles extreme z-scores without overflow (variant 1000x better)', () => {
    // 1/1000 vs 500/1000: ratio is enormous; z should be large and finite.
    const r = chiSquaredTwoProportions(1, 1000, 500, 1000);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.zScore)).toBe(true);
    expect(Number.isFinite(r!.pValue)).toBe(true);
    expect(r!.zScore).toBeGreaterThan(15); // very far into the tail
    expect(r!.pValue).toBeGreaterThanOrEqual(0); // never goes negative
    expect(r!.pValue).toBeLessThan(1e-30); // effectively zero
  });

  it('p-value is non-negative even when erfc underflows toward zero', () => {
    // Very tight case to probe the erfc tail — must never produce a negative
    // p-value, which would corrupt confidence = 1 - pValue.
    const r = chiSquaredTwoProportions(0, 10000, 1000, 10000);
    expect(r).not.toBeNull();
    expect(r!.pValue).toBeGreaterThanOrEqual(0);
    expect(r!.confidence).toBeLessThanOrEqual(1);
  });

  it('handles tiny conversion counts at the small-sample edge (1/5 vs 4/5)', () => {
    // Asymptotic z-test is technically inappropriate this small (would want
    // Fisher's exact). Behavior should still be deterministic and finite.
    // This test locks current behavior, not statistical correctness.
    const r = chiSquaredTwoProportions(1, 5, 4, 5);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.zScore)).toBe(true);
    expect(Number.isFinite(r!.pValue)).toBe(true);
    expect(r!.pValue).toBeGreaterThanOrEqual(0);
    expect(r!.pValue).toBeLessThanOrEqual(1);
  });

  it('handles extreme asymmetric sample sizes (10 vs 1,000,000)', () => {
    const r = chiSquaredTwoProportions(1, 10, 100000, 1000000);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.zScore)).toBe(true);
    expect(Number.isFinite(r!.pValue)).toBe(true);
  });

  it('handles arm with 0 conversions but pooled rate > 0 (control empty, variant nonzero)', () => {
    const r = chiSquaredTwoProportions(0, 1000, 50, 1000);
    expect(r).not.toBeNull();
    expect(r!.zScore).toBeGreaterThan(0); // variant > control
    expect(r!.controlRate).toBe(0);
    expect(r!.variantRate).toBeCloseTo(0.05, 6);
    expect(r!.liftPct).toBeCloseTo(5.0, 6);
  });

  it('handles arm with 100% conversion but pooled rate < 1 (rare but possible)', () => {
    // 100/100 control vs 50/100 variant: variant much worse but pPool=0.75.
    const r = chiSquaredTwoProportions(100, 100, 50, 100);
    expect(r).not.toBeNull();
    expect(r!.controlRate).toBe(1);
    expect(r!.variantRate).toBeCloseTo(0.5, 6);
    expect(r!.zScore).toBeLessThan(0); // variant worse
  });

  it('rejects degenerate input where conversions > participants (returns null or zero-rate)', () => {
    // Defensive: per current implementation this won't crash; behavior is
    // unspecified but must be deterministic and finite. Locks "no crash".
    const r = chiSquaredTwoProportions(50, 10, 5, 100);
    if (r !== null) {
      expect(Number.isFinite(r.pValue)).toBe(true);
      expect(Number.isFinite(r.zScore)).toBe(true);
    }
  });

  it('is a pure function (same inputs → same outputs across many calls)', () => {
    const a = chiSquaredTwoProportions(100, 1000, 130, 1000)!;
    for (let i = 0; i < 50; i++) {
      const b = chiSquaredTwoProportions(100, 1000, 130, 1000)!;
      expect(b.zScore).toBe(a.zScore);
      expect(b.pValue).toBe(a.pValue);
      expect(b.liftPct).toBe(a.liftPct);
      expect(b.relLift).toBe(a.relLift);
    }
  });

  it('confidence + pValue sums to 1 (within float tolerance)', () => {
    for (const [cc, cn, vc, vn] of [
      [100, 1000, 130, 1000],
      [50, 500, 60, 500],
      [1, 100, 5, 100],
      [200, 2000, 220, 2000],
    ] as const) {
      const r = chiSquaredTwoProportions(cc, cn, vc, vn)!;
      expect(r.confidence + r.pValue).toBeCloseTo(1, 10);
    }
  });

  it('z-score sign matches the direction of the lift', () => {
    const positive = chiSquaredTwoProportions(100, 1000, 130, 1000)!;
    const negative = chiSquaredTwoProportions(130, 1000, 100, 1000)!;
    const flat = chiSquaredTwoProportions(100, 1000, 100, 1000)!;
    expect(positive.zScore).toBeGreaterThan(0);
    expect(negative.zScore).toBeLessThan(0);
    expect(flat.zScore).toBe(0);
    expect(Math.sign(positive.liftPct)).toBe(Math.sign(positive.zScore));
    expect(Math.sign(negative.liftPct)).toBe(Math.sign(negative.zScore));
  });

  it('p-value lies in [0, 1] for a swept range of inputs', () => {
    for (let cc = 0; cc <= 100; cc += 10) {
      for (let vc = 0; vc <= 100; vc += 10) {
        const r = chiSquaredTwoProportions(cc, 100, vc, 100);
        if (r !== null) {
          expect(r.pValue).toBeGreaterThanOrEqual(0);
          expect(r.pValue).toBeLessThanOrEqual(1);
          expect(r.confidence).toBeGreaterThanOrEqual(0);
          expect(r.confidence).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// guardrailOneSidedPValue
// ---------------------------------------------------------------------------

describe('guardrailOneSidedPValue', () => {
  it('returns a very small p-value when the variant clearly degrades the metric', () => {
    // control 200/1000 (20%) vs variant 100/1000 (10%): variant is much worse.
    // One-sided p(variant < control by chance) should be tiny.
    const p = guardrailOneSidedPValue(200, 1000, 100, 1000);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(1e-6);
  });

  it('returns a large p-value (~close to 1) when the variant clearly improves the metric', () => {
    // control 100/1000 (10%) vs variant 200/1000 (20%): variant is much better.
    // Probability that variant < control by chance is near zero, so the
    // *complement* — the one-sided p in the "variant ≤ control" direction —
    // should be close to 1.
    const p = guardrailOneSidedPValue(100, 1000, 200, 1000);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.9999);
  });

  it('returns approximately 0.5 when the variant matches the control', () => {
    const p = guardrailOneSidedPValue(100, 1000, 100, 1000);
    expect(p).not.toBeNull();
    expect(p!).toBeCloseTo(0.5, 6);
  });

  it('returns null when the inputs are degenerate (zero participants)', () => {
    expect(guardrailOneSidedPValue(0, 0, 0, 0)).toBeNull();
  });

  it('crosses p < 0.20 (the guardrail trigger in computeOutcomes) for an 80%-confident decrease', () => {
    // The pipeline triggers on p < 0.20 (80% confidence). Demonstrate that
    // a moderate decrease passes the threshold so the wiring is honest.
    // control 150/1000 (15%) vs variant 130/1000 (13%): observable decrease.
    const p = guardrailOneSidedPValue(150, 1000, 130, 1000);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.20);
  });

  it('does NOT cross p < 0.20 for a tiny decrease (avoids false guardrail triggers on noise)', () => {
    // 0.5pp drop in 1000 visitors is well within sampling noise.
    const p = guardrailOneSidedPValue(150, 1000, 145, 1000);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.20);
  });

  it('lies in [0, 1] for any computable input (no spurious negatives or >1 values)', () => {
    for (const [cc, cn, vc, vn] of [
      [0, 100, 50, 100],
      [50, 100, 0, 100],
      [50, 100, 50, 100],
      [100, 100, 0, 100],
      [0, 100, 100, 100],
      [1, 10000, 1, 10000],
    ] as const) {
      const p = guardrailOneSidedPValue(cc, cn, vc, vn);
      if (p !== null) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('one-sided p complements correctly: p(harm) + p(no harm) ≈ 1', () => {
    // For the same data, the one-sided p in the harm direction plus the
    // one-sided p in the no-harm direction must sum to 1 (mutually exclusive
    // and exhaustive under the test's continuous-distribution assumption).
    const harm = guardrailOneSidedPValue(200, 1000, 100, 1000)!;
    const noHarm = guardrailOneSidedPValue(100, 1000, 200, 1000)!;
    expect(harm + noHarm).toBeCloseTo(1, 6);
  });

  it('is a pure function across repeated calls', () => {
    const a = guardrailOneSidedPValue(150, 1000, 130, 1000)!;
    for (let i = 0; i < 50; i++) {
      expect(guardrailOneSidedPValue(150, 1000, 130, 1000)).toBe(a);
    }
  });
});

// ---------------------------------------------------------------------------
// minimumSampleSizePerArm
// ---------------------------------------------------------------------------

describe('minimumSampleSizePerArm', () => {
  it('matches reference value for baseRate=0.10, mde=0.05, power=0.80, alpha=0.05', () => {
    // p1=0.10, p2=0.105
    // numerator = (1.96 + 0.842)^2 * (0.10*0.90 + 0.105*0.895)
    //           = 7.8512 * 0.183975 = 1.44438
    // denominator = (0.105 - 0.10)^2 = 0.000025
    // n = 57776 → ceil = 57776 (within ±1 for z-table rounding)
    const n = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.05);
    expect(n).toBeGreaterThan(57000);
    expect(n).toBeLessThan(58500);
  });

  it('matches reference value for baseRate=0.20, mde=0.10, power=0.80, alpha=0.05', () => {
    // p1=0.20, p2=0.22; n ≈ 6509
    const n = minimumSampleSizePerArm(0.20, 0.10, 0.80, 0.05);
    expect(n).toBeGreaterThan(6400);
    expect(n).toBeLessThan(6600);
  });

  it('shrinks as MDE grows (larger effects need fewer samples)', () => {
    const small = minimumSampleSizePerArm(0.10, 0.05);
    const large = minimumSampleSizePerArm(0.10, 0.20);
    expect(large).toBeLessThan(small);
  });

  it('grows as baseRate moves toward 0 (rare events need more samples)', () => {
    const rare = minimumSampleSizePerArm(0.01, 0.05);
    const common = minimumSampleSizePerArm(0.20, 0.05);
    expect(rare).toBeGreaterThan(common);
  });

  it('returns the safe default (100) for degenerate inputs', () => {
    expect(minimumSampleSizePerArm(0, 0.05)).toBe(100);
    expect(minimumSampleSizePerArm(1, 0.05)).toBe(100);
    expect(minimumSampleSizePerArm(-0.1, 0.05)).toBe(100);
    expect(minimumSampleSizePerArm(0.5, 0)).toBe(100);
    expect(minimumSampleSizePerArm(0.5, -0.1)).toBe(100);
    // p2 >= 1 case: baseRate=0.95, mde=0.10 → p2=1.045 → safe default
    expect(minimumSampleSizePerArm(0.95, 0.10)).toBe(100);
  });

  // -------- FOOTGUN (case-by-case: passing-as-documentation) --------
  //
  // The function accepts arbitrary `alpha` and `power` values but only
  // looks up z-table entries for a handful of preset (alpha, power) pairs;
  // anything else silently falls through to defaults (alpha=0.05, power=0.80).
  // Today nothing in the codebase passes non-default values, so this is a
  // latent foot-gun rather than an active bug. Test locks the *current*
  // fall-through behavior so it doesn't change silently. When the z-table
  // becomes an inverse-normal computation, delete this test.

  it('SILENT FALL-THROUGH: undocumented alpha returns same answer as alpha=0.05 (TODO: validate inputs)', () => {
    const undocumented = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.025);
    const defaulted = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.05);
    expect(undocumented).toBe(defaulted);
  });

  it('SILENT FALL-THROUGH: undocumented power returns same answer as power=0.80 (TODO: validate inputs)', () => {
    const undocumented = minimumSampleSizePerArm(0.10, 0.05, 0.70, 0.05);
    const defaulted = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.05);
    expect(undocumented).toBe(defaulted);
  });

  it('uses tighter z for alpha=0.01 (larger sample required)', () => {
    const tight = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.01);
    const standard = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.05);
    expect(tight).toBeGreaterThan(standard);
  });

  it('uses looser z for alpha=0.10 (smaller sample required)', () => {
    const loose = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.10);
    const standard = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.05);
    expect(loose).toBeLessThan(standard);
  });

  it('uses higher z_beta for power=0.90 (larger sample required)', () => {
    const high = minimumSampleSizePerArm(0.10, 0.05, 0.90, 0.05);
    const standard = minimumSampleSizePerArm(0.10, 0.05, 0.80, 0.05);
    expect(high).toBeGreaterThan(standard);
  });

  it('uses higher z_beta for power=0.95 (largest sample required)', () => {
    const veryHigh = minimumSampleSizePerArm(0.10, 0.05, 0.95, 0.05);
    const high = minimumSampleSizePerArm(0.10, 0.05, 0.90, 0.05);
    expect(veryHigh).toBeGreaterThan(high);
  });

  it('returns an integer (Math.ceil applied)', () => {
    const n = minimumSampleSizePerArm(0.10, 0.05);
    expect(Number.isInteger(n)).toBe(true);
  });

  it('returns a positive integer for any reasonable input', () => {
    for (const baseRate of [0.001, 0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90]) {
      for (const mde of [0.01, 0.05, 0.10, 0.20, 0.50]) {
        const n = minimumSampleSizePerArm(baseRate, mde);
        expect(n).toBeGreaterThan(0);
        expect(Number.isInteger(n)).toBe(true);
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it('handles boundary baseRate just below 1 with small MDE', () => {
    // baseRate=0.99, mde=0.005 → p2 = 0.99495, still valid.
    const n = minimumSampleSizePerArm(0.99, 0.005);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('handles boundary baseRate just above 0', () => {
    const n = minimumSampleSizePerArm(0.001, 0.05);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('is a pure function across repeated calls', () => {
    const a = minimumSampleSizePerArm(0.10, 0.05);
    for (let i = 0; i < 20; i++) {
      expect(minimumSampleSizePerArm(0.10, 0.05)).toBe(a);
    }
  });
});

// ---------------------------------------------------------------------------
// isReadyToStop — truth table over the three gating conditions
// ---------------------------------------------------------------------------

describe('isReadyToStop', () => {
  // Defaults: confidenceThreshold=0.95, minimumDays=7
  // Use minimumParticipants=1000 throughout.

  it('returns true only when ALL conditions pass', () => {
    expect(
      isReadyToStop({
        confidence: 0.96,
        participants: 1500,
        elapsedDays: 8,
        minimumParticipants: 1000,
        confidenceThreshold: 0.95, // flat threshold — tests three-condition AND logic, not OBF
      }),
    ).toBe(true);
  });

  it('returns false when confidence is below threshold', () => {
    expect(
      isReadyToStop({
        confidence: 0.94,
        participants: 1500,
        elapsedDays: 8,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('returns false when participants are below the minimum', () => {
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 500,
        elapsedDays: 8,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('returns false when elapsedDays is below the floor', () => {
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 5000,
        elapsedDays: 3,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('returns false when all three conditions fail', () => {
    expect(
      isReadyToStop({
        confidence: 0.50,
        participants: 100,
        elapsedDays: 1,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('uses exact equality for thresholds (>=, not >)', () => {
    // Tests the >= vs > boundary using an explicit flat threshold. The erfc
    // approximation shifts the OBF value by ~4e-5 at t=1, so use confidenceThreshold
    // here to isolate the >= semantics from the numerical precision artifact.
    expect(
      isReadyToStop({
        confidence: 0.95,
        participants: 1000,
        elapsedDays: 14,
        minimumParticipants: 1000,
        minimumDays: 7,
        confidenceThreshold: 0.95,
      }),
    ).toBe(true);
  });

  it('honors custom confidenceThreshold and minimumDays overrides', () => {
    expect(
      isReadyToStop({
        confidence: 0.97,
        participants: 1000,
        elapsedDays: 5,
        minimumParticipants: 1000,
        minimumDays: 4,
        confidenceThreshold: 0.99,
      }),
    ).toBe(false); // confidence 0.97 < custom threshold 0.99

    expect(
      isReadyToStop({
        confidence: 0.995,
        participants: 1000,
        elapsedDays: 5,
        minimumParticipants: 1000,
        minimumDays: 4,
        confidenceThreshold: 0.99,
      }),
    ).toBe(true);
  });

  // -------- CONTRACT NOTE (case-by-case: passing-as-documentation) --------
  //
  // SequentialGuardParams.participants is documented as "total participants
  // (both arms combined)". The only current caller (computeOutcomes.ts)
  // passes `Math.min(controlParticipants, variantParticipants)` — the
  // *per-arm* minimum — and compares it against `minPerArm`. The function
  // itself is unit-agnostic; whatever the caller passes is what gets
  // compared. The docstring is misleading. TODO: rename param to
  // `participantsForComparison` or fix the docstring.
  //
  // This test locks the unit-agnostic behavior; it does not validate the
  // contract because the contract is currently ambiguous in the source.
  it('compares participants and minimumParticipants directly without unit interpretation', () => {
    // "per-arm 1000 ≥ per-arm minimum 1000" — caller's interpretation works.
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 1000,
        elapsedDays: 10,
        minimumParticipants: 1000,
        confidenceThreshold: 0.95, // flat threshold — tests participant comparison, not OBF
      }),
    ).toBe(true);

    // Same numeric values whether the caller intended "total" or "per-arm"
    // — the function can't tell.
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 999,
        elapsedDays: 10,
        minimumParticipants: 1000,
        confidenceThreshold: 0.95,
      }),
    ).toBe(false);
  });

  // -------- Boundary cases --------

  it('returns false when confidence is exactly threshold minus epsilon', () => {
    expect(
      isReadyToStop({
        confidence: 0.9499999,
        participants: 1000,
        elapsedDays: 10,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('returns false when elapsedDays is exactly minimum minus epsilon', () => {
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 1000,
        elapsedDays: 6.9999,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('returns false when participants is exactly minimum minus 1', () => {
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 999,
        elapsedDays: 10,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('handles zero participants without crashing (early in the experiment)', () => {
    expect(
      isReadyToStop({
        confidence: 0,
        participants: 0,
        elapsedDays: 0,
        minimumParticipants: 1000,
      }),
    ).toBe(false);
  });

  it('handles fractional elapsedDays (cron may compute non-integer values)', () => {
    expect(
      isReadyToStop({
        confidence: 0.99,
        participants: 1000,
        elapsedDays: 7.001,
        minimumParticipants: 1000,
        confidenceThreshold: 0.95, // flat threshold — tests fractional day handling, not OBF
      }),
    ).toBe(true);
  });

  it('with confidenceThreshold=1.0 (impossible to satisfy), always returns false', () => {
    expect(
      isReadyToStop({
        confidence: 0.99999999,
        participants: 1_000_000,
        elapsedDays: 365,
        minimumParticipants: 1000,
        confidenceThreshold: 1.0,
      }),
    ).toBe(false);
  });

  it('with minimumDays=0 and confidenceThreshold=0, allows immediate stop', () => {
    // Caution: this configuration disables the safety guard entirely.
    // Test documents that the override is honored (intentional escape hatch).
    expect(
      isReadyToStop({
        confidence: 0,
        participants: 0,
        elapsedDays: 0,
        minimumParticipants: 0,
        minimumDays: 0,
        confidenceThreshold: 0,
      }),
    ).toBe(true);
  });

  it('is a pure function across repeated calls', () => {
    const params = {
      confidence: 0.96,
      participants: 1500,
      elapsedDays: 8,
      minimumParticipants: 1000,
      confidenceThreshold: 0.95 as const, // flat threshold — tests purity, not OBF
    };
    for (let i = 0; i < 50; i++) {
      expect(isReadyToStop(params)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// classifyResult
// ---------------------------------------------------------------------------

describe('classifyResult', () => {
  const significantPositive = {
    pValue: 0.01,
    confidence: 0.99,
    zScore: 2.5,
    controlRate: 0.10,
    variantRate: 0.13,
    liftPct: 3.0,
    relLift: 0.30,
  };

  const significantNegative = {
    pValue: 0.01,
    confidence: 0.99,
    zScore: -2.5,
    controlRate: 0.13,
    variantRate: 0.10,
    liftPct: -3.0,
    relLift: -0.23,
  };

  it('returns inconclusive when reachedSignificance is false (regardless of confidence)', () => {
    expect(classifyResult(significantPositive, false)).toBe('inconclusive');
  });

  it('returns inconclusive when result is null', () => {
    expect(classifyResult(null, true)).toBe('inconclusive');
  });

  it('returns inconclusive when confidence is below the threshold', () => {
    const borderline = { ...significantPositive, confidence: 0.94 };
    expect(classifyResult(borderline, true)).toBe('inconclusive');
  });

  it('returns positive when significant and liftPct >= 0', () => {
    expect(classifyResult(significantPositive, true)).toBe('positive');
  });

  it('returns negative when significant and liftPct < 0', () => {
    expect(classifyResult(significantNegative, true)).toBe('negative');
  });

  it('honors a custom confidenceThreshold', () => {
    const result = { ...significantPositive, confidence: 0.96 };
    expect(classifyResult(result, true, 0.99)).toBe('inconclusive');
    expect(classifyResult(result, true, 0.95)).toBe('positive');
  });

  it('treats liftPct exactly zero as positive (boundary)', () => {
    const flat = { ...significantPositive, liftPct: 0, relLift: 0 };
    expect(classifyResult(flat, true)).toBe('positive');
  });

  // -------- GAP (case-by-case: passing-as-documentation) --------
  //
  // classifyResult does NOT check effect size. A statistically-real lift
  // of 0.01pp at 95% confidence (achievable with millions of visitors) is
  // labeled 'positive' even though it falls far below the MDE the power
  // calculation was sized for. Product decision (2026-05-18): handle via
  // a soft label in the UI ("real effect, below your MDE — likely not
  // worth a launch") rather than reclassifying.
  //
  // This test locks current behavior. When/if a hard MDE floor is added
  // to classifyResult, update the expected value to 'inconclusive' and
  // delete this comment.
  it('NO MDE CHECK: trivial-but-significant lifts are classified positive (soft-label pending)', () => {
    const trivial = {
      pValue: 0.001,
      confidence: 0.999,
      zScore: 3.5,
      controlRate: 0.10000,
      variantRate: 0.10001,
      liftPct: 0.001, // 0.001 percentage points
      relLift: 0.0001, // 0.01% relative — well below any reasonable MDE
    };
    expect(classifyResult(trivial, true)).toBe('positive');
  });

  it('treats a marginally negative liftPct as negative (no symmetric zero bucket)', () => {
    const tinyNegative = { ...significantNegative, liftPct: -0.0001, relLift: -0.00001 };
    expect(classifyResult(tinyNegative, true)).toBe('negative');
  });

  it('returns inconclusive when reachedSignificance=false even with extreme confidence', () => {
    // The reachedSignificance flag wins over confidence — that's the
    // documented gate, even though it looks redundant given the confidence
    // check below. Locks the precedence order.
    const r = { ...significantPositive, confidence: 0.9999999 };
    expect(classifyResult(r, false)).toBe('inconclusive');
  });

  it('returns inconclusive when confidence is exactly threshold minus epsilon', () => {
    const r = { ...significantPositive, confidence: 0.9499999 };
    expect(classifyResult(r, true)).toBe('inconclusive');
  });

  it('returns positive when confidence is exactly the threshold', () => {
    const r = { ...significantPositive, confidence: 0.95 };
    expect(classifyResult(r, true, 0.95)).toBe('positive');
  });

  it('is a pure function across repeated calls', () => {
    for (let i = 0; i < 50; i++) {
      expect(classifyResult(significantPositive, true)).toBe('positive');
      expect(classifyResult(significantNegative, true)).toBe('negative');
      expect(classifyResult(null, true)).toBe('inconclusive');
    }
  });
});

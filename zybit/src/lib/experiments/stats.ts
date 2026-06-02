/**
 * Pure statistical functions for experiment outcome computation.
 *
 * No external dependencies — all math is implemented here so the
 * results are reproducible, auditable, and independent of any
 * third-party stats library.
 *
 * References:
 *   - Chi-squared test for two proportions: standard frequentist formula
 *   - Abramowitz & Stegun 7.1.26 for erfc approximation (max error 1.5e-7)
 *   - Welch's t-test: Welch (1947), Biometrika
 *   - Minimum sample size: standard two-proportion z-test power formula
 */

// ---------------------------------------------------------------------------
// Error function
// ---------------------------------------------------------------------------

/** erfc(x) — complementary error function. Max error ~1.5e-7. */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = poly * Math.exp(-x * x);
  return x >= 0 ? result : 2 - result;
}

/** Two-sided p-value from a z-score. */
function pValueFromZ(z: number): number {
  return erfc(Math.abs(z) / Math.sqrt(2));
}

// ---------------------------------------------------------------------------
// Chi-squared test for two proportions (binary outcome, e.g., converted/not)
// ---------------------------------------------------------------------------

export interface ProportionTestResult {
  pValue: number;
  confidence: number; // 1 - pValue
  zScore: number;
  controlRate: number;
  variantRate: number;
  liftPct: number; // absolute pp lift (variantRate - controlRate) * 100
  relLift: number; // relative lift: (variantRate - controlRate) / controlRate
}

/**
 * Chi-squared test (as z-test for two proportions) for binary conversion rates.
 * Use this when the primary metric is "converted or not" (click, signup, purchase).
 *
 * Returns null if there is insufficient data to compute (zero participants in
 * either arm, or zero pooled rate — avoid division by zero).
 */
export function chiSquaredTwoProportions(
  controlConversions: number,
  controlParticipants: number,
  variantConversions: number,
  variantParticipants: number,
): ProportionTestResult | null {
  if (controlParticipants <= 0 || variantParticipants <= 0) return null;

  const p1 = controlConversions / controlParticipants;
  const p2 = variantConversions / variantParticipants;
  const pPool = (controlConversions + variantConversions) / (controlParticipants + variantParticipants);

  if (pPool <= 0 || pPool >= 1) return null;

  const se = Math.sqrt(pPool * (1 - pPool) * (1 / controlParticipants + 1 / variantParticipants));
  if (se === 0) return null;

  const zScore = (p2 - p1) / se;
  const pValue = pValueFromZ(zScore);
  const liftPct = (p2 - p1) * 100;
  const relLift = p1 > 0 ? (p2 - p1) / p1 : 0;

  return {
    pValue,
    confidence: 1 - pValue,
    zScore,
    controlRate: p1,
    variantRate: p2,
    liftPct,
    relLift,
  };
}

// ---------------------------------------------------------------------------
// One-sided test for guardrail evaluation
// ---------------------------------------------------------------------------

/**
 * One-sided p-value: probability that variant rate is lower than control
 * by chance alone. Used for guardrail metrics ("do not degrade this metric").
 *
 * Returns the one-sided p-value (lower = more confident the variant hurt this metric).
 */
export function guardrailOneSidedPValue(
  controlConversions: number,
  controlParticipants: number,
  variantConversions: number,
  variantParticipants: number,
): number | null {
  const result = chiSquaredTwoProportions(
    controlConversions,
    controlParticipants,
    variantConversions,
    variantParticipants,
  );
  if (!result) return null;
  // One-sided: we care about the direction (variant < control, i.e. zScore < 0)
  return result.zScore < 0 ? result.pValue / 2 : 1 - result.pValue / 2;
}

// ---------------------------------------------------------------------------
// Minimum sample size (for sequential testing guard)
// ---------------------------------------------------------------------------

/**
 * Minimum participants per arm before significance can be declared.
 *
 * Uses the standard two-proportion z-test power formula:
 *   n = (z_alpha + z_beta)^2 * (p1*(1-p1) + p2*(1-p2)) / (p1-p2)^2
 *
 * @param baseRate     Estimated baseline conversion rate (0..1)
 * @param mde          Minimum detectable effect as relative lift (default 0.05 = 5%)
 * @param power        Desired power (default 0.80)
 * @param alpha        Significance level, two-sided (default 0.05)
 */
export function minimumSampleSizePerArm(
  baseRate: number,
  mde = 0.05,
  power = 0.8,
  alpha = 0.05,
): number {
  if (baseRate <= 0 || baseRate >= 1 || mde <= 0) return 100; // safe default

  const p1 = baseRate;
  const p2 = baseRate * (1 + mde);
  if (p2 >= 1) return 100;

  // z_alpha/2 for two-sided test; z_beta for power
  const zAlpha = alpha === 0.01 ? 2.576 : alpha === 0.10 ? 1.645 : 1.96; // two-sided
  const zBeta = power === 0.9 ? 1.282 : power === 0.95 ? 1.645 : 0.842; // default power=0.8

  const numerator = (zAlpha + zBeta) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2));
  const denominator = (p2 - p1) ** 2;

  return Math.ceil(numerator / denominator);
}

// ---------------------------------------------------------------------------
// O'Brien-Fleming α-spending boundary
// ---------------------------------------------------------------------------

/**
 * O'Brien-Fleming confidence threshold at look-number information fraction t.
 *
 * At look k out of K planned looks, t = k/K. The OBF stopping boundary is
 *   z_bound(t) = z_{α/2} / √t
 * giving a two-sided confidence threshold of 1 − erfc(z_bound / √2).
 *
 * Properties:
 *   t = 1/K (first look):  threshold is very strict (protects against false early stops)
 *   t = 1.0 (final look):  threshold = 1 − erfc(1.96/√2) ≈ 0.95 (nominal α)
 *
 * By Lan–DeMets α-spending theory, P(ever reject H₀ across all K looks | H₀) = α,
 * so this eliminates repeated-peeking false-positive inflation.
 */
export function obfConfidenceThreshold(
  informationFraction: number,
  alpha = 0.05,
): number {
  const t = Math.max(1e-4, Math.min(1, informationFraction));
  const zAlpha2 = alpha === 0.01 ? 2.576 : alpha === 0.10 ? 1.645 : 1.96;
  const zBound = zAlpha2 / Math.sqrt(t);
  return Math.min(1 - erfc(zBound / Math.SQRT2), 1);
}

// ---------------------------------------------------------------------------
// Sequential testing guard
// ---------------------------------------------------------------------------

export interface SequentialGuardParams {
  confidence: number;           // computed confidence (1 - pValue)
  participants: number;         // min(control, variant) per-arm participant count
  elapsedDays: number;          // days since experiment start
  minimumParticipants: number;  // target per-arm count (from minimumSampleSizePerArm)
  minimumDays?: number;         // default 7
  /**
   * Total experiment duration in days. Required for OBF boundary — used to
   * compute the look number (elapsedDays − minimumDays + 1) relative to the
   * total planned number of looks (durationDays − minimumDays + 1).
   * Defaults to 14 when omitted.
   */
  durationDays?: number;
  /**
   * Explicit flat confidence threshold. When provided, bypasses OBF and uses
   * this value directly. Use only in tests that exercise a specific threshold.
   */
  confidenceThreshold?: number;
}

/**
 * Returns true only when ALL three conditions are met:
 *   1. confidence >= threshold  (O'Brien-Fleming boundary by default)
 *   2. participants >= minimumParticipants  (per-arm power floor)
 *   3. elapsed days >= minimumDays  (default 7, day-of-week noise washout)
 *
 * The OBF boundary uses look number as the information fraction:
 *   t = (elapsedDays − minimumDays + 1) / (durationDays − minimumDays + 1)
 * At the final analysis day (t = 1), the threshold converges to nominal 0.95.
 * On earlier days (t < 1), the threshold is stricter, controlling the overall
 * Type I error at α = 0.05 across all daily looks regardless of how many are taken.
 */
export function isReadyToStop(params: SequentialGuardParams): boolean {
  const {
    confidence,
    participants,
    elapsedDays,
    minimumParticipants,
    minimumDays = 7,
    durationDays = 14,
    confidenceThreshold,
  } = params;

  let threshold: number;
  if (confidenceThreshold !== undefined) {
    threshold = confidenceThreshold;
  } else {
    const lookNumber = Math.max(1, elapsedDays - minimumDays + 1);
    const totalLooks = Math.max(1, durationDays - minimumDays + 1);
    threshold = obfConfidenceThreshold(lookNumber / totalLooks);
  }

  return (
    confidence >= threshold &&
    participants >= minimumParticipants &&
    elapsedDays >= minimumDays
  );
}

// ---------------------------------------------------------------------------
// Result classification
// ---------------------------------------------------------------------------

export type ExperimentResult = 'positive' | 'negative' | 'inconclusive';

/**
 * Classify experiment outcome once it is ready to stop.
 * A positive result means the variant meaningfully outperformed control.
 * A negative result means control meaningfully outperformed variant.
 * Inconclusive means significance was never reached within the duration.
 */
export function classifyResult(
  result: ProportionTestResult | null,
  reachedSignificance: boolean,
  confidenceThreshold = 0.95,
): ExperimentResult {
  if (!reachedSignificance || !result || result.confidence < confidenceThreshold) {
    return 'inconclusive';
  }
  return result.liftPct >= 0 ? 'positive' : 'negative';
}

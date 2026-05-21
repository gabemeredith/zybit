/**
 * Layer 2 Learn — per-site rule-threshold calibration.
 *
 * Where Layer 1 (`learnReranker.ts`) re-orders findings *after* the rules run,
 * Layer 2 mutates the rules' detection floors *before* they run, per site,
 * based on accumulated experiment outcomes for each `ruleId`:
 *
 *   - A rule whose experiments repeatedly *win* on a site is trustworthy there
 *     → loosen its detection floor (multiplier < 1) so it surfaces findings on
 *     weaker signal.
 *   - A rule whose experiments repeatedly *lose* → tighten its floor
 *     (multiplier > 1) so it only fires on stronger signal.
 *
 * Pure function: same outcomes input → same calibration output. No DB, no clock.
 * Computed in `runInsightsPipeline` from the same rows Layer 1 reads, threaded
 * into `AuditRuleContext.calibration`, and applied by each rule via the
 * `calibratedFloor` / `calibratedCap` helpers below.
 *
 * Design decisions:
 * - Aggregation is **per ruleId** (site-global), because a rule's threshold is
 *   a single module constant shared across every page — there is nothing
 *   per-path to tune. (Layer 1's path/modType cascade lives at the finding
 *   level, not the threshold level.)
 * - Only **conclusive** outcomes (positive/negative) count toward the gate.
 *   We require `MIN_CONCLUSIVE_OUTCOMES` before moving a threshold at all, so a
 *   single noisy result can't swing detection — matching the "repeatedly wins /
 *   loses" intent.
 * - Per-outcome signal reuses Layer 1's shape: `clamp(liftPct, ±20) ×
 *   confidence × 0.01`, guardrail breach stacks `−0.10`. Inconclusives
 *   contribute ≈0 naturally (low confidence × small lift).
 * - Net signal and the resulting ±multiplier are both clamped to ±30%.
 *
 * Out of scope: Layer 3 cross-site priors (deferred until 50+ customers).
 */

import { clamp } from './helpers';
import type { AuditRuleContext, RuleCalibration } from './types';
import type { ExperimentOutcomeRow } from '@/lib/phase2/outcomes/repository';

const LIFT_CLAMP = 20;
const LIFT_SCALE = 0.01;
const GUARDRAIL_PENALTY = 0.1;
/** Bound on the aggregate win/loss signal, mapped 1:1 to the multiplier swing. */
const SIGNAL_CLAMP = 0.3;
const MIN_MULTIPLIER = 1 - SIGNAL_CLAMP; // 0.7 — most we loosen a floor
const MAX_MULTIPLIER = 1 + SIGNAL_CLAMP; // 1.3 — most we tighten a floor
/** Conclusive outcomes required before a threshold moves off neutral. */
const MIN_CONCLUSIVE_OUTCOMES = 3;
/** Multiplier within ±this of 1.0 reads as "neutral" for direction/reason. */
const NEUTRAL_EPSILON = 0.02;

/**
 * Rules whose detection floor is a genuine *signal-strength* threshold and so
 * is meaningful to calibrate. Deliberately excludes `hero-hierarchy-inversion`:
 * its only gate is a sample-size minimum (`MIN_CTA_CLICKS`) — the inversion it
 * detects is binary and has no magnitude knob, so loosening it would let the
 * rule fire on under-powered traffic rather than on a weaker-but-real signal.
 * Calibration is about sensitivity, not traffic-sufficiency, so that rule is
 * left out.
 */
export const CALIBRATED_RULE_IDS: ReadonlySet<string> = new Set([
  'rage-click-target',
  'bounce-on-key-page',
  'error-exposure',
  'form-abandonment',
  'help-seeking-spike',
  'hesitation-pattern',
  'mobile-engagement-asymmetry',
  'nav-dispersion',
  'return-visit-thrash',
  'cohort-pain-asymmetry',
  'above-fold-coverage',
]);

function contributionFor(outcome: ExperimentOutcomeRow): number {
  const lift = clamp(outcome.liftPct ?? 0, -LIFT_CLAMP, LIFT_CLAMP);
  const conf = outcome.confidence ?? 0;
  let c = lift * conf * LIFT_SCALE;
  if (outcome.guardrailBreached) {
    c -= GUARDRAIL_PENALTY;
  }
  return c;
}

function buildReason(
  matches: ExperimentOutcomeRow[],
  direction: RuleCalibration['direction'],
  multiplier: number,
): string {
  const wins = matches.filter((m) => m.result === 'positive' && !m.guardrailBreached).length;
  const losses = matches.filter((m) => m.result === 'negative').length;
  const breaches = matches.filter((m) => m.guardrailBreached).length;

  const parts: string[] = [];
  if (wins) parts.push(`${wins} past win${wins > 1 ? 's' : ''}`);
  if (losses) parts.push(`${losses} past loss${losses > 1 ? 'es' : ''}`);
  if (breaches) parts.push(`${breaches} guardrail breach${breaches > 1 ? 'es' : ''}`);
  const summary = parts.length > 0 ? parts.join(', ') : `${matches.length} past tests`;

  const verb =
    direction === 'loosen'
      ? 'detection threshold loosened'
      : direction === 'tighten'
        ? 'detection threshold raised'
        : 'detection threshold unchanged';
  return `${summary} on this site — ${verb} (×${multiplier.toFixed(2)})`;
}

/**
 * Compute per-rule calibrations from a site's experiment outcomes.
 * Returns one entry per `ruleId` that has outcomes; rules with too few
 * conclusive outcomes get a neutral (1.0) multiplier.
 */
export function computeRuleCalibrations(
  outcomes: ExperimentOutcomeRow[],
): Map<string, RuleCalibration> {
  const byRule = new Map<string, ExperimentOutcomeRow[]>();
  for (const outcome of outcomes) {
    if (!outcome.ruleId) continue;
    if (!CALIBRATED_RULE_IDS.has(outcome.ruleId)) continue;
    const bucket = byRule.get(outcome.ruleId);
    if (bucket) bucket.push(outcome);
    else byRule.set(outcome.ruleId, [outcome]);
  }

  const calibrations = new Map<string, RuleCalibration>();
  for (const [ruleId, matches] of byRule) {
    const conclusiveCount = matches.filter(
      (m) => m.result === 'positive' || m.result === 'negative',
    ).length;

    if (conclusiveCount < MIN_CONCLUSIVE_OUTCOMES) {
      calibrations.set(ruleId, {
        ruleId,
        multiplier: 1,
        direction: 'neutral',
        netSignal: 0,
        conclusiveCount,
        reason: `${conclusiveCount} conclusive outcome${conclusiveCount === 1 ? '' : 's'} on this site — need ${MIN_CONCLUSIVE_OUTCOMES} to calibrate; threshold unchanged`,
        basedOnOutcomeIds: matches.map((m) => m.id),
      });
      continue;
    }

    const rawSignal = matches.reduce((sum, o) => sum + contributionFor(o), 0);
    const netSignal = clamp(rawSignal, -SIGNAL_CLAMP, SIGNAL_CLAMP);
    // Positive signal (rule wins here) lowers the floor → more sensitive.
    const multiplier = clamp(1 - netSignal, MIN_MULTIPLIER, MAX_MULTIPLIER);
    const direction: RuleCalibration['direction'] =
      multiplier < 1 - NEUTRAL_EPSILON
        ? 'loosen'
        : multiplier > 1 + NEUTRAL_EPSILON
          ? 'tighten'
          : 'neutral';

    calibrations.set(ruleId, {
      ruleId,
      multiplier,
      direction,
      netSignal,
      conclusiveCount,
      reason: buildReason(matches, direction, multiplier),
      basedOnOutcomeIds: matches.map((m) => m.id),
    });
  }

  return calibrations;
}

/**
 * Apply calibration to a **lower-bound** detection floor — a threshold the
 * observed signal must *exceed* for the rule to fire (e.g. a minimum rate or
 * count). Multiplier < 1 lowers the bar; > 1 raises it. Returns `base`
 * unchanged when no calibration is present.
 */
export function calibratedFloor(
  ctx: AuditRuleContext,
  ruleId: string,
  base: number,
): number {
  const cal = ctx.calibration?.get(ruleId);
  return cal ? base * cal.multiplier : base;
}

/**
 * Apply calibration to an **upper-bound** cap — a threshold the observed signal
 * must stay *below* for the rule to fire (e.g. a max submit rate, a max Gini).
 * Loosening (multiplier < 1) should make the rule fire more readily, which for
 * a cap means *raising* it. We scale the complementary gap `(1 - cap)` by the
 * multiplier and convert back, keeping the result in [0, 1].
 */
export function calibratedCap(
  ctx: AuditRuleContext,
  ruleId: string,
  cap: number,
): number {
  const cal = ctx.calibration?.get(ruleId);
  if (!cal) return cap;
  return clamp(1 - (1 - cap) * cal.multiplier, 0, 1);
}

// Exported for tests.
export const __ruleCalibrationInternals = {
  LIFT_CLAMP,
  LIFT_SCALE,
  GUARDRAIL_PENALTY,
  SIGNAL_CLAMP,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER,
  MIN_CONCLUSIVE_OUTCOMES,
  NEUTRAL_EPSILON,
};

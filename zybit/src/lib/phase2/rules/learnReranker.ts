/**
 * Layer 1 Learn — per-site re-ranking of audit findings based on past
 * experiment outcomes for the same site.
 *
 * Pure function: same (findings, outcomes) input → same output. No DB, no
 * clock. Runs after `runAuditRules` in `runInsightsPipeline`.
 *
 * Design decisions (see `docs/ARCHITECTURE.md:384` and the conversation that
 * produced this code):
 *
 * - Matching: **cascade** by tier — strongest non-empty tier wins, weaker
 *   tiers are ignored for that finding.
 *     Tier 1: (ruleId, pathRef, modificationType)
 *     Tier 2: (ruleId, pathRef)
 *     Tier 3: (ruleId, modificationType)
 *     Tier 4: (ruleId)
 * - Weight: **D-with-guardrails** —
 *     contribution = clamp(liftPct, ±LIFT_CLAMP) × confidence × tierStrength × LIFT_SCALE
 *     guardrail breach stacks a fixed −GUARDRAIL_PENALTY × tierStrength
 *     total delta = clamp(sum, ±DELTA_CLAMP)
 * - Inconclusives (I-2): no special case — low confidence × small lift
 *   naturally drives contribution toward zero.
 * - Visibility (Z-3): math always applies; pill/panel rendered only when
 *   |delta| ≥ VISIBILITY_THRESHOLD.
 *
 * Out of scope: rule-threshold calibration (Layer 2), cross-site priors
 * (Layer 3), suppression of findings.
 */

import type { AuditFinding, LearnAdjustment } from './types';
import type { ExperimentOutcomeRow } from '@/lib/phase2/outcomes/repository';

const TIER_STRENGTH: Record<1 | 2 | 3 | 4, number> = {
  1: 1.0,
  2: 0.6,
  3: 0.35,
  4: 0.15,
};

const LIFT_CLAMP = 20;
const LIFT_SCALE = 0.01;
const GUARDRAIL_PENALTY = 0.1;
const DELTA_CLAMP = 0.3;
const VISIBILITY_THRESHOLD = 0.05;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Parse a finding's stable id (`<ruleId>:<pathRef>`) into its parts.
 * Returns ruleId/pathRef from the finding object directly; falls back to the
 * id only if needed. Modification type isn't on a finding (it's chosen later
 * when the PM builds an experiment) — Tier 1 / Tier 3 match against
 * `null === null` in that case, which the cascade handles by falling through.
 */
function findingKey(f: AuditFinding): {
  ruleId: string;
  pathRef: string | null;
  modificationType: string | null;
} {
  return {
    ruleId: f.ruleId,
    pathRef: f.pathRef,
    // Findings don't yet have a chosen modificationType. Tier 1/3 only match
    // past outcomes whose modificationType is also null, which is rare. The
    // cascade falls through to Tier 2/4 in the common case.
    modificationType: null,
  };
}

function matchesTier(
  finding: { ruleId: string; pathRef: string | null; modificationType: string | null },
  outcome: ExperimentOutcomeRow,
  tier: 1 | 2 | 3 | 4,
): boolean {
  if (outcome.ruleId !== finding.ruleId) return false;
  switch (tier) {
    case 1:
      return (
        outcome.pathRef === finding.pathRef &&
        outcome.modificationType === finding.modificationType
      );
    case 2:
      return outcome.pathRef === finding.pathRef;
    case 3:
      return outcome.modificationType === finding.modificationType;
    case 4:
      return true;
  }
}

function selectCascadeMatches(
  finding: AuditFinding,
  outcomes: ExperimentOutcomeRow[],
): { tier: 1 | 2 | 3 | 4; matches: ExperimentOutcomeRow[] } | null {
  const key = findingKey(finding);
  for (const tier of [1, 2, 3, 4] as const) {
    const matches = outcomes.filter((o) => matchesTier(key, o, tier));
    if (matches.length > 0) return { tier, matches };
  }
  return null;
}

function contributionFor(
  outcome: ExperimentOutcomeRow,
  tierStrength: number,
): number {
  const lift = clamp(outcome.liftPct ?? 0, -LIFT_CLAMP, LIFT_CLAMP);
  const conf = outcome.confidence ?? 0;
  let c = lift * conf * tierStrength * LIFT_SCALE;
  if (outcome.guardrailBreached) {
    c -= GUARDRAIL_PENALTY * tierStrength;
  }
  return c;
}

function buildReason(
  matches: ExperimentOutcomeRow[],
  tier: 1 | 2 | 3 | 4,
  delta: number,
): string {
  const wins = matches.filter((m) => m.result === 'positive' && !m.guardrailBreached).length;
  const losses = matches.filter((m) => m.result === 'negative').length;
  const breaches = matches.filter((m) => m.guardrailBreached).length;
  const inconclusives = matches.filter((m) => m.result === 'inconclusive').length;

  const parts: string[] = [];
  if (wins) parts.push(`${wins} past win${wins > 1 ? 's' : ''}`);
  if (losses) parts.push(`${losses} past loss${losses > 1 ? 'es' : ''}`);
  if (breaches) parts.push(`${breaches} guardrail breach${breaches > 1 ? 'es' : ''}`);
  if (inconclusives) parts.push(`${inconclusives} inconclusive`);

  const summary = parts.length > 0 ? parts.join(', ') : `${matches.length} past test${matches.length > 1 ? 's' : ''}`;
  const sign = delta >= 0 ? '+' : '−';
  return `Tier ${tier} match — ${summary} (${sign}${Math.abs(delta).toFixed(2)})`;
}

/**
 * Apply Layer 1 Learn re-ranking. Returns a new array; does not mutate input.
 * Findings are sorted by adjusted `priorityScore` descending.
 */
export function applyLearnRerank(
  findings: AuditFinding[],
  outcomes: ExperimentOutcomeRow[],
): AuditFinding[] {
  if (findings.length === 0 || outcomes.length === 0) {
    return findings.slice().sort((a, b) => b.priorityScore - a.priorityScore);
  }

  const adjusted = findings.map((finding) => {
    const selection = selectCascadeMatches(finding, outcomes);
    if (!selection) return finding;

    const { tier, matches } = selection;
    const tierStrength = TIER_STRENGTH[tier];
    const rawDelta = matches.reduce((sum, o) => sum + contributionFor(o, tierStrength), 0);
    const delta = clamp(rawDelta, -DELTA_CLAMP, DELTA_CLAMP);

    const learnAdjustment: LearnAdjustment = {
      delta,
      tier,
      direction: delta >= 0 ? 'boost' : 'dampen',
      reason: buildReason(matches, tier, delta),
      basedOnOutcomeIds: matches.map((m) => m.id),
      visible: Math.abs(delta) >= VISIBILITY_THRESHOLD,
    };

    return {
      ...finding,
      priorityScore: clamp(finding.priorityScore + delta, 0, 1),
      learnAdjustment,
    };
  });

  return adjusted.sort((a, b) => b.priorityScore - a.priorityScore);
}

// Exported for tests.
export const __learnRerankerInternals = {
  TIER_STRENGTH,
  LIFT_CLAMP,
  LIFT_SCALE,
  GUARDRAIL_PENALTY,
  DELTA_CLAMP,
  VISIBILITY_THRESHOLD,
};

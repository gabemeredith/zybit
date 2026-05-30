/**
 * Projected impact for a free-experiment proposal
 * (docs/sprints/free-experiment-loop.md §4, decision A).
 *
 * A cold prospect's site has no behavioral traffic, so the normal
 * `impactEstimate` (which needs affectedRate × volume from real events) can't
 * run. Instead we combine TWO honest inputs:
 *   1. the PM's self-reported numbers (monthly visitors / revenue), captured by
 *      the free-flow micro-step, and
 *   2. a per-change-type benchmark lift range (published-heuristic constants,
 *      NOT a measurement of this site).
 *
 * The result is always labelled `projected: true`. It is a forecast from
 * benchmarks, never a measured A/B outcome — that's the whole integrity point
 * of the decision (real measurement is the paid, real-traffic unlock). Keeping
 * the benchmark ranges as fixed deterministic constants (not model-generated)
 * also satisfies the "no invented numbers as evidence" build rule.
 */

import type { ManufacturedExperiment } from "./auditFindingBrief";

/** Benchmark conversion-lift ranges (percent) per change basis. Conservative,
 *  treated as typical-case heuristics, surfaced to the PM as "projected". */
const BENCHMARK_LIFT_PCT: Record<ManufacturedExperiment["basis"], { min: number; max: number }> = {
  no_above_fold_cta: { min: 5, max: 15 }, // adding a clear primary CTA is a strong lever
  heavy_form: { min: 8, max: 20 }, // ~10% drop per field beyond 3 cuts both ways
  no_h1: { min: 3, max: 10 }, // headline clarity is real but smaller
  starter: { min: 2, max: 8 }, // copy-only A/B on an already-clean page
};

export interface ProjectedImpactInput {
  basis: ManufacturedExperiment["basis"];
  /** PM-reported monthly visitors (optional). */
  monthlyVisitors?: number | null;
  /** PM-reported monthly revenue in dollars (optional). */
  monthlyRevenue?: number | null;
}

export interface ProjectedImpact {
  /** Benchmark conversion-lift range for this change type, as percentages. */
  liftPctRange: { min: number; max: number };
  /** Projected incremental monthly revenue range ($), or null if revenue unknown. */
  revenueRange: { min: number; max: number } | null;
  /** Always true: a projection from benchmarks, not a measured result. */
  projected: true;
  /** PM-readable one-liner explaining what the projection is based on. */
  basisNote: string;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function projectImpact(input: ProjectedImpactInput): ProjectedImpact {
  const liftPctRange = BENCHMARK_LIFT_PCT[input.basis];
  const revenue = positive(input.monthlyRevenue);
  const visitors = positive(input.monthlyVisitors);

  // Incremental monthly revenue ≈ current monthly revenue × the lift fraction.
  // A deliberately simple, conservative proxy: a lift in the conversion path
  // lifts revenue roughly proportionally.
  const revenueRange = revenue
    ? {
        min: Math.round((revenue * liftPctRange.min) / 100),
        max: Math.round((revenue * liftPctRange.max) / 100),
      }
    : null;

  const lift = `${liftPctRange.min}–${liftPctRange.max}%`;
  let basisNote: string;
  if (revenueRange) {
    const anchor = visitors ? ` and ~${formatCount(visitors)} monthly visitors` : "";
    basisNote = `Projected from your ~${formatMoney(revenue!)}/mo${anchor} and a typical ${lift} lift for this change. Not yet measured.`;
  } else {
    basisNote = `Projected ${lift} lift (typical for this change). Add your revenue to see the dollar impact. Not yet measured.`;
  }

  return { liftPctRange, revenueRange, projected: true, basisNote };
}

function formatMoney(dollars: number): string {
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}k`;
  return `$${dollars}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

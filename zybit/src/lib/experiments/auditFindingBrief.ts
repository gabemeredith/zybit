/**
 * Manufacture an experiment proposal from a structural audit finding — the
 * deterministic "here's the experiment we'd run on you" glue for the
 * free-experiment flow (docs/sprints/free-experiment-loop.md §3).
 *
 * One fixed template per finding kind. Pure and deterministic (no AI, no live
 * page needed): the same finding always yields the same proposal. The PM can
 * edit any field before launch; exact selectors/copy are resolved later — by
 * the AI advisor against the live snapshot on the paid path, or shown as a
 * projected preview (with before/after + projected impact) on the free path.
 *
 * The change-type mapping follows the spec §3 table, expressed in the
 * experiment builder's vocabulary (copy | style | hide | insert).
 */

import { runStructuralAudit } from "@/lib/intake/structuralAudit";
import type { IntakeFinding, IntakeFindingKind } from "@/lib/intake/structuralAudit";

/** Change types the experiment builder understands. */
export type BriefChangeType = "copy" | "style" | "hide" | "insert";

export interface ManufacturedExperiment {
  /** Which structural finding this came from, or 'starter' for a clean page. */
  basis: IntakeFindingKind | "starter";
  /** PM-facing experiment name. */
  experimentName: string;
  /** Maps to the experiment builder's change type. */
  changeType: BriefChangeType;
  /** What the variant does, in PM language. */
  variantDescription: string;
  /** Templated prediction the PM can edit. */
  hypothesis: string;
  /** A sensible default primary metric; the PM can override. */
  suggestedPrimaryMetric: string;
}

const TEMPLATES: Record<IntakeFindingKind, Omit<ManufacturedExperiment, "basis">> = {
  no_h1: {
    experimentName: "Add a clear value-led headline",
    changeType: "copy",
    variantDescription:
      "Rewrite the lead heading as a single prominent H1 that names the product and its core value proposition.",
    hypothesis:
      "A clear, benefit-led headline gives visitors instant context, so more stay and engage instead of bouncing.",
    suggestedPrimaryMetric: "Primary CTA click-through rate",
  },
  no_above_fold_cta: {
    experimentName: "Add a primary CTA above the fold",
    changeType: "insert",
    variantDescription:
      'Insert a high-contrast primary button in the hero, above the fold, with action-led copy (not "Learn more").',
    hypothesis:
      "Giving above-the-fold visitors an obvious next action increases clicks into the funnel.",
    suggestedPrimaryMetric: "Primary CTA click-through rate",
  },
  heavy_form: {
    experimentName: "Shorten the form to its essential fields",
    changeType: "hide",
    variantDescription:
      "Hide non-essential fields, leaving the minimum needed to qualify a lead (e.g. email + one qualifier).",
    hypothesis:
      "Fewer fields lowers friction, so a higher share of visitors who start the form complete it.",
    suggestedPrimaryMetric: "Form completion rate",
  },
};

/**
 * Starter experiment for a structurally-clean page (the §3 `no_finding`
 * fallback): nobody dead-ends — a clean page still gets a worthwhile first
 * experiment to run.
 */
const STARTER_EXPERIMENT: ManufacturedExperiment = {
  basis: "starter",
  experimentName: "Test your primary CTA copy",
  changeType: "copy",
  variantDescription:
    "Rewrite the main call-to-action with sharper, benefit-led copy and A/B test it against the current wording.",
  hypothesis: "Clearer, action-led CTA copy increases click-through to the next step.",
  suggestedPrimaryMetric: "Primary CTA click-through rate",
};

export function manufactureExperimentFromFinding(finding: IntakeFinding): ManufacturedExperiment {
  return { basis: finding.kind, ...TEMPLATES[finding.kind] };
}

export type FreeExperimentProposal =
  // A finding was surfaced — propose the experiment that addresses it.
  | { status: "ok"; source: "finding"; finding: IntakeFinding; experiment: ManufacturedExperiment }
  // Page is structurally clean — offer the starter experiment so nobody dead-ends.
  | { status: "ok"; source: "starter"; experiment: ManufacturedExperiment }
  // Client-rendered page: we can't proxy-modify it — caller pivots to "connect your data".
  | { status: "spa" }
  // Snapshot failed — caller retries once, then pivots.
  | { status: "error"; reason: string };

/**
 * Run the structural audit on a cold URL and return a ready-to-show experiment
 * proposal. Implements the §3 fallbacks: a clean page gets the starter
 * experiment; a SPA / error pass through for the caller to handle (connect-data
 * pivot, retry).
 */
export async function proposeFreeExperiment(url: string): Promise<FreeExperimentProposal> {
  const audit = await runStructuralAudit(url);
  switch (audit.status) {
    case "ok":
      return {
        status: "ok",
        source: "finding",
        finding: audit.finding,
        experiment: manufactureExperimentFromFinding(audit.finding),
      };
    case "no_finding":
      return { status: "ok", source: "starter", experiment: STARTER_EXPERIMENT };
    case "spa":
      return { status: "spa" };
    case "error":
      return { status: "error", reason: audit.reason };
  }
}

/**
 * Free-experiment funnel orchestration — the glue that turns a cold URL into a
 * renderable, projected experiment proposal (docs/sprints/free-experiment-loop.md
 * §1, Phases 2–4 composed).
 *
 * Two deliberately separate steps, because locked-decision #8 makes auth timing
 * a pluggable seam:
 *
 *   1. `runFreeExperimentFlow(url, numbers)` — runs the audit, manufactures the
 *      proposal (§3), and computes the projected impact (§4). PURE of any
 *      account/DB state: it produces only the *renderable* result, so it can run
 *      before OR after sign-in without rework.
 *   2. `persistFreeExperiment(result, target)` — once an org + site exist
 *      (post-provision), writes the proposal as a `previewOnly` experiment so it
 *      shows in the cockpit + loop. This is the only step that touches the DB.
 *
 * Keeping (1) free of (2) is the whole point: the cofounder can render the
 * projected result inline-before-sign-in or behind a sign-in gate, and the
 * account-provision step drops in either way.
 */

import { proposeFreeExperiment } from "./auditFindingBrief";
import type { ManufacturedExperiment } from "./auditFindingBrief";
import { projectImpact } from "./projectedImpact";
import type { ProjectedImpact } from "./projectedImpact";
import { createPreviewExperiment } from "./previewExperiment";
import type { IntakeFinding } from "@/lib/intake/structuralAudit";

export interface FreeExperimentNumbers {
  /** PM-reported monthly visitors (optional — §4 micro-step). */
  monthlyVisitors?: number | null;
  /** PM-reported monthly revenue in dollars (optional — §4 micro-step). */
  monthlyRevenue?: number | null;
}

export type FreeExperimentResult =
  // A proposal was produced (from a real finding or the clean-page starter),
  // with its projected impact ready to render.
  | {
      status: "ok";
      source: "finding" | "starter";
      /** Present only when `source === 'finding'`. */
      finding: IntakeFinding | null;
      experiment: ManufacturedExperiment;
      projection: ProjectedImpact;
    }
  // Client-rendered page — we can't proxy-modify it; caller pivots to "connect
  // your data" (§3 SPA fallback).
  | { status: "spa" }
  // Audit failed — caller retries once, then pivots (§3 error fallback).
  | { status: "error"; reason: string };

/**
 * Step 1 — audit → proposal → projection, with no account/DB dependency.
 * Returns a fully renderable result (or a SPA/error pivot signal).
 */
export async function runFreeExperimentFlow(
  url: string,
  numbers: FreeExperimentNumbers = {},
): Promise<FreeExperimentResult> {
  const proposal = await proposeFreeExperiment(url);

  if (proposal.status === "spa") return { status: "spa" };
  if (proposal.status === "error") return { status: "error", reason: proposal.reason };

  const projection = projectImpact({
    basis: proposal.experiment.basis,
    monthlyVisitors: numbers.monthlyVisitors,
    monthlyRevenue: numbers.monthlyRevenue,
  });

  return {
    status: "ok",
    source: proposal.source,
    finding: proposal.source === "finding" ? proposal.finding : null,
    experiment: proposal.experiment,
    projection,
  };
}

export interface PersistFreeExperimentTarget {
  organizationId: string;
  siteId: string;
  /** A persisted finding id, when the funnel created one; else null. */
  findingId?: string | null;
  targetPath?: string | null;
}

/**
 * Step 2 — persist an `ok` flow result as a `previewOnly` experiment. Call only
 * after an org + site exist. Returns the new experiment id.
 */
export async function persistFreeExperiment(
  result: Extract<FreeExperimentResult, { status: "ok" }>,
  target: PersistFreeExperimentTarget,
): Promise<string> {
  return createPreviewExperiment({
    organizationId: target.organizationId,
    siteId: target.siteId,
    findingId: target.findingId ?? null,
    manufactured: result.experiment,
    projection: result.projection,
    targetPath: target.targetPath ?? null,
  });
}

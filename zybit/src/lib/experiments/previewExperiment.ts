/**
 * Preview ("projected") experiment persistence — Phase 4 of the free-experiment
 * loop (docs/sprints/free-experiment-loop.md §5).
 *
 * A preview experiment is the manufactured proposal (§3) plus its projected
 * impact (§4), persisted so the cockpit + loop timeline can render the full
 * detect → propose → projected-result arc. It must NEVER reach a real visitor:
 *   - `previewOnly = true` is excluded by the proxy config query (Phase 1), and
 *   - it has no `startedAt` — it was never deployed to traffic.
 *
 * Status is `completed` (not `draft`/`running`): the projection is the terminal
 * state of a preview, and `completed` keeps it visible on the loop (which skips
 * `draft`) without ever claiming it ran. The `previewOnly` flag — not the
 * status — carries the "not real traffic, projected only" meaning, so the
 * existing state machine stays intact.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/client";
import { zybitExperiments } from "@/lib/db/schema";
import type { ManufacturedExperiment } from "./auditFindingBrief";
import type { ProjectedImpact } from "./projectedImpact";
import type { VariantModification } from "./types";

/** The projection, flattened to a JSON-serializable shape for the notes blob. */
export interface PreviewProjectionNote {
  liftPctRange: { min: number; max: number };
  revenueRange: { min: number; max: number } | null;
  basisNote: string;
}

/**
 * Shape stored in `forge_experiments.notes` for a preview experiment. The
 * `previewOnly: true` marker lets readers distinguish a projected preview from
 * a regular experiment's notes without re-querying the column.
 */
export interface PreviewExperimentNotes {
  name: string;
  changeType: ManufacturedExperiment["changeType"];
  variantDescription: string;
  basis: ManufacturedExperiment["basis"];
  projection: PreviewProjectionNote;
  previewOnly: true;
}

export interface CreatePreviewExperimentParams {
  organizationId: string;
  siteId: string;
  /** The cold free-flow proposal has no persisted finding yet — null is fine. */
  findingId?: string | null;
  manufactured: ManufacturedExperiment;
  projection: ProjectedImpact;
  targetPath?: string | null;
  /** Resolved variant mods, when the advisor produced them; otherwise empty. */
  modifications?: VariantModification[];
  /** Injectable for tests / deterministic seeds. */
  now?: Date;
  db?: ReturnType<typeof getDb>;
}

function toNotes(
  manufactured: ManufacturedExperiment,
  projection: ProjectedImpact,
): PreviewExperimentNotes {
  return {
    name: manufactured.experimentName,
    changeType: manufactured.changeType,
    variantDescription: manufactured.variantDescription,
    basis: manufactured.basis,
    projection: {
      liftPctRange: projection.liftPctRange,
      revenueRange: projection.revenueRange,
      basisNote: projection.basisNote,
    },
    previewOnly: true,
  };
}

/**
 * Insert a preview experiment row and return its id. Never deployed to real
 * traffic (no `startedAt`, `previewOnly = true`).
 */
export async function createPreviewExperiment(
  params: CreatePreviewExperimentParams,
): Promise<string> {
  const db = params.db ?? getDb();
  const now = params.now ?? new Date();
  const id = randomUUID();

  await db.insert(zybitExperiments).values({
    id,
    organizationId: params.organizationId,
    siteId: params.siteId,
    findingId: params.findingId ?? null,
    hypothesis: params.manufactured.hypothesis,
    primaryMetric: params.manufactured.suggestedPrimaryMetric,
    audienceControlPct: 50,
    audienceVariantPct: 50,
    durationDays: 14,
    status: "completed",
    previewOnly: true,
    targetPath: params.targetPath ?? null,
    modifications: params.modifications ?? [],
    notes: JSON.stringify(toNotes(params.manufactured, params.projection)),
    // startedAt stays null — a projection was never deployed.
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

/**
 * Parse a `forge_experiments.notes` blob back into preview notes. Returns null
 * for a regular (non-preview) experiment or malformed JSON, so callers can
 * branch cheaply on `previewOnly` rows without a try/catch at each call site.
 */
export function readPreviewProjectionNote(
  notes: string | null | undefined,
): PreviewExperimentNotes | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as Partial<PreviewExperimentNotes>;
    if (parsed && parsed.previewOnly === true && parsed.projection) {
      return parsed as PreviewExperimentNotes;
    }
    return null;
  } catch {
    return null;
  }
}

import { describe, it, expect } from "vitest";
import {
  createPreviewExperiment,
  readPreviewProjectionNote,
  type PreviewExperimentNotes,
} from "../previewExperiment";
import type { ManufacturedExperiment } from "../auditFindingBrief";
import type { ProjectedImpact } from "../projectedImpact";

const MANUFACTURED: ManufacturedExperiment = {
  basis: "no_above_fold_cta",
  experimentName: "Add a primary CTA above the fold",
  changeType: "insert",
  variantDescription: "Insert a high-contrast primary button in the hero.",
  hypothesis: "An obvious next action increases clicks into the funnel.",
  suggestedPrimaryMetric: "Primary CTA click-through rate",
};

const PROJECTION: ProjectedImpact = {
  liftPctRange: { min: 5, max: 15 },
  revenueRange: { min: 2000, max: 6000 },
  projected: true,
  basisNote: "Projected from your ~$40k/mo and a typical 5–15% lift. Not yet measured.",
};

/** Captures the values passed to db.insert(...).values(...). */
function fakeDb() {
  const captured: { values?: Record<string, unknown> } = {};
  const db = {
    insert() {
      return {
        async values(v: Record<string, unknown>) {
          captured.values = v;
        },
      };
    },
  };
  return { db: db as never, captured };
}

describe("createPreviewExperiment", () => {
  it("inserts a previewOnly, completed, never-started row with the projection in notes", async () => {
    const { db, captured } = fakeDb();
    const now = new Date("2026-05-29T12:00:00Z");

    const id = await createPreviewExperiment({
      organizationId: "org_1",
      siteId: "site_1",
      findingId: "finding_1",
      manufactured: MANUFACTURED,
      projection: PROJECTION,
      targetPath: "/pricing",
      now,
      db,
    });

    expect(id).toBeTruthy();
    const v = captured.values!;
    expect(v.previewOnly).toBe(true);
    expect(v.status).toBe("completed");
    expect(v.startedAt).toBeUndefined(); // never deployed to traffic
    expect(v.completedAt).toBe(now);
    expect(v.organizationId).toBe("org_1");
    expect(v.siteId).toBe("site_1");
    expect(v.findingId).toBe("finding_1");
    expect(v.targetPath).toBe("/pricing");
    expect(v.primaryMetric).toBe(MANUFACTURED.suggestedPrimaryMetric);
    expect(v.modifications).toEqual([]);

    const notes = JSON.parse(v.notes as string) as PreviewExperimentNotes;
    expect(notes.previewOnly).toBe(true);
    expect(notes.name).toBe(MANUFACTURED.experimentName);
    expect(notes.variantDescription).toBe(MANUFACTURED.variantDescription);
    expect(notes.projection).toEqual({
      liftPctRange: { min: 5, max: 15 },
      revenueRange: { min: 2000, max: 6000 },
      basisNote: PROJECTION.basisNote,
    });
  });

  it("defaults findingId to null when omitted (cold free-flow proposal)", async () => {
    const { db, captured } = fakeDb();
    await createPreviewExperiment({
      organizationId: "org_1",
      siteId: "site_1",
      manufactured: MANUFACTURED,
      projection: PROJECTION,
      db,
    });
    expect(captured.values!.findingId).toBeNull();
  });
});

describe("readPreviewProjectionNote", () => {
  it("round-trips a preview notes blob", () => {
    const notes = JSON.stringify({
      name: "x",
      changeType: "insert",
      variantDescription: "y",
      basis: "no_above_fold_cta",
      projection: PROJECTION,
      previewOnly: true,
    });
    const parsed = readPreviewProjectionNote(notes);
    expect(parsed?.previewOnly).toBe(true);
    expect(parsed?.projection.liftPctRange).toEqual({ min: 5, max: 15 });
  });

  it("returns null for a regular experiment's notes", () => {
    expect(readPreviewProjectionNote(JSON.stringify({ name: "regular" }))).toBeNull();
  });

  it("returns null for missing / malformed notes", () => {
    expect(readPreviewProjectionNote(null)).toBeNull();
    expect(readPreviewProjectionNote(undefined)).toBeNull();
    expect(readPreviewProjectionNote("{not json")).toBeNull();
  });
});

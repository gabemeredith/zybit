import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StructuralAuditResult } from "@/lib/intake/structuralAudit";

// Mock the audit so the real proposeFreeExperiment + projectImpact composition
// runs against a controlled finding (no network / Browserless).
const runStructuralAudit = vi.fn<() => Promise<StructuralAuditResult>>();
vi.mock("@/lib/intake/structuralAudit", () => ({
  runStructuralAudit: () => runStructuralAudit(),
}));

// Mock the DB-touching persist primitive so persistFreeExperiment is unit-testable.
const createPreviewExperiment = vi.fn().mockResolvedValue("exp_new");
vi.mock("../previewExperiment", () => ({
  createPreviewExperiment: (args: unknown) => createPreviewExperiment(args),
}));

import { runFreeExperimentFlow, persistFreeExperiment } from "../freeExperimentFlow";

const FINDING = {
  kind: "no_above_fold_cta" as const,
  title: "No clear call to action above the fold",
  evidence: "No primary CTA found in the hero.",
  prescription: "Add a primary CTA above the fold.",
  confidence: 0.8,
  domain: "acme.com",
};

beforeEach(() => {
  runStructuralAudit.mockReset();
  createPreviewExperiment.mockClear();
});

describe("runFreeExperimentFlow", () => {
  it("composes a finding into proposal + projection using the PM's numbers", async () => {
    runStructuralAudit.mockResolvedValue({ status: "ok", finding: FINDING });

    const result = await runFreeExperimentFlow("https://acme.com", {
      monthlyRevenue: 40_000,
      monthlyVisitors: 25_000,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("finding");
    expect(result.finding?.kind).toBe("no_above_fold_cta");
    expect(result.experiment.basis).toBe("no_above_fold_cta");
    // no_above_fold_cta benchmark is 5–15%; revenue range scales off $40k/mo.
    expect(result.projection.liftPctRange).toEqual({ min: 5, max: 15 });
    expect(result.projection.revenueRange).toEqual({ min: 2_000, max: 6_000 });
    expect(result.projection.projected).toBe(true);
  });

  it("falls back to the starter proposal on a clean page (no finding, no dollars without numbers)", async () => {
    runStructuralAudit.mockResolvedValue({ status: "no_finding" });

    const result = await runFreeExperimentFlow("https://clean.com");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("starter");
    expect(result.finding).toBeNull();
    expect(result.experiment.basis).toBe("starter");
    expect(result.projection.revenueRange).toBeNull(); // no numbers supplied
  });

  it("passes a SPA through for the connect-data pivot", async () => {
    runStructuralAudit.mockResolvedValue({ status: "spa" });
    expect(await runFreeExperimentFlow("https://app.spa.com")).toEqual({ status: "spa" });
  });

  it("passes an audit error through for retry/pivot", async () => {
    runStructuralAudit.mockResolvedValue({ status: "error", reason: "timeout" });
    expect(await runFreeExperimentFlow("https://down.com")).toEqual({
      status: "error",
      reason: "timeout",
    });
  });
});

describe("persistFreeExperiment", () => {
  it("forwards the proposal + projection to createPreviewExperiment", async () => {
    runStructuralAudit.mockResolvedValue({ status: "ok", finding: FINDING });
    const result = await runFreeExperimentFlow("https://acme.com", { monthlyRevenue: 40_000 });
    if (result.status !== "ok") throw new Error("expected ok");

    const id = await persistFreeExperiment(result, {
      organizationId: "org_1",
      siteId: "site_1",
      findingId: "finding_1",
      targetPath: "/",
    });

    expect(id).toBe("exp_new");
    expect(createPreviewExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        siteId: "site_1",
        findingId: "finding_1",
        targetPath: "/",
        manufactured: result.experiment,
        projection: result.projection,
      }),
    );
  });
});

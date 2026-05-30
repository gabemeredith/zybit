import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runStructuralAudit = vi.fn();
vi.mock("@/lib/intake/structuralAudit", () => ({
  runStructuralAudit: (...args: unknown[]) => runStructuralAudit(...args),
}));

import {
  manufactureExperimentFromFinding,
  proposeFreeExperiment,
  type ManufacturedExperiment,
} from "../auditFindingBrief";
import type { IntakeFinding, IntakeFindingKind } from "@/lib/intake/structuralAudit";

function finding(kind: IntakeFindingKind): IntakeFinding {
  return { kind, title: "t", evidence: "e", prescription: "p", confidence: 0.8, domain: "acme.com" };
}

function assertWellFormed(exp: ManufacturedExperiment) {
  expect(["copy", "style", "hide", "insert"]).toContain(exp.changeType);
  for (const field of [exp.experimentName, exp.variantDescription, exp.hypothesis, exp.suggestedPrimaryMetric]) {
    expect(field.length).toBeGreaterThan(0);
  }
}

describe("manufactureExperimentFromFinding", () => {
  it("maps each finding kind to the spec §3 change type, well-formed", () => {
    const cases: Array<[IntakeFindingKind, ManufacturedExperiment["changeType"]]> = [
      ["no_h1", "copy"],
      ["no_above_fold_cta", "insert"],
      ["heavy_form", "hide"],
    ];
    for (const [kind, changeType] of cases) {
      const exp = manufactureExperimentFromFinding(finding(kind));
      expect(exp.basis).toBe(kind);
      expect(exp.changeType).toBe(changeType);
      assertWellFormed(exp);
    }
  });

  it("is deterministic — same finding yields an identical proposal", () => {
    expect(manufactureExperimentFromFinding(finding("heavy_form"))).toEqual(
      manufactureExperimentFromFinding(finding("heavy_form")),
    );
  });
});

describe("proposeFreeExperiment", () => {
  beforeEach(() => runStructuralAudit.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("proposes the matching experiment when the audit surfaces a finding", async () => {
    runStructuralAudit.mockResolvedValueOnce({ status: "ok", finding: finding("no_above_fold_cta") });
    const result = await proposeFreeExperiment("acme.com");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("finding");
      if (result.source === "finding") expect(result.experiment.basis).toBe("no_above_fold_cta");
    }
  });

  it("falls back to the starter experiment on a structurally-clean page", async () => {
    runStructuralAudit.mockResolvedValueOnce({ status: "no_finding" });
    const result = await proposeFreeExperiment("clean.com");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("starter");
      assertWellFormed(result.experiment);
    }
  });

  it("passes SPA through for the connect-data pivot", async () => {
    runStructuralAudit.mockResolvedValueOnce({ status: "spa" });
    expect((await proposeFreeExperiment("app.com")).status).toBe("spa");
  });

  it("passes errors through with the reason", async () => {
    runStructuralAudit.mockResolvedValueOnce({ status: "error", reason: "TIMEOUT: slow" });
    const result = await proposeFreeExperiment("down.com");
    expect(result).toEqual({ status: "error", reason: "TIMEOUT: slow" });
  });
});

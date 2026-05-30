/**
 * Tests for the `/app/try` funnel actions — the cold-URL → projected-preview
 * glue (docs/sprints/free-experiment-loop.md §1).
 *
 * Strategy: mock every boundary (auth, URL validator, gate, flow orchestration,
 * site repo, redirect) and assert the branching that matters — the gate
 * pre-check that avoids burning an audit, the retry-once-then-pivot on error,
 * the atomic-claim race, and site reuse-vs-create.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetServerAuth = vi.hoisted(() => vi.fn());
const mockValidatePublicUrl = vi.hoisted(() => vi.fn());
const mockLoadGate = vi.hoisted(() => vi.fn());
const mockClaimSlot = vi.hoisted(() => vi.fn());
const mockRunFlow = vi.hoisted(() => vi.fn());
const mockPersist = vi.hoisted(() => vi.fn());
const mockListSites = vi.hoisted(() => vi.fn());
const mockCreateSite = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);

vi.mock("@/lib/auth/serverAuth", () => ({ getServerAuth: mockGetServerAuth }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/audit/urlValidator", () => ({ validatePublicUrl: mockValidatePublicUrl }));
vi.mock("@/lib/billing/freeExperimentGate", () => ({
  loadFreeExperimentGate: mockLoadGate,
  claimFreeExperimentSlot: mockClaimSlot,
}));
vi.mock("@/lib/experiments/freeExperimentFlow", () => ({
  runFreeExperimentFlow: mockRunFlow,
  persistFreeExperiment: mockPersist,
}));
vi.mock("@/lib/phase1", () => ({
  createPhase1Repository: () => ({ listSites: mockListSites, createSite: mockCreateSite }),
}));

import {
  generateFreeExperimentAction,
  saveFreeExperimentAction,
  type FreeExperimentSavePayload,
} from "../actions";

const ORG = "org-1";

const EXPERIMENT = {
  basis: "no_above_fold_cta" as const,
  experimentName: "Add a primary CTA above the fold",
  changeType: "insert" as const,
  variantDescription: "Insert a high-contrast primary button in the hero.",
  hypothesis: "An obvious next action increases clicks.",
  suggestedPrimaryMetric: "Primary CTA click-through rate",
};
const PROJECTION = {
  liftPctRange: { min: 5, max: 15 },
  revenueRange: { min: 2000, max: 6000 },
  projected: true as const,
  basisNote: "Projected from your numbers. Not yet measured.",
};

function okFlow(source: "finding" | "starter" = "finding") {
  return {
    status: "ok" as const,
    source,
    finding: source === "finding" ? { title: "No primary CTA above the fold" } : null,
    experiment: EXPERIMENT,
    projection: PROJECTION,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerAuth.mockResolvedValue({ ok: true, orgId: ORG });
  mockValidatePublicUrl.mockResolvedValue({ valid: true, url: new URL("https://acme.com/pricing") });
  mockLoadGate.mockResolvedValue({ allowed: true, reason: "free-slot-available" });
  mockClaimSlot.mockResolvedValue(true);
});

describe("generateFreeExperimentAction", () => {
  it("rejects an invalid URL before checking the gate or auditing", async () => {
    mockValidatePublicUrl.mockResolvedValueOnce({ valid: false, reason: "Bad URL." });

    const res = await generateFreeExperimentAction("not a url", {
      monthlyVisitors: null,
      monthlyRevenue: null,
    });

    expect(res).toEqual({ status: "invalid", reason: "Bad URL." });
    expect(mockLoadGate).not.toHaveBeenCalled();
    expect(mockRunFlow).not.toHaveBeenCalled();
  });

  it("blocks a used-up org WITHOUT spending an audit", async () => {
    mockLoadGate.mockResolvedValueOnce({ allowed: false, reason: "free-slot-used" });

    const res = await generateFreeExperimentAction("acme.com", {
      monthlyVisitors: null,
      monthlyRevenue: null,
    });

    expect(res).toEqual({ status: "blocked" });
    expect(mockRunFlow).not.toHaveBeenCalled();
  });

  it("returns the projected result + a save payload on success", async () => {
    mockRunFlow.mockResolvedValueOnce(okFlow("finding"));

    const res = await generateFreeExperimentAction("acme.com", {
      monthlyVisitors: 25000,
      monthlyRevenue: 40000,
    });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.domain).toBe("acme.com");
    expect(res.findingTitle).toBe("No primary CTA above the fold");
    expect(res.payload.experiment).toEqual(EXPERIMENT);
    expect(res.payload.projection).toEqual(PROJECTION);
  });

  it("pivots to SPA without retrying", async () => {
    mockRunFlow.mockResolvedValueOnce({ status: "spa" });

    const res = await generateFreeExperimentAction("acme.com", {
      monthlyVisitors: null,
      monthlyRevenue: null,
    });

    expect(res).toEqual({ status: "spa" });
    expect(mockRunFlow).toHaveBeenCalledTimes(1);
  });

  it("retries once on error, then pivots to error", async () => {
    mockRunFlow
      .mockResolvedValueOnce({ status: "error", reason: "timeout" })
      .mockResolvedValueOnce({ status: "error", reason: "timeout" });

    const res = await generateFreeExperimentAction("acme.com", {
      monthlyVisitors: null,
      monthlyRevenue: null,
    });

    expect(res).toEqual({ status: "error", reason: "timeout" });
    expect(mockRunFlow).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry succeeds", async () => {
    mockRunFlow
      .mockResolvedValueOnce({ status: "error", reason: "timeout" })
      .mockResolvedValueOnce(okFlow("starter"));

    const res = await generateFreeExperimentAction("acme.com", {
      monthlyVisitors: null,
      monthlyRevenue: null,
    });

    expect(res.status).toBe("ok");
    expect(mockRunFlow).toHaveBeenCalledTimes(2);
  });
});

describe("saveFreeExperimentAction", () => {
  const payload: FreeExperimentSavePayload = {
    url: "https://acme.com/pricing",
    source: "finding",
    experiment: EXPERIMENT,
    projection: PROJECTION,
  };

  it("claims the slot, reuses the existing site, persists, and redirects", async () => {
    mockListSites.mockResolvedValueOnce([{ id: "site-1", domain: "acme.com" }]);
    mockPersist.mockResolvedValueOnce("exp-1");

    await expect(saveFreeExperimentAction(payload)).rejects.toThrow("REDIRECT:/app/experiments/exp-1");

    expect(mockClaimSlot).toHaveBeenCalledWith(ORG, expect.any(Date));
    expect(mockCreateSite).not.toHaveBeenCalled();
    expect(mockPersist).toHaveBeenCalledOnce();
    const [result, target] = mockPersist.mock.calls[0];
    expect(result.experiment).toEqual(EXPERIMENT);
    expect(target).toMatchObject({ organizationId: ORG, siteId: "site-1", targetPath: "/pricing" });
  });

  it("creates a site from the audited domain when the org has none", async () => {
    mockListSites.mockResolvedValueOnce([]);
    mockCreateSite.mockResolvedValueOnce({ id: "site-new", domain: "acme.com" });
    mockPersist.mockResolvedValueOnce("exp-2");

    await expect(saveFreeExperimentAction(payload)).rejects.toThrow("REDIRECT:/app/experiments/exp-2");

    expect(mockCreateSite).toHaveBeenCalledOnce();
    expect(mockCreateSite.mock.calls[0][0]).toMatchObject({ organizationId: ORG, domain: "acme.com" });
  });

  it("blocks (no persist) when the slot claim loses the race", async () => {
    mockClaimSlot.mockResolvedValueOnce(false);

    const res = await saveFreeExperimentAction(payload);

    expect(res).toEqual({ status: "blocked" });
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("blocks (no claim, no persist) when the gate is already used", async () => {
    mockLoadGate.mockResolvedValueOnce({ allowed: false, reason: "free-slot-used" });

    const res = await saveFreeExperimentAction(payload);

    expect(res).toEqual({ status: "blocked" });
    expect(mockClaimSlot).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("does NOT consume a slot for a paid org", async () => {
    mockLoadGate.mockResolvedValueOnce({ allowed: true, reason: "paid" });
    mockListSites.mockResolvedValueOnce([{ id: "site-1", domain: "acme.com" }]);
    mockPersist.mockResolvedValueOnce("exp-3");

    await expect(saveFreeExperimentAction(payload)).rejects.toThrow("REDIRECT:/app/experiments/exp-3");

    expect(mockClaimSlot).not.toHaveBeenCalled();
    expect(mockPersist).toHaveBeenCalledOnce();
  });
});

/**
 * Tests for the `/app/try` rich-preview action (Option 2) — cold URL → real
 * audit → top finding + before/after → renderable result
 * (docs/sprints/free-experiment-loop.md §1).
 *
 * Strategy: mock every heavy boundary (auth, URL validator, the lighthouse
 * audit runner, the DB finding read, the fix-preview generator) and assert the
 * branching that matters — invalid URL short-circuits before the audit,
 * unreachable/no-finding map to their own states, and a successful run maps the
 * finding + before/after + projection correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetServerAuth = vi.hoisted(() => vi.fn());
const mockValidatePublicUrl = vi.hoisted(() => vi.fn());
const mockRunUrlAudit = vi.hoisted(() => vi.fn());
const mockGenerateFixPreviews = vi.hoisted(() => vi.fn());
const mockRenderScreenshot = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() =>
  vi.fn((p: string) => {
    throw new Error(`REDIRECT:${p}`);
  }),
);

vi.mock("@/lib/auth/serverAuth", () => ({ getServerAuth: mockGetServerAuth }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/audit/urlValidator", () => ({ validatePublicUrl: mockValidatePublicUrl }));
vi.mock("@/lib/audit/fixPreview", () => ({ generateFixPreviews: mockGenerateFixPreviews }));
vi.mock("@/lib/phase2/findings/screenshot", () => ({ renderFindingScreenshot: mockRenderScreenshot }));
vi.mock("../../../../../lighthouse/lib/runner/runUrlAudit", () => ({
  runUrlAudit: mockRunUrlAudit,
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: mockLimit }) }),
      }),
    }),
  }),
}));

import { generateFreeExperimentAction } from "../actions";

const NUMBERS = { monthlyVisitors: 25_000, monthlyRevenue: 40_000 };

const TOP_FINDING = {
  id: "f1",
  ruleId: "hero-hierarchy-inversion",
  title: "Your primary CTA is buried below the fold",
  summary: "Visitors who don't scroll have no obvious next action.",
  severity: "warn",
  pathRef: "/",
  evidence: [{ label: "Above-fold CTAs", value: 0 }],
  recommendation: ["Add a high-contrast primary button in the hero."],
  prescription: {
    whatToChange: "Add a primary CTA above the fold.",
    whyItWorks: "An obvious next action lifts click-through.",
    experimentVariantDescription: "Insert a hero CTA button.",
  },
  impactEstimate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerAuth.mockResolvedValue({ ok: true, orgId: "org-1" });
  mockValidatePublicUrl.mockResolvedValue({ valid: true, url: new URL("https://acme.com/pricing") });
  mockRunUrlAudit.mockResolvedValue({
    siteId: "lighthouse_sit_acme",
    organizationId: "lighthouse_org_acme",
    counts: { snapshots: 1 },
  });
  mockLimit.mockResolvedValue([TOP_FINDING]);
  mockGenerateFixPreviews.mockResolvedValue([
    {
      findingId: "f1",
      preview: { beforeUrl: "https://blob/before.png", afterUrl: "https://blob/after.png", tier: 1, rationale: "Added a hero CTA." },
      reason: "ok",
    },
  ]);
  mockRenderScreenshot.mockResolvedValue({
    screenshotUrl: "https://blob/annotated.png",
    annotationsCount: 1,
    capturedAt: new Date(0),
  });
});

describe("generateFreeExperimentAction", () => {
  it("rejects an invalid URL before running the audit", async () => {
    mockValidatePublicUrl.mockResolvedValueOnce({ valid: false, reason: "Bad URL." });
    const res = await generateFreeExperimentAction("not a url", NUMBERS);
    expect(res).toEqual({ status: "invalid", reason: "Bad URL." });
    expect(mockRunUrlAudit).not.toHaveBeenCalled();
  });

  it("maps a successful audit → rich finding + before/after + projection", async () => {
    const res = await generateFreeExperimentAction("acme.com", NUMBERS);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.domain).toBe("acme.com");
    expect(res.finding.title).toBe(TOP_FINDING.title);
    expect(res.finding.evidence).toEqual(TOP_FINDING.evidence);
    expect(res.beforeUrl).toBe("https://blob/before.png");
    expect(res.afterUrl).toBe("https://blob/after.png");
    expect(res.fixTier).toBe(1);
    // Before/after rendered ⇒ the annotated-screenshot fallback is skipped.
    expect(res.screenshotUrl).toBeNull();
    expect(mockRenderScreenshot).not.toHaveBeenCalled();
    // 5–12% of $40k → $2k–$4.8k
    expect(res.projection.revenueRange).toEqual({ min: 2000, max: 4800 });
  });

  it("omits the dollar range when no revenue is given", async () => {
    const res = await generateFreeExperimentAction("acme.com", {
      monthlyVisitors: null,
      monthlyRevenue: null,
    });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.projection.revenueRange).toBeNull();
    expect(res.projection.liftPctRange).toEqual({ min: 5, max: 12 });
  });

  it("returns 'error' when the page is unreachable (zero snapshots)", async () => {
    mockRunUrlAudit.mockResolvedValueOnce({
      siteId: "s",
      organizationId: "o",
      counts: { snapshots: 0 },
    });
    const res = await generateFreeExperimentAction("acme.com", NUMBERS);
    expect(res).toEqual({ status: "error", reason: "unreachable" });
  });

  it("returns 'no_finding' when the audit surfaces nothing", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await generateFreeExperimentAction("acme.com", NUMBERS);
    expect(res).toEqual({ status: "no_finding", domain: "acme.com" });
  });

  it("falls back to the annotated screenshot when the fix preview fails", async () => {
    mockGenerateFixPreviews.mockRejectedValueOnce(new Error("browserless down"));
    const res = await generateFreeExperimentAction("acme.com", NUMBERS);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.beforeUrl).toBeNull();
    expect(res.afterUrl).toBeNull();
    // Guaranteed visual: the annotated page screenshot.
    expect(mockRenderScreenshot).toHaveBeenCalledWith("f1", "lighthouse_org_acme");
    expect(res.screenshotUrl).toBe("https://blob/annotated.png");
  });

  it("returns 'error' when the audit throws", async () => {
    mockRunUrlAudit.mockRejectedValueOnce(new Error("crawl failed"));
    const res = await generateFreeExperimentAction("acme.com", NUMBERS);
    expect(res).toEqual({ status: "error", reason: "crawl failed" });
  });
});

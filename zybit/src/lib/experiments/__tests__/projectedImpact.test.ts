import { describe, expect, it } from "vitest";
import { projectImpact } from "../projectedImpact";

describe("projectImpact", () => {
  it("returns a benchmark lift range and a dollar range when revenue is known", () => {
    const r = projectImpact({ basis: "no_above_fold_cta", monthlyRevenue: 50_000, monthlyVisitors: 50_000 });
    expect(r.liftPctRange).toEqual({ min: 5, max: 15 });
    // 5–15% of $50k = $2,500–$7,500.
    expect(r.revenueRange).toEqual({ min: 2_500, max: 7_500 });
    expect(r.projected).toBe(true);
    expect(r.basisNote).toMatch(/projected/i);
    expect(r.basisNote).toMatch(/not yet measured/i);
  });

  it("omits the dollar range and says so when revenue is unknown", () => {
    const r = projectImpact({ basis: "heavy_form" });
    expect(r.liftPctRange).toEqual({ min: 8, max: 20 });
    expect(r.revenueRange).toBeNull();
    expect(r.basisNote).toMatch(/add your revenue/i);
  });

  it("treats zero / negative / non-finite numbers as unknown", () => {
    for (const bad of [0, -100, NaN, Infinity]) {
      expect(projectImpact({ basis: "no_h1", monthlyRevenue: bad }).revenueRange).toBeNull();
    }
  });

  it("has a distinct benchmark range for every basis", () => {
    const bases = ["no_h1", "no_above_fold_cta", "heavy_form", "starter"] as const;
    for (const basis of bases) {
      const { liftPctRange } = projectImpact({ basis });
      expect(liftPctRange.min).toBeGreaterThan(0);
      expect(liftPctRange.max).toBeGreaterThan(liftPctRange.min);
    }
  });
});

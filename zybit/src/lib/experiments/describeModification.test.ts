import { describe, expect, it } from "vitest";
import { describeModification } from "./describeModification";
import type { VariantModification } from "./types";

describe("describeModification", () => {
  describe("text-replace", () => {
    it("returns selector + text payload for a real modification", () => {
      const d = describeModification({
        type: "text-replace",
        selector: "[data-testid=cta]",
        text: "Get started",
      });
      expect(d.selector).toBe("[data-testid=cta]");
      expect(d.payloadLabel).toBe("text");
      expect(d.payloadValue).toBe("Get started");
      expect(d.noOp).toBe(false);
    });

    it("flags noOp when selector is empty", () => {
      expect(
        describeModification({ type: "text-replace", selector: "", text: "x" }).noOp,
      ).toBe(true);
    });

    it("flags noOp when text is empty", () => {
      expect(
        describeModification({ type: "text-replace", selector: ".cta", text: "" }).noOp,
      ).toBe(true);
    });
  });

  describe("css-inject", () => {
    it("returns selector + css payload for a real modification", () => {
      const d = describeModification({
        type: "css-inject",
        selector: ".cta",
        css: "color: red;",
      });
      expect(d.payloadLabel).toBe("css");
      expect(d.payloadValue).toBe("color: red;");
      expect(d.noOp).toBe(false);
    });

    it("flags noOp on empty selector or empty css", () => {
      expect(describeModification({ type: "css-inject", selector: "", css: "x" }).noOp).toBe(true);
      expect(
        describeModification({ type: "css-inject", selector: ".x", css: "" }).noOp,
      ).toBe(true);
    });
  });

  describe("element-hide / element-show", () => {
    it("has no payload but reports the selector", () => {
      const d = describeModification({ type: "element-hide", selector: ".banner" });
      expect(d.selector).toBe(".banner");
      expect(d.payloadLabel).toBeNull();
      expect(d.payloadValue).toBeNull();
      expect(d.noOp).toBe(false);
    });

    it("flags noOp when selector is empty", () => {
      expect(describeModification({ type: "element-hide", selector: "" }).noOp).toBe(true);
      expect(describeModification({ type: "element-show", selector: "" }).noOp).toBe(true);
    });
  });

  describe("attribute-set", () => {
    it("formats payloadLabel as `attr=` and reports value", () => {
      const d = describeModification({
        type: "attribute-set",
        selector: "img",
        attr: "alt",
        value: "Logo",
      });
      expect(d.payloadLabel).toBe("alt=");
      expect(d.payloadValue).toBe("Logo");
      expect(d.noOp).toBe(false);
    });

    it("flags noOp on empty selector or empty attr name", () => {
      expect(
        describeModification({ type: "attribute-set", selector: "", attr: "alt", value: "x" })
          .noOp,
      ).toBe(true);
      expect(
        describeModification({ type: "attribute-set", selector: "img", attr: "", value: "x" })
          .noOp,
      ).toBe(true);
    });
  });

  describe("element-reorder", () => {
    it("reports parentSelector and renders childOrder as a comma-joined string", () => {
      const d = describeModification({
        type: "element-reorder",
        parentSelector: ".nav",
        childOrder: [2, 0, 1],
      });
      expect(d.selector).toBe(".nav");
      expect(d.payloadLabel).toBe("order");
      expect(d.payloadValue).toBe("2, 0, 1");
      expect(d.noOp).toBe(false);
    });

    it("flags noOp on empty parentSelector or empty childOrder", () => {
      expect(
        describeModification({
          type: "element-reorder",
          parentSelector: "",
          childOrder: [0, 1],
        }).noOp,
      ).toBe(true);
      expect(
        describeModification({
          type: "element-reorder",
          parentSelector: ".x",
          childOrder: [],
        }).noOp,
      ).toBe(true);
    });
  });

  it("covers every VariantModification variant in the union (no unreachable branches)", () => {
    const cases: VariantModification[] = [
      { type: "text-replace", selector: ".a", text: "x" },
      { type: "css-inject", selector: ".a", css: "x" },
      { type: "element-hide", selector: ".a" },
      { type: "element-show", selector: ".a" },
      { type: "attribute-set", selector: ".a", attr: "alt", value: "x" },
      { type: "element-reorder", parentSelector: ".a", childOrder: [0] },
    ];
    for (const m of cases) {
      expect(describeModification(m).noOp).toBe(false);
    }
  });
});

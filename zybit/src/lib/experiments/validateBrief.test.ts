import { describe, expect, it } from "vitest";
import { validateBriefShape } from "./validateBrief";

describe("validateBriefShape", () => {
  it("accepts a copy brief with a real selector and non-empty text", () => {
    expect(validateBriefShape("copy", "[data-testid=cta]", "Get started")).toBeNull();
  });

  it("accepts a style brief with a real selector and non-empty classes", () => {
    expect(validateBriefShape("style", ".btn-primary", "bg-blue-600 text-white")).toBeNull();
  });

  it("accepts a hide brief with a real selector and ignores newValue", () => {
    expect(validateBriefShape("hide", ".banner", "")).toBeNull();
    expect(validateBriefShape("hide", ".banner", "ignored")).toBeNull();
  });

  it("rejects an empty selector regardless of change type", () => {
    for (const ct of ["copy", "style", "hide"] as const) {
      const err = validateBriefShape(ct, "", "anything");
      expect(err?.field).toBe("selector");
      expect(err?.type).toBe("validation_error");
    }
  });

  it("rejects empty newValue for copy with a copy-specific message", () => {
    const err = validateBriefShape("copy", "[data-testid=cta]", "");
    expect(err?.field).toBe("newValue");
    expect(err?.message).toMatch(/copy/i);
  });

  it("rejects empty newValue for style with a style-specific message", () => {
    const err = validateBriefShape("style", ".btn", "");
    expect(err?.field).toBe("newValue");
    expect(err?.message).toMatch(/css/i);
  });

  it("does not require newValue for hide briefs (no-op-by-design)", () => {
    expect(validateBriefShape("hide", ".banner", "")).toBeNull();
  });

  it("trims-zero-length is responsibility of caller — empty-string-only check, not whitespace", () => {
    // The action layer trims before calling validateBriefShape; this helper
    // intentionally only checks length === 0 so whitespace-only strings
    // already trimmed-to-empty by the caller hit the same path.
    expect(validateBriefShape("copy", " ", "x")?.field).toBeUndefined();
    expect(validateBriefShape("copy", "ok", " ")?.field).toBeUndefined();
  });

  describe("insert change type", () => {
    it("accepts an insert brief with selector, position, and valid HTML", () => {
      expect(
        validateBriefShape(
          "insert",
          ".banner",
          "<section><h2>Quick answer</h2><p>copy</p></section>",
          "before",
        ),
      ).toBeNull();
    });

    it("rejects an insert brief missing an insertPosition", () => {
      const err = validateBriefShape("insert", ".banner", "<p>x</p>", undefined);
      expect(err?.field).toBe("insertPosition");
    });

    it("rejects an insert brief with an unknown insertPosition", () => {
      const err = validateBriefShape("insert", ".banner", "<p>x</p>", "sideways");
      expect(err?.field).toBe("insertPosition");
    });

    it("rejects an insert brief with empty HTML", () => {
      const err = validateBriefShape("insert", ".banner", "   ", "before");
      expect(err?.field).toBe("newValue");
    });

    it("rejects insert HTML that sanitizes to nothing (only script/iframe)", () => {
      const err = validateBriefShape(
        "insert",
        ".banner",
        "<script>alert(1)</script><iframe></iframe>",
        "before",
      );
      expect(err?.field).toBe("newValue");
      expect(err?.message).toMatch(/allowed tags/i);
    });
  });
});

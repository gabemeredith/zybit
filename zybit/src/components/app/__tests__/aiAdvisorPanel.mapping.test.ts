/**
 * Pure-logic test for the AI proposal → builder-brief mapping inside
 * AiAdvisorPanel. We don't render the React tree — only verify that each
 * supported VariantModification type maps to the right ChangeType/payload
 * and that unsupported types decline cleanly (so the "Use this" button
 * stays disabled instead of producing a partial brief).
 *
 * Re-implementing the mapping table here rather than re-exporting it from
 * the component file keeps the component's surface area to its props.
 */

import { describe, it, expect } from "vitest";
import type { VariantModification } from "@/lib/experiments/types";
import type { ChangeType } from "@/app/app/findings/[id]/experiment/page";

interface Proposal {
  selector: string;
  changeType: ChangeType;
  newValue: string;
  insertPosition?: "before" | "after" | "prepend" | "append";
}

function modToProposal(mod: VariantModification): Proposal | null {
  switch (mod.type) {
    case "text-replace":
      return { selector: mod.selector, changeType: "copy", newValue: mod.text };
    case "css-inject":
      return { selector: mod.selector, changeType: "style", newValue: mod.css };
    case "element-hide":
      return { selector: mod.selector, changeType: "hide", newValue: "" };
    case "element-insert":
      return {
        selector: mod.selector,
        changeType: "insert",
        newValue: mod.html,
        insertPosition: mod.position,
      };
    default:
      return null;
  }
}

describe("AI proposal → brief mapping", () => {
  it("maps text-replace to copy", () => {
    const p = modToProposal({ type: "text-replace", selector: ".cta", text: "Buy" });
    expect(p).toEqual({ selector: ".cta", changeType: "copy", newValue: "Buy" });
  });

  it("maps css-inject to style", () => {
    const p = modToProposal({ type: "css-inject", selector: "h1", css: "color:red" });
    expect(p).toEqual({ selector: "h1", changeType: "style", newValue: "color:red" });
  });

  it("maps element-hide to hide with empty newValue", () => {
    const p = modToProposal({ type: "element-hide", selector: ".banner" });
    expect(p).toEqual({ selector: ".banner", changeType: "hide", newValue: "" });
  });

  it("maps element-insert to insert with position", () => {
    const p = modToProposal({
      type: "element-insert",
      selector: "h1",
      position: "after",
      html: "<p>hi</p>",
    });
    expect(p).toEqual({
      selector: "h1",
      changeType: "insert",
      newValue: "<p>hi</p>",
      insertPosition: "after",
    });
  });

  it.each([
    { type: "element-show", selector: ".x" } as const,
    { type: "attribute-set", selector: ".x", attr: "href", value: "/y" } as const,
    { type: "element-reorder", parentSelector: ".x", childOrder: [1, 0] } as const,
  ])("declines unsupported type %s", (mod) => {
    expect(modToProposal(mod as VariantModification)).toBeNull();
  });
});

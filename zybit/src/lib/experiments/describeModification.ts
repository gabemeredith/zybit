import type { VariantModification } from "./types";

export interface DescribedModification {
  /** Selector or parentSelector this modification targets at proxy time. */
  selector: string;
  /** Label for the payload field (e.g. "text", "css", "attr=") or null when the type has none. */
  payloadLabel: string | null;
  /** Payload value (replacement text, CSS string, attribute value, child-order list, …). */
  payloadValue: string | null;
  /**
   * True when this modification would silently do nothing at preview/proxy
   * time: an empty selector (`querySelector("") → null`), or an empty
   * payload for the change types that need one. Used to render an amber
   * warning on the experiment detail page so a PM can spot why variant
   * iframes match control.
   */
  noOp: boolean;
}

/**
 * Project a `VariantModification` onto its visual representation for the
 * experiment detail UI. Pure — no React, no formatting decisions other
 * than payload labelling. The page component handles rendering and the
 * amber banner; this function only decides what's degenerate.
 */
export function describeModification(mod: VariantModification): DescribedModification {
  switch (mod.type) {
    case "text-replace":
      return {
        selector: mod.selector,
        payloadLabel: "text",
        payloadValue: mod.text,
        noOp: mod.selector.length === 0 || mod.text.length === 0,
      };
    case "css-inject":
      return {
        selector: mod.selector,
        payloadLabel: "css",
        payloadValue: mod.css,
        noOp: mod.selector.length === 0 || mod.css.length === 0,
      };
    case "attribute-set":
      return {
        selector: mod.selector,
        payloadLabel: `${mod.attr}=`,
        payloadValue: mod.value,
        noOp: mod.selector.length === 0 || mod.attr.length === 0,
      };
    case "element-hide":
    case "element-show":
      return {
        selector: mod.selector,
        payloadLabel: null,
        payloadValue: null,
        noOp: mod.selector.length === 0,
      };
    case "element-reorder":
      return {
        selector: mod.parentSelector,
        payloadLabel: "order",
        payloadValue: mod.childOrder.join(", "),
        noOp: mod.parentSelector.length === 0 || mod.childOrder.length === 0,
      };
  }
}

/**
 * Brief-shape validation shared between the save and launch server actions.
 *
 * Rejects briefs whose modifications would be silent no-ops at preview/proxy
 * time: an empty selector (querySelector("") returns null in node-html-parser
 * and the browser, so `text-replace` / `element-hide` / etc. all do nothing),
 * or an empty replacement value for the change types that need one.
 *
 * The experiment-builder form has client-side gates for both, but this
 * remains the source of truth — API callers, devtools-stripped form
 * submissions, and stale briefs saved before the form grew its gates all
 * route through here.
 */

import { sanitizeInsertHtml } from "./sanitizeInsertHtml";
import type { InsertPosition } from "./types";

export type BriefChangeType = "copy" | "style" | "hide" | "insert";

export const INSERT_POSITIONS: readonly InsertPosition[] = ["before", "after", "prepend", "append"] as const;

export type ValidationError = {
  type: "validation_error";
  field: "selector" | "newValue" | "changeType" | "insertPosition";
  message: string;
};

export function validateBriefShape(
  changeType: BriefChangeType,
  selector: string,
  newValue: string,
  insertPosition?: string,
): ValidationError | null {
  if (selector.length === 0) {
    return {
      type: "validation_error",
      field: "selector",
      message: "CSS selector is required.",
    };
  }
  if ((changeType === "copy" || changeType === "style") && newValue.length === 0) {
    return {
      type: "validation_error",
      field: "newValue",
      message:
        changeType === "copy"
          ? "Variant copy is required for a copy change."
          : "CSS classes are required for a style change.",
    };
  }
  if (changeType === "insert") {
    if (!insertPosition || !(INSERT_POSITIONS as readonly string[]).includes(insertPosition)) {
      return {
        type: "validation_error",
        field: "insertPosition",
        message: "Pick where to add the new section relative to the anchor.",
      };
    }
    if (newValue.trim().length === 0) {
      return {
        type: "validation_error",
        field: "newValue",
        message: "Add the HTML for the new section.",
      };
    }
    // Reject briefs whose markup sanitizes to nothing — would silently no-op
    // at proxy time and leave the PM wondering why control == variant.
    if (sanitizeInsertHtml(newValue).trim().length === 0) {
      return {
        type: "validation_error",
        field: "newValue",
        message: "No allowed tags found — use plain markup like <section>, <h2>, <p>, <a>.",
      };
    }
  }
  return null;
}

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

export type BriefChangeType = "copy" | "style" | "hide";

export type ValidationError = {
  type: "validation_error";
  field: "selector" | "newValue" | "changeType";
  message: string;
};

export function validateBriefShape(
  changeType: BriefChangeType,
  selector: string,
  newValue: string,
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
  return null;
}

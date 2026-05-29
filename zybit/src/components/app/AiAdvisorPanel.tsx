/**
 * Zybit-145 — AI Variant Advisor UI.
 *
 * Sits above the selector field in `ExperimentBuilderForm`. Calls
 * `POST /api/dashboard/experiments/ai-suggest` (Zybit-144) and renders up
 * to 3 proposals. "Use this" pre-fills the brief in-place — the PM still
 * reviews and edits before saving.
 *
 * Surfaces the three non-success states the route can return:
 *   - 503 AI_UNAVAILABLE   → "AI not configured" (production env gate)
 *   - 429 RATE_LIMITED     → daily quota message with remaining count
 *   - 502 AI_UPSTREAM_ERROR → upstream Gemini error
 *
 * Only the 4 modification types that map cleanly onto the builder's
 * change-type buttons are importable from a proposal (copy / style /
 * hide / insert). `attribute-set` and `element-show` get displayed but
 * cannot be applied; the "Use this" button is disabled with a tooltip
 * explaining why. `element-reorder` is already excluded server-side.
 */

"use client";

import { useState } from "react";
import { useAnalytics } from "@/lib/analytics";
import type {
  VariantModification,
  InsertPosition,
} from "@/lib/experiments/types";
import type {
  ChangeType,
} from "@/app/app/findings/[id]/experiment/page";

interface AdvisorOption {
  label: string;
  modifications: VariantModification[];
  confidence: "high" | "low";
}

interface AdvisorSuccessPayload {
  options: AdvisorOption[];
  droppedCount: number;
  note: string | null;
  captureMethod: string;
  usage: { usedToday: number; remaining: number; limit: number };
}

/**
 * The route emits three distinct envelopes depending on which gate the
 * request hit:
 *   - 200 via `success(...)`        → { success: true, data: {...} }
 *   - 400 via `badRequest(...)`     → { success: false, error: { code, message } }
 *   - 429/502/503 raw `NextResponse.json` → { ok: false, error: string, code }
 * `normalizeAdvisorResponse` collapses them to a single tagged-union the
 * render path consumes, so a future shape drift only has to be fixed here.
 */
function normalizeAdvisorResponse(
  status: number,
  body: unknown,
):
  | { kind: "ok"; data: AdvisorSuccessPayload }
  | { kind: "err"; message: string; code?: string } {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  if (
    status >= 200 &&
    status < 300 &&
    obj.success === true &&
    obj.data &&
    typeof obj.data === "object"
  ) {
    return { kind: "ok", data: obj.data as AdvisorSuccessPayload };
  }
  if (obj.ok === false) {
    return {
      kind: "err",
      message: typeof obj.error === "string" ? obj.error : "AI request failed.",
      ...(typeof obj.code === "string" ? { code: obj.code } : {}),
    };
  }
  if (obj.success === false && obj.error && typeof obj.error === "object") {
    const err = obj.error as { code?: string; message?: string };
    return {
      kind: "err",
      message: err.message ?? "AI request failed.",
      ...(err.code ? { code: err.code } : {}),
    };
  }
  return { kind: "err", message: `AI request failed (HTTP ${status}).` };
}

export interface AppliedProposal {
  selector: string;
  changeType: ChangeType;
  newValue: string;
  insertPosition?: InsertPosition;
}

interface Props {
  findingId: string;
  onApply: (proposal: AppliedProposal) => void;
}

const TYPE_LABELS: Record<VariantModification["type"], string> = {
  "text-replace": "Copy",
  "css-inject": "Style",
  "element-hide": "Hide",
  "element-show": "Show",
  "attribute-set": "Attribute",
  "element-reorder": "Reorder",
  "element-insert": "Insert",
};

/**
 * Convert one AI-emitted modification to the builder's flat brief shape.
 * Returns null for kinds the form can't represent — keeps the "Use this"
 * affordance honest (a click never produces a partial / silently-dropped
 * brief).
 */
function modToProposal(mod: VariantModification): AppliedProposal | null {
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

/**
 * Returns the first mod in `option.modifications` that maps onto the
 * builder shape. We don't try to compose multi-mod options into a single
 * brief — that would silently drop the rest.
 */
function firstApplicableMod(option: AdvisorOption): VariantModification | null {
  for (const m of option.modifications) {
    if (modToProposal(m) !== null) return m;
  }
  return null;
}

function previewValue(mod: VariantModification): string {
  switch (mod.type) {
    case "text-replace":
      return `"${mod.text}"`;
    case "css-inject":
      return mod.css.length > 80 ? mod.css.slice(0, 77) + "..." : mod.css;
    case "element-hide":
    case "element-show":
      return "(no value)";
    case "attribute-set":
      return `${mod.attr} = "${mod.value}"`;
    case "element-reorder":
      return `order: [${mod.childOrder.join(", ")}]`;
    case "element-insert":
      return mod.html.length > 80 ? mod.html.slice(0, 77) + "..." : mod.html;
  }
}

export default function AiAdvisorPanel({ findingId, onApply }: Props) {
  type State =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; data: AdvisorSuccessPayload }
    | { kind: "error"; message: string; code?: string };

  const [state, setState] = useState<State>({ kind: "idle" });
  const analytics = useAnalytics();

  async function fetchSuggestions() {
    setState({ kind: "loading" });
    analytics.aiAdvisorRequested({ findingId });
    try {
      const res = await fetch("/api/dashboard/experiments/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId }),
      });
      const json = await res.json().catch(() => ({}));
      const normalized = normalizeAdvisorResponse(res.status, json);
      if (normalized.kind === "err") {
        if (res.status === 429) {
          analytics.aiAdvisorRateLimited({ findingId });
        } else {
          analytics.aiAdvisorError({ findingId, code: normalized.code });
        }
        setState({
          kind: "error",
          message: normalized.message,
          ...(normalized.code ? { code: normalized.code } : {}),
        });
        return;
      }
      analytics.aiAdvisorResponded({
        findingId,
        proposalCount: normalized.data.options.length,
        dailyUsed: normalized.data.usage.usedToday,
      });
      setState({ kind: "loaded", data: normalized.data });
    } catch (err) {
      analytics.aiAdvisorError({ findingId });
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error.",
      });
    }
  }

  function handleApply(option: AdvisorOption) {
    const mod = firstApplicableMod(option);
    if (!mod) return;
    const proposal = modToProposal(mod);
    if (proposal) onApply(proposal);
  }

  return (
    <div className="brut-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="brut-label">
            AI variant advisor
          </div>
          <p className="text-[11px] text-[#6B6B6B] mt-1 leading-relaxed">
            Get 3 proposals grounded in this finding&apos;s prescription + the
            page snapshot. You review and edit before saving.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchSuggestions}
          disabled={state.kind === "loading"}
          className="brut-action-ghost shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
        >
          {state.kind === "loading"
            ? "Thinking…"
            : state.kind === "loaded"
              ? "Suggest again"
              : "Suggest with AI"}
        </button>
      </div>

      {state.kind === "error" && (
        <p className="text-[11px] text-amber-700">
          {state.code === "AI_UNAVAILABLE"
            ? "AI advisor isn't configured for this environment. Build the brief manually."
            : state.code === "RATE_LIMITED"
              ? state.message
              : state.message}
        </p>
      )}

      {state.kind === "loaded" && (
        <div className="space-y-2">
          {state.data.note && (
            <p className="text-[11px] text-amber-700">{state.data.note}</p>
          )}
          {(state.data.options ?? []).length === 0 && (
            <p className="text-[11px] text-[#6B6B6B]">
              No valid proposals. Try again or build manually.
            </p>
          )}
          {(state.data.options ?? []).map((option, i) => {
            const mod = firstApplicableMod(option);
            const applicable = mod !== null;
            const displayMod = mod ?? option.modifications[0];
            return (
              <div
                key={i}
                className="brut-card p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="brut-badge shrink-0 bg-black/[0.05] text-[#6B6B6B] px-1.5 py-0.5 text-[9px]">
                      {TYPE_LABELS[displayMod?.type ?? "text-replace"]}
                    </span>
                    {option.confidence === "low" && (
                      <span className="brut-badge shrink-0 bg-amber-300 text-[#111] px-1.5 py-0.5 text-[9px]">
                        Low confidence
                      </span>
                    )}
                    <span className="text-xs font-medium text-[#111] truncate">
                      {option.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApply(option)}
                    disabled={!applicable}
                    title={
                      applicable
                        ? "Pre-fills the brief with this proposal"
                        : "This proposal type can't be imported into the brief. Build manually."
                    }
                    className="brut-action-ghost shrink-0 px-2.5 py-1 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Use this
                  </button>
                </div>
                {displayMod && (
                  <div className="font-mono text-[10px] text-[#6B6B6B] truncate">
                    {("selector" in displayMod ? displayMod.selector : "") + " "}
                    <span className="text-[#9B9B9B]">→</span>{" "}
                    <span className="text-[#111]">{previewValue(displayMod)}</span>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-[#9B9B9B] mt-2">
            {state.data.usage.remaining} of {state.data.usage.limit} AI requests
            left today.
          </p>
        </div>
      )}
    </div>
  );
}

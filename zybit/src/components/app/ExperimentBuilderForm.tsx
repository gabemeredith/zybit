"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { saveExperimentBriefAction } from "@/app/app/findings/[id]/experiment/actions";
import type { ChangeType, SelectorSuggestion } from "@/app/app/findings/[id]/experiment/page";
import type { CssSystem } from "@/lib/phase2/snapshots/cssSystemDetector";
import { copyHints } from "@/lib/experiments/copyHint";

interface FormDefaults {
  experimentName: string;
  selector: string;
  changeType: ChangeType;
  newValue: string;
  variantDescription: string;
  primaryMetric: string;
  hypothesis: string;
}

interface Props {
  findingId: string;
  defaults: FormDefaults;
  suggestions: SelectorSuggestion[];
  cssSystem?: CssSystem;
}

const CSS_SYSTEM_HINTS: Partial<Record<CssSystem, { label: string; example: string }>> = {
  tailwind: {
    label: "Tailwind CSS detected",
    example: "Use utility classes like bg-blue-600 text-white font-bold px-4 py-2",
  },
  "styled-components": {
    label: "styled-components detected",
    example: "Class names are hashed at runtime — use data-zybit-ref selectors from the suggestions above",
  },
  emotion: {
    label: "Emotion CSS detected",
    example: "Class names are generated at runtime — use data-zybit-ref selectors from the suggestions above",
  },
  "css-modules": {
    label: "CSS Modules detected",
    example: "Class names are hashed per-build — prefer element-level selectors like button or h1",
  },
  bootstrap: {
    label: "Bootstrap detected",
    example: "Use Bootstrap utility classes like btn-primary d-flex justify-content-center",
  },
};

type ValidateStatus = 'ok' | 'invalid_selector' | 'no_snapshot' | 'empty';
interface ValidateResult {
  count: number | null;
  status: ValidateStatus;
}

const CHANGE_TYPE_OPTIONS: Array<{ value: ChangeType; label: string; hint: string }> = [
  { value: "copy", label: "Change text copy", hint: "Replaces element text content" },
  { value: "style", label: "Swap CSS classes", hint: "Adds/removes class names" },
  { value: "hide", label: "Hide element", hint: "Sets display: none on element" },
];

const INPUT_CLASS =
  "w-full border border-black/[0.1] rounded-lg px-3 py-2 text-sm text-[#111] bg-white focus:outline-none focus:ring-1 focus:ring-black/[0.2] placeholder-[#9B9B9B]";

const SECTION_LABEL = "block text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-2";

function SelectorBadge({ result, loading }: { result: ValidateResult | null; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/[0.04] text-[#9B9B9B]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#9B9B9B] animate-pulse" />
        Checking…
      </span>
    );
  }
  if (!result || result.status === 'empty') return null;
  if (result.status === 'invalid_selector') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">
        Invalid selector
      </span>
    );
  }
  if (result.status === 'no_snapshot') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/[0.04] text-[#9B9B9B]">
        No snapshot to validate against
      </span>
    );
  }
  const count = result.count ?? 0;
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        No matches
      </span>
    );
  }
  if (count === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        1 match
      </span>
    );
  }
  const MULTI_MATCH_STYLES = {
    amber: {
      badge: "bg-amber-50 text-amber-700 border border-amber-100",
      dot: "w-1.5 h-1.5 rounded-full bg-amber-400",
    },
    red: {
      badge: "bg-red-50 text-red-700 border border-red-100",
      dot: "w-1.5 h-1.5 rounded-full bg-red-400",
    },
  } as const;
  const variant = count <= 5 ? "amber" : "red";
  const s = MULTI_MATCH_STYLES[variant];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.badge}`}>
      <span className={s.dot} />
      {count} matches{count > 5 ? " — too broad?" : ""}
    </span>
  );
}

function SuggestionsDropdown({
  suggestions,
  onSelect,
  onClose,
}: {
  suggestions: SelectorSuggestion[];
  onSelect: (selector: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (suggestions.length === 0) {
    return (
      <div ref={ref} className="absolute top-full left-0 right-0 mt-1 bg-white border border-black/[0.1] rounded-xl shadow-lg z-20 p-3">
        <p className="text-xs text-[#9B9B9B]">No snapshot elements available — type a selector manually.</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute top-full left-0 right-0 mt-1 bg-white border border-black/[0.1] rounded-xl shadow-lg z-20 max-h-52 overflow-y-auto">
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { onSelect(s.selector); onClose(); }}
          className="w-full text-left px-3 py-2.5 hover:bg-black/[0.03] transition-colors border-b border-black/[0.04] last:border-0"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#111] truncate">{s.label}</span>
            <span
              className={`shrink-0 ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                s.stability === "stable"
                  ? "bg-emerald-50 text-emerald-700"
                  : s.stability === "fragile"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-black/[0.04] text-[#9B9B9B]"
              }`}
              title={
                s.stability === "stable"
                  ? "Robust selector — survives most redesigns"
                  : s.stability === "fragile"
                    ? "Positional selector — breaks if markup order changes"
                    : "Moderately stable selector"
              }
            >
              {s.stability}
            </span>
          </div>
          <div className="font-mono text-[10px] text-[#9B9B9B] truncate mt-0.5">{s.selector}</div>
        </button>
      ))}
    </div>
  );
}

export default function ExperimentBuilderForm({ findingId, defaults, suggestions, cssSystem }: Props) {
  const [experimentName, setExperimentName] = useState(defaults.experimentName);
  const [selector, setSelector] = useState(defaults.selector);
  const [changeType, setChangeType] = useState<ChangeType>(defaults.changeType);
  const [newValue, setNewValue] = useState(defaults.newValue);
  const [variantDescription, setVariantDescription] = useState(defaults.variantDescription);
  const [primaryMetric, setPrimaryMetric] = useState(defaults.primaryMetric);
  const [hypothesis, setHypothesis] = useState(defaults.hypothesis);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [validateLoading, setValidateLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const validateSelector = useCallback(async (sel: string) => {
    if (!sel.trim()) {
      setValidateResult(null);
      setValidateLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setValidateLoading(true);
    try {
      const res = await fetch('/api/selector-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId, selector: sel }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json() as ValidateResult;
        setValidateResult(data);
      }
    } catch {
      // Network error or abort — silently suppress, don't block the form
    } finally {
      if (!controller.signal.aborted) setValidateLoading(false);
    }
  }, [findingId]);

  function handleSelectorChange(val: string) {
    setSelector(val);
    setValidateLoading(!!val.trim());
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => validateSelector(val), 500);
  }

  // Validate initial selector on mount (deferred so setState runs outside effect body)
  useEffect(() => {
    if (defaults.selector) {
      const t = setTimeout(() => validateSelector(defaults.selector), 0);
      return () => {
        clearTimeout(t);
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Block submit when the validator has confirmed the selector matches nothing
  // or is malformed. `no_snapshot` is *not* blocking — we can't verify without
  // a snapshot, so trust the PM. `null` (validator hasn't returned yet) is
  // also not blocking; the server-side check is the backstop.
  const selectorBlocked =
    validateResult?.status === 'invalid_selector' ||
    (validateResult?.status === 'ok' && (validateResult.count ?? 0) === 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectorBlocked) return;
    setSaving(true);
    try {
      await saveExperimentBriefAction({
        findingId,
        experimentName,
        selector,
        changeType,
        newValue,
        variantDescription,
        primaryMetric,
        hypothesis,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Experiment name */}
      <div>
        <label className={SECTION_LABEL} htmlFor="experiment-name">
          Experiment name
        </label>
        <input
          id="experiment-name"
          type="text"
          value={experimentName}
          onChange={(e) => setExperimentName(e.target.value)}
          maxLength={200}
          required
          className={INPUT_CLASS}
        />
      </div>

      {/* CSS selector */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B]" htmlFor="selector">
            CSS selector
          </label>
          <SelectorBadge result={validateResult} loading={validateLoading} />
        </div>
        <div className="relative">
          <div className="flex gap-2">
            <input
              id="selector"
              type="text"
              value={selector}
              onChange={(e) => handleSelectorChange(e.target.value)}
              placeholder="e.g. .hero h1, button.btn-primary"
              required
              aria-invalid={selectorBlocked}
              className={`${INPUT_CLASS} font-mono`}
            />
            {suggestions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSuggestions((v) => !v)}
                className="shrink-0 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] border border-black/[0.1] rounded-lg text-[#6B6B6B] hover:text-[#111] hover:border-black/[0.2] transition-colors bg-white"
              >
                Suggest
              </button>
            )}
          </div>
          {showSuggestions && (
            <SuggestionsDropdown
              suggestions={suggestions}
              onSelect={(sel) => { handleSelectorChange(sel); setShowSuggestions(false); }}
              onClose={() => setShowSuggestions(false)}
            />
          )}
        </div>
        <p className="text-[11px] text-[#9B9B9B] mt-1.5">
          Targets the element the script modifies at runtime — no code changes needed
        </p>
      </div>

      {/* Change type */}
      <div>
        <span className={SECTION_LABEL}>Change type</span>
        <div className="flex flex-wrap gap-2">
          {CHANGE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.hint}
              onClick={() => setChangeType(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                changeType === opt.value
                  ? "bg-[#111] text-[#FAFAF8]"
                  : "bg-black/[0.04] text-[#6B6B6B] hover:bg-black/[0.07]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#9B9B9B] mt-1.5">
          {CHANGE_TYPE_OPTIONS.find((o) => o.value === changeType)?.hint}
        </p>
      </div>

      {/* CSS system hint — shown when "style" change type is selected */}
      {changeType === "style" && cssSystem && CSS_SYSTEM_HINTS[cssSystem] && (
        <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-sky-700 mb-0.5">
            {CSS_SYSTEM_HINTS[cssSystem]!.label}
          </p>
          <p className="text-xs text-sky-800 leading-relaxed">
            {CSS_SYSTEM_HINTS[cssSystem]!.example}
          </p>
        </div>
      )}

      {/* New value — hidden for "hide" type */}
      {changeType !== "hide" && (
        <div>
          <label className={SECTION_LABEL} htmlFor="new-value">
            {changeType === "copy" ? "Variant copy" : "CSS classes to apply"}
          </label>
          <input
            id="new-value"
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={
              changeType === "copy"
                ? "e.g. Get started — free"
                : "e.g. bg-blue-600 text-white font-bold"
            }
            required
            className={changeType === "style" ? `${INPUT_CLASS} font-mono` : INPUT_CLASS}
          />
          <p className="text-[11px] text-[#9B9B9B] mt-1.5">
            {changeType === "copy"
              ? "The replacement text the script writes into the element"
              : "Space-separated class names added to the element in the variant"}
          </p>
          {/* Copy-quality hints (Zybit-125) — advisory, deterministic, non-blocking */}
          {changeType === "copy" && (() => {
            const hints = copyHints(newValue);
            if (hints.length === 0) return null;
            return (
              <ul className="mt-2 space-y-1">
                {hints.map((h, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-1.5 text-[11px] ${
                      h.level === "warn" ? "text-amber-700" : "text-[#6B6B6B]"
                    }`}
                  >
                    <span className={`mt-1 h-1 w-1 shrink-0 rounded-full ${h.level === "warn" ? "bg-amber-400" : "bg-[#C9C9C9]"}`} />
                    {h.message}
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      )}

      {/* Variant description */}
      <div>
        <label className={SECTION_LABEL} htmlFor="variant-description">
          Variant B description
        </label>
        <textarea
          id="variant-description"
          value={variantDescription}
          onChange={(e) => setVariantDescription(e.target.value)}
          rows={4}
          required
          className={`${INPUT_CLASS} resize-none`}
        />
        <p className="text-[11px] text-[#9B9B9B] mt-1.5">
          Human-readable description for your A/B testing platform
        </p>
      </div>

      {/* Primary metric */}
      <div>
        <label className={SECTION_LABEL} htmlFor="primary-metric">
          Primary metric
        </label>
        <input
          id="primary-metric"
          type="text"
          value={primaryMetric}
          onChange={(e) => setPrimaryMetric(e.target.value)}
          maxLength={200}
          required
          className={INPUT_CLASS}
        />
        <p className="text-[11px] text-[#9B9B9B] mt-1.5">
          What you&apos;ll measure to declare a winner
        </p>
      </div>

      {/* Hypothesis — optional */}
      <div>
        <label className={SECTION_LABEL} htmlFor="hypothesis">
          Hypothesis{" "}
          <span className="normal-case font-normal tracking-normal">(optional)</span>
        </label>
        <textarea
          id="hypothesis"
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          rows={3}
          placeholder="e.g. Reducing emphasis on secondary CTA will increase primary CTA clicks by 15%"
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      {/* Submit */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={saving || selectorBlocked}
          className="bg-[#111] text-[#FAFAF8] px-5 py-2.5 font-bold text-sm uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {saving ? "Saving…" : "Save brief"}
        </button>
        {selectorBlocked && (
          <p className="text-[11px] text-red-600 mt-2">
            {validateResult?.status === 'invalid_selector'
              ? "Selector is malformed — fix it before saving."
              : "Selector matches no element on the snapshot — pick one that does."}
          </p>
        )}
      </div>
    </form>
  );
}

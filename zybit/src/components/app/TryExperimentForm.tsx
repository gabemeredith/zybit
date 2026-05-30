"use client";

/**
 * Client surface for `/app/try` — the "Try one free experiment" funnel
 * (docs/sprints/free-experiment-loop.md §1).
 *
 * Two-step, mirroring the server-action split (render half → persist half):
 *   1. URL + the §4 numbers micro-step → `generateFreeExperimentAction` runs the
 *      silent audit and returns a projected result (no DB write).
 *   2. The PM reviews the projected before/after, then "Save to my cockpit" →
 *      `saveFreeExperimentAction` claims the free slot and persists the preview.
 *
 * SPA / error results pivot to "connect your data" (we don't fake a preview for
 * a page we can't proxy-modify); a used-up gate renders the upgrade moment.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  generateFreeExperimentAction,
  saveFreeExperimentAction,
  type GenerateFreeExperimentResult,
} from "@/app/app/try/actions";

/** Parse a loosely-typed money/count field into a positive number or null. */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

const SECTION_LABEL = "brut-label mb-1";

export default function TryExperimentForm() {
  const [url, setUrl] = useState("");
  const [visitors, setVisitors] = useState("");
  const [revenue, setRevenue] = useState("");
  const [result, setResult] = useState<GenerateFreeExperimentResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || generating) return;
    setSaveError(null);
    startGenerating(async () => {
      const res = await generateFreeExperimentAction(url.trim(), {
        monthlyVisitors: parseNumber(visitors),
        monthlyRevenue: parseNumber(revenue),
      });
      setResult(res);
    });
  }

  function handleSave() {
    if (!result || result.status !== "ok" || saving) return;
    setSaveError(null);
    startSaving(async () => {
      const res = await saveFreeExperimentAction(result.payload);
      // A successful save redirects server-side; we only get here on a branch.
      if (res.status === "blocked") {
        setResult({ status: "blocked" });
      } else if (res.status === "invalid") {
        setSaveError(res.reason);
      }
    });
  }

  function reset() {
    setResult(null);
    setSaveError(null);
  }

  // ---- Projected result (the payoff) -------------------------------------
  if (result?.status === "ok") {
    const { experiment, projection, findingTitle, domain, source } = result;
    return (
      <div className="space-y-4">
        <div className="brut-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="brut-label">Experiment we&apos;d run on you</div>
            <span className="brut-tag text-[#6B6B6B]">{domain}</span>
          </div>

          <div className="space-y-4">
            <div>
              <div className={SECTION_LABEL}>
                {source === "finding" ? "What we found" : "Where to start"}
              </div>
              <p className="text-[#111] leading-relaxed">
                {findingTitle ??
                  "Your page is structurally clean, so we'd start with a sharp copy test."}
              </p>
            </div>
            <div>
              <div className={SECTION_LABEL}>The experiment</div>
              <p className="text-base font-bold text-[#111]">{experiment.experimentName}</p>
              <p className="mt-1 text-[#6B6B6B] leading-relaxed">
                {experiment.variantDescription}
              </p>
            </div>
          </div>
        </div>

        {/* Projected impact — honestly labelled, never a measured result. */}
        <div className="brut-card p-6">
          <div className="brut-label mb-5">Projected impact</div>
          <div className="flex flex-wrap gap-8 mb-5">
            <div>
              <div className={SECTION_LABEL}>Projected lift</div>
              <p className="text-2xl font-black text-[#111]">
                +{projection.liftPctRange.min}–{projection.liftPctRange.max}%
              </p>
            </div>
            {projection.revenueRange && (
              <div>
                <div className={SECTION_LABEL}>Projected revenue / mo</div>
                <p className="text-2xl font-black text-[#111]">
                  {money(projection.revenueRange.min)}–{money(projection.revenueRange.max)}
                </p>
              </div>
            )}
          </div>
          <p className="text-sm text-[#6B6B6B] leading-relaxed">
            <span className="font-bold text-[#111]">Projected — not yet measured.</span>{" "}
            {projection.basisNote}
          </p>
        </div>

        {saveError && (
          <p className="text-sm text-red-600 font-medium">{saveError}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="brut-action"
          >
            {saving ? "Saving…" : "Save to my cockpit"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="brut-action-ghost"
          >
            Try another URL
          </button>
        </div>
      </div>
    );
  }

  // ---- Pivots: SPA / persistent error → "connect your data" --------------
  if (result?.status === "spa" || result?.status === "error") {
    const isSpa = result.status === "spa";
    return (
      <div className="brut-card p-8">
        <div className="brut-label mb-3">Can&apos;t preview this page</div>
        <p className="text-[#111] font-bold text-lg mb-1">
          {isSpa
            ? "This page renders in the browser, so we can't preview a change on it."
            : "We couldn't read that page."}
        </p>
        <p className="text-[#6B6B6B] leading-relaxed mb-6">
          {isSpa
            ? "Client-rendered pages need your analytics connected so we can find friction from real behaviour instead of static HTML."
            : "It may be down, blocking us, or behind a login. Connect your analytics and we'll surface findings from real behaviour."}
        </p>
        <div className="flex items-center gap-3">
          <Link href="/app/onboarding" className="brut-action">
            Connect your data
          </Link>
          <button type="button" onClick={reset} className="brut-action-ghost">
            Try another URL
          </button>
        </div>
      </div>
    );
  }

  // ---- Gate used up mid-flow → upgrade moment ----------------------------
  if (result?.status === "blocked") {
    return (
      <div className="brut-card p-8 text-center">
        <div className="brut-label mb-3">Free experiment used</div>
        <p className="text-[#111] font-bold text-lg mb-1">
          You&apos;ve run your one free experiment.
        </p>
        <p className="text-[#6B6B6B] leading-relaxed mb-6">
          Upgrade to run experiments on real traffic and measure the actual lift.
        </p>
        <Link href="/app/settings" className="brut-action">
          See upgrade options
        </Link>
      </div>
    );
  }

  // ---- The form (initial + invalid-URL) ----------------------------------
  return (
    <form onSubmit={handleGenerate} className="brut-card p-6 space-y-5">
      <div>
        <label htmlFor="try-url" className={SECTION_LABEL}>
          Page URL
        </label>
        <input
          id="try-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourproduct.com/pricing"
          className="brut-input"
          autoComplete="off"
        />
        {result?.status === "invalid" && (
          <p className="mt-1.5 text-sm text-red-600 font-medium">{result.reason}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="try-visitors" className={SECTION_LABEL}>
            Monthly visitors <span className="normal-case opacity-60">(optional)</span>
          </label>
          <input
            id="try-visitors"
            type="text"
            inputMode="numeric"
            value={visitors}
            onChange={(e) => setVisitors(e.target.value)}
            placeholder="25,000"
            className="brut-input"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="try-revenue" className={SECTION_LABEL}>
            Monthly revenue <span className="normal-case opacity-60">(optional)</span>
          </label>
          <input
            id="try-revenue"
            type="text"
            inputMode="numeric"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
            placeholder="$40,000"
            className="brut-input"
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-[#6B6B6B] leading-relaxed">
        Your numbers turn the benchmark lift into a dollar projection. We never
        store them as a measured result — the projection is clearly labelled.
      </p>

      <button type="submit" disabled={generating || !url.trim()} className="brut-action">
        {generating ? "Auditing your page…" : "Generate my free experiment"}
      </button>
    </form>
  );
}

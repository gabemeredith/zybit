"use client";

/**
 * Client surface for `/app/try` — the "Try one free experiment" funnel
 * (docs/sprints/free-experiment-loop.md §1, Option 2: rich render-only preview).
 *
 * Flow: URL + the §4 numbers micro-step → `generateFreeExperimentAction` runs the
 * real audit and returns one rich finding + a before/after fix preview. We render
 * the "why" (EvidencePanel), the before/after as the hero (BeforeAfterSlider), and
 * a projected dollar range — all building to a "Launch on real traffic" button
 * that is the upgrade wall. The projected before/after is the free value; running
 * it on live traffic is the paid unlock.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import EvidencePanel from "@/components/app/EvidencePanel";
import { BeforeAfterSlider } from "@/components/audit/BeforeAfterSlider";
import {
  generateFreeExperimentAction,
  type GenerateFreeExperimentResult,
} from "@/app/app/try/actions";

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
  const [walled, setWalled] = useState(false);
  const [generating, startGenerating] = useTransition();

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || generating) return;
    setWalled(false);
    startGenerating(async () => {
      const res = await generateFreeExperimentAction(url.trim(), {
        monthlyVisitors: parseNumber(visitors),
        monthlyRevenue: parseNumber(revenue),
      });
      setResult(res);
    });
  }

  function reset() {
    setResult(null);
    setWalled(false);
  }

  // ---- The rich preview (the payoff) -------------------------------------
  if (result?.status === "ok") {
    const { finding, beforeUrl, afterUrl, fixRationale, projection, domain } = result;
    return (
      <div className="space-y-5">
        <div className="brut-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="brut-label">An experiment we&apos;d run on you</div>
            <span className="brut-tag text-[#6B6B6B]">{domain}</span>
          </div>
          <h2 className="text-2xl font-black tracking-tighter text-[#111] leading-tight mb-1">
            {finding.title}
          </h2>
          <p className="text-[#6B6B6B] leading-relaxed">{finding.summary}</p>
        </div>

        {/* The why — evidence + prescription + the rule's own impact estimate. */}
        <EvidencePanel
          evidence={finding.evidence}
          recommendation={finding.recommendation}
          prescription={finding.prescription}
          impactEstimate={finding.impactEstimate}
        />

        {/* The hero — the before/after fix rendered on the PM's own page. */}
        {beforeUrl && (
          <div className="brut-card p-6">
            <div className="brut-label mb-3">The fix, rendered on your page</div>
            <BeforeAfterSlider
              beforeUrl={beforeUrl}
              afterUrl={afterUrl}
              rationale={fixRationale}
              badge="Proposed fix"
              alt={`${domain} hero`}
            />
          </div>
        )}

        {/* Projected impact — honestly labelled, from the PM's own numbers. */}
        <div className="brut-card p-6">
          <div className="brut-label mb-4">Projected impact</div>
          <div className="flex flex-wrap gap-8 mb-4">
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
            A benchmark range for this kind of fix
            {projection.revenueRange ? ", applied to the numbers you gave" : ""}. Running it on
            your real traffic is how you measure the actual lift.
          </p>
        </div>

        {/* The wall — the whole preview builds to this. */}
        {walled ? (
          <div className="brut-card p-6 bg-[#111] text-white">
            <div className="brut-label mb-2 text-white/60">Upgrade to launch</div>
            <p className="text-lg font-bold mb-1">This is the paid part — and it&apos;s the point.</p>
            <p className="text-white/70 leading-relaxed mb-5">
              You&apos;ve seen the projected fix. Upgrade to deploy it on your real traffic with
              zero install, measure the actual lift, and run the next one.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/app/settings"
                className="bg-white text-[#111] px-5 py-3 text-xs font-bold uppercase tracking-[0.08em] hover:opacity-80 transition-opacity"
              >
                See upgrade options
              </Link>
              <button
                type="button"
                onClick={reset}
                className="text-white/60 text-xs font-bold uppercase tracking-[0.08em] hover:text-white transition-colors"
              >
                Try another URL
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setWalled(true)} className="brut-action">
              Launch on real traffic →
            </button>
            <button type="button" onClick={reset} className="brut-action-ghost">
              Try another URL
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Clean page — nothing to show --------------------------------------
  if (result?.status === "no_finding") {
    return (
      <div className="brut-card p-8">
        <div className="brut-label mb-3">Nothing obvious to fix</div>
        <p className="text-[#111] font-bold text-lg mb-1">
          {result.domain} looks structurally clean.
        </p>
        <p className="text-[#6B6B6B] leading-relaxed mb-6">
          We couldn&apos;t surface a high-confidence structural fix from the static page. Connect
          your analytics and we&apos;ll find friction from real visitor behaviour instead.
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

  // ---- Couldn't read the page --------------------------------------------
  if (result?.status === "error") {
    return (
      <div className="brut-card p-8">
        <div className="brut-label mb-3">Couldn&apos;t read this page</div>
        <p className="text-[#111] font-bold text-lg mb-1">
          We couldn&apos;t audit that URL.
        </p>
        <p className="text-[#6B6B6B] leading-relaxed mb-6">
          It may be down, behind a login, or blocking automated visits. Try a public page, or
          connect your analytics to surface findings from real behaviour.
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
        Your numbers turn the benchmark lift into a dollar projection. We never store them as a
        measured result — the projection is clearly labelled.
      </p>

      <button type="submit" disabled={generating || !url.trim()} className="brut-action">
        {generating ? "Auditing your page… (~30–60s)" : "Generate my free experiment"}
      </button>
      {generating && (
        <p className="text-xs text-[#6B6B6B] leading-relaxed">
          Crawling the page, running the rule engine, and rendering a before/after of the fix.
          This is the real audit, so it takes a moment.
        </p>
      )}
    </form>
  );
}

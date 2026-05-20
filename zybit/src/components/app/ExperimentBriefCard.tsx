"use client";

import { useState } from "react";
import Link from "next/link";
import { launchExperimentAction } from "@/app/app/findings/[id]/experiment/actions";

interface ExperimentBrief {
  experimentName: string;
  selector: string;
  changeType: "copy" | "style" | "hide";
  newValue: string;
  variantDescription: string;
  primaryMetric: string;
  hypothesis: string | null;
  createdAt: string;
}

const CHANGE_TYPE_LABELS: Record<ExperimentBrief["changeType"], string> = {
  copy: "Change text copy",
  style: "Swap CSS classes",
  hide: "Hide element",
};

function toBriefText(brief: ExperimentBrief): string {
  const lines = [
    `**Experiment: ${brief.experimentName}**`,
    `**Selector:** \`${brief.selector}\``,
    `**Change:** ${CHANGE_TYPE_LABELS[brief.changeType]}`,
  ];
  if (brief.changeType !== "hide" && brief.newValue) {
    const valueLabel = brief.changeType === "copy" ? "Variant copy" : "CSS classes";
    lines.push(`**${valueLabel}:** ${brief.newValue}`);
  }
  lines.push(
    `**Variant B:** ${brief.variantDescription}`,
    `**Primary metric:** ${brief.primaryMetric}`,
    `**Hypothesis:** ${brief.hypothesis ?? "—"}`,
  );
  return lines.join("\n");
}

const SECTION_LABEL = "text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1";

function BriefRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className={SECTION_LABEL}>{label}</div>
      <p className={`text-sm text-[#111] leading-relaxed ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export default function ExperimentBriefCard({
  brief,
  findingId,
}: {
  brief: ExperimentBrief;
  findingId: string;
}) {
  const [copied, setCopied] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [overlaps, setOverlaps] = useState<Array<{ id: string; name: string }> | null>(null);

  function handleCopy() {
    navigator.clipboard.writeText(toBriefText(brief));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleLaunch(acknowledge = false) {
    setLaunching(true);
    try {
      const result = await launchExperimentAction(findingId, acknowledge);
      if (result?.type === "overlap_warning") {
        setOverlaps(result.overlaps);
      }
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-5">
        Experiment brief
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <div className={SECTION_LABEL}>Experiment name</div>
          <p className="text-base font-bold text-[#111]">{brief.experimentName}</p>
        </div>

        <BriefRow label="CSS selector" value={brief.selector} mono />

        <div>
          <div className={SECTION_LABEL}>Change type</div>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-black/[0.04] text-[#6B6B6B]">
            {CHANGE_TYPE_LABELS[brief.changeType]}
          </span>
        </div>

        {brief.changeType !== "hide" && brief.newValue && (
          <BriefRow
            label={brief.changeType === "copy" ? "Variant copy" : "CSS classes"}
            value={brief.newValue}
            mono={brief.changeType === "style"}
          />
        )}

        <BriefRow label="Variant B description" value={brief.variantDescription} />
        <BriefRow label="Primary metric" value={brief.primaryMetric} />

        {brief.hypothesis && (
          <BriefRow label="Hypothesis" value={brief.hypothesis} />
        )}
      </div>

      {/* Overlap warning — shown before the user acknowledges */}
      {overlaps && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-bold text-amber-900 mb-1">
            {overlaps.length === 1
              ? "1 experiment is already running on this site."
              : `${overlaps.length} experiments are already running on this site.`}
          </p>
          <ul className="text-sm text-amber-800 space-y-0.5 mb-3">
            {overlaps.map((o) => (
              <li key={o.id} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                <Link
                  href={`/app/experiments/${o.id}`}
                  className="underline underline-offset-2 hover:text-amber-900 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-700 mb-3">
            Concurrent experiments split traffic and can confound results. Launch only if you
            intentionally want to run them in parallel.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={launching}
              onClick={() => handleLaunch(true)}
              className="bg-amber-800 text-white px-4 py-2 text-sm font-bold uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity rounded"
            >
              {launching ? "Launching…" : "Launch anyway"}
            </button>
            <button
              type="button"
              onClick={() => setOverlaps(null)}
              className="text-sm text-amber-700 hover:text-amber-900 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-black/[0.04]">
        <button
          type="button"
          onClick={handleCopy}
          className={`px-4 py-2 text-sm font-bold uppercase tracking-[0.08em] rounded-lg transition-all border ${
            copied
              ? "text-emerald-600 border-emerald-200 bg-emerald-50"
              : "bg-white border-black/[0.1] text-[#6B6B6B] hover:text-[#111] hover:border-black/[0.2]"
          }`}
        >
          {copied ? "Copied" : "Copy brief"}
        </button>
        <Link
          href={`/app/findings/${findingId}/experiment`}
          className="px-4 py-2 text-sm font-bold uppercase tracking-[0.08em] rounded-lg bg-white border border-black/[0.1] text-[#6B6B6B] hover:text-[#111] hover:border-black/[0.2] transition-all"
        >
          Edit
        </Link>
        {!overlaps && (
          <button
            type="button"
            disabled={launching}
            onClick={() => handleLaunch(false)}
            className="ml-auto bg-[#111] text-[#FAFAF8] px-5 py-2.5 text-sm font-bold uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {launching ? "Launching…" : "Launch experiment"}
          </button>
        )}
      </div>
    </div>
  );
}

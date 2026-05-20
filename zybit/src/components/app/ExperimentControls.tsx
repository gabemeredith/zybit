"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateExperimentStatusAction, recordResultsAction } from "@/app/app/experiments/[id]/actions";

type Status = "draft" | "running" | "completed" | "stopped";

interface DefaultResults {
  controlRate?: number;
  variantRate?: number;
  confidence?: number;
  participants?: number;
}

interface Props {
  experimentId: string;
  currentStatus: Status;
  hasResults: boolean;
  defaultResults: DefaultResults;
}

const INPUT_CLASS =
  "w-full border border-black/[0.1] rounded-lg px-3 py-2 text-sm text-[#111] bg-white focus:outline-none focus:ring-1 focus:ring-black/[0.2] placeholder-[#9B9B9B]";

const SECTION_LABEL = "block text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1.5";

export default function ExperimentControls({
  experimentId,
  currentStatus,
  hasResults,
  defaultResults,
}: Props) {
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<Array<{ id: string; name: string }> | null>(null);
  const [showResultsForm, setShowResultsForm] = useState(!hasResults && currentStatus === "completed");
  const [controlRate, setControlRate] = useState(
    defaultResults.controlRate !== undefined ? (defaultResults.controlRate * 100).toFixed(1) : ""
  );
  const [variantRate, setVariantRate] = useState(
    defaultResults.variantRate !== undefined ? (defaultResults.variantRate * 100).toFixed(1) : ""
  );
  const [confidence, setConfidence] = useState(
    defaultResults.confidence !== undefined ? (defaultResults.confidence * 100).toFixed(0) : ""
  );
  const [participants, setParticipants] = useState(
    defaultResults.participants !== undefined ? String(defaultResults.participants) : ""
  );
  const [savingResults, setSavingResults] = useState(false);
  const router = useRouter();

  async function changeStatus(
    status: "running" | "completed" | "stopped",
    acknowledgeOverlap = false,
  ) {
    setStatusLoading(status);
    try {
      const result = await updateExperimentStatusAction(experimentId, status, acknowledgeOverlap);
      if (result?.type === "overlap_warning") {
        setOverlaps(result.overlaps);
        return;
      }
      if (status === "completed") setShowResultsForm(true);
      router.refresh();
    } finally {
      setStatusLoading(null);
    }
  }

  async function handleSaveResults(e: React.FormEvent) {
    e.preventDefault();
    setSavingResults(true);
    try {
      await recordResultsAction(
        experimentId,
        parseFloat(controlRate) / 100,
        parseFloat(variantRate) / 100,
        parseFloat(confidence) / 100,
        parseInt(participants) || 0,
      );
      setShowResultsForm(false);
      router.refresh();
    } finally {
      setSavingResults(false);
    }
  }

  const isActive = currentStatus === "running";
  const isTerminal = currentStatus === "completed" || currentStatus === "stopped";

  if (isTerminal && !showResultsForm) {
    return hasResults ? null : (
      <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
        <button
          type="button"
          onClick={() => setShowResultsForm(true)}
          className="text-sm font-bold uppercase tracking-[0.08em] text-[#6B6B6B] hover:text-[#111] transition-colors"
        >
          + Record results
        </button>
      </div>
    );
  }

  const isDraft = currentStatus === "draft";

  return (
    <div className="space-y-4">
      {/* Overlap warning — shown when launching (draft or running path) */}
      {overlaps && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
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
              disabled={statusLoading !== null}
              onClick={() => changeStatus("running", true)}
              className="bg-amber-800 text-white px-4 py-2 text-sm font-bold uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity rounded"
            >
              {statusLoading === "running" ? "Launching…" : "Launch anyway"}
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

      {/* Draft launch */}
      {isDraft && !overlaps && (
        <div className="bg-white border border-black/[0.05] rounded-2xl px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1">
              Ready to launch
            </div>
            <p className="text-sm text-[#6B6B6B]">Start serving variant traffic to real visitors.</p>
          </div>
          <button
            type="button"
            onClick={() => changeStatus("running")}
            disabled={statusLoading !== null}
            className="ml-4 shrink-0 bg-[#111] text-[#FAFAF8] px-5 py-2.5 text-sm font-bold uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {statusLoading === "running" ? "Launching…" : "Launch experiment"}
          </button>
        </div>
      )}

      {/* Status controls */}
      {isActive && (
        <div className="bg-white border border-black/[0.05] rounded-2xl px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1">
              Experiment running
            </div>
            <p className="text-sm text-[#6B6B6B]">Stop when you have enough data to declare a winner.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              type="button"
              onClick={() => changeStatus("completed")}
              disabled={statusLoading !== null}
              className="bg-[#111] text-[#FAFAF8] px-4 py-2 text-sm font-bold uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {statusLoading === "completed" ? "…" : "Mark complete"}
            </button>
            <button
              type="button"
              onClick={() => changeStatus("stopped")}
              disabled={statusLoading !== null}
              className="bg-white border border-black/[0.1] text-[#6B6B6B] px-4 py-2 text-sm font-bold uppercase tracking-[0.08em] hover:text-[#111] disabled:opacity-40 rounded-lg transition-colors"
            >
              {statusLoading === "stopped" ? "…" : "Stop"}
            </button>
          </div>
        </div>
      )}

      {/* Results form */}
      {showResultsForm && (
        <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-5">
            Record results
          </div>
          <form onSubmit={handleSaveResults} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={SECTION_LABEL} htmlFor="control-rate">
                  Control rate (%)
                </label>
                <input
                  id="control-rate"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={controlRate}
                  onChange={(e) => setControlRate(e.target.value)}
                  placeholder="e.g. 3.2"
                  required
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={SECTION_LABEL} htmlFor="variant-rate">
                  Variant rate (%)
                </label>
                <input
                  id="variant-rate"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={variantRate}
                  onChange={(e) => setVariantRate(e.target.value)}
                  placeholder="e.g. 4.1"
                  required
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={SECTION_LABEL} htmlFor="confidence">
                  Statistical confidence (%)
                </label>
                <input
                  id="confidence"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={confidence}
                  onChange={(e) => setConfidence(e.target.value)}
                  placeholder="e.g. 95"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={SECTION_LABEL} htmlFor="participants">
                  Participants
                </label>
                <input
                  id="participants"
                  type="number"
                  min="0"
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                  placeholder="e.g. 1240"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={savingResults}
                className="bg-[#111] text-[#FAFAF8] px-5 py-2.5 text-sm font-bold uppercase tracking-[0.08em] hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                {savingResults ? "Saving…" : "Save results"}
              </button>
              <button
                type="button"
                onClick={() => setShowResultsForm(false)}
                className="text-sm text-[#9B9B9B] hover:text-[#111] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

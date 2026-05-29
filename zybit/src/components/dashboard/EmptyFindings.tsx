"use client";

import Link from "next/link";

interface EmptyFindingsProps {
  reason: "no-integration" | "no-events" | "gate-not-met";
  sessionsObserved?: number;
  threshold?: number;
}

export default function EmptyFindings({
  reason,
  sessionsObserved,
  threshold,
}: EmptyFindingsProps) {
  const percent =
    reason === "gate-not-met" && threshold && threshold > 0
      ? Math.min(100, Math.round(((sessionsObserved ?? 0) / threshold) * 100))
      : 0;

  return (
    <div className="sans-text w-full min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-20">
      {reason === "no-integration" && (
        <div className="max-w-[700px] animate-[fadeIn_0.6s_ease-out]">
          <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-[#111] mb-6 leading-[1.1]">
            Connect your<br />analytics.
          </h2>
          <p className="text-lg md:text-xl text-[#6B6B6B] leading-relaxed mb-10 max-w-[500px] mx-auto">
            Zybit requires a data source to build an understanding of your funnel and generate its first prescription.
          </p>
          <Link
            href="/app/onboarding?step=2"
            className="inline-flex items-center justify-center bg-[#111] text-[#FAFAF8] px-8 py-4 rounded-full text-lg font-bold shadow-2xl transition-transform duration-300 hover:scale-105 active:scale-95 group"
          >
            Connect PostHog
            <svg 
              className="w-5 h-5 ml-2 transition-transform duration-300 group-hover:translate-x-1" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor" 
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

      {reason === "no-events" && (
        <div className="max-w-[700px] animate-[fadeIn_0.6s_ease-out]">
          <div className="w-16 h-16 mx-auto mb-8 border-4 border-[#111] border-r-transparent rounded-full animate-spin" />
          <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-[#111] mb-6 leading-[1.1]">
            Waiting for<br />signal.
          </h2>
          <p className="text-lg md:text-xl text-[#6B6B6B] leading-relaxed max-w-[500px] mx-auto">
            Your integration is successfully connected. Events usually begin flowing within a few minutes. This view will update automatically.
          </p>
        </div>
      )}

      {reason === "gate-not-met" && (
        <div className="max-w-[700px] w-full animate-[fadeIn_0.6s_ease-out]">
          <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-[#111] mb-6 leading-[1.1]">
            Accumulating<br />sessions.
          </h2>
          <p className="text-lg md:text-xl text-[#6B6B6B] leading-relaxed mb-16 max-w-[500px] mx-auto">
            We need {(threshold && sessionsObserved !== undefined ? (threshold - sessionsObserved).toLocaleString() : "")} more sessions to reach statistical relevance for your first finding.
          </p>

          <div className="max-w-[400px] mx-auto">
            <div className="flex justify-between items-end mb-4">
              <span className="text-sm font-bold uppercase tracking-[0.1em] text-[#6B6B6B]">
                {sessionsObserved?.toLocaleString() ?? 0} / {threshold?.toLocaleString() ?? "n/a"}
              </span>
              <span className="text-3xl font-bold tracking-tighter text-[#111]">
                {percent}%
              </span>
            </div>
            <div className="relative w-full h-3 bg-black/[0.04] rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-[#111] rounded-full transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

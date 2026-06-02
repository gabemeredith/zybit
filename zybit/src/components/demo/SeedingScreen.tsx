"use client";

import { useEffect, useState } from "react";
import type { SeedStatus } from "@/lib/demo/seed";

const STAGE_LABELS: Record<SeedStatus["stage"], string> = {
  idle: "Warming up the demo",
  "audit-running": "Running the real audit on commitmint.app",
  "overlaying-events": "Streaming 14 days of PostHog data",
  "wiring-proxy": "Wiring the reverse proxy",
  "creating-experiments": "Drafting experiments from the findings",
  done: "Ready",
  failed: "Setup failed",
};

const STAGE_ORDER: SeedStatus["stage"][] = [
  "audit-running",
  "overlaying-events",
  "wiring-proxy",
  "creating-experiments",
  "done",
];

interface Props {
  initialStatus: SeedStatus;
}

export default function SeedingScreen({ initialStatus }: Props) {
  const [status, setStatus] = useState<SeedStatus>(initialStatus);

  useEffect(() => {
    if (status.stage === "done") {
      window.location.replace("/demo");
      return;
    }
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/demo/status");
        const json = (await res.json()) as { status: SeedStatus };
        if (cancelled) return;
        setStatus(json.status);
        if (json.status.stage === "done") {
          window.location.replace("/demo");
        }
      } catch {
        /* keep polling */
      }
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status.stage]);

  const currentIdx = STAGE_ORDER.indexOf(status.stage);

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#111] sans-text flex items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div className="brut-label mb-4 tracking-[0.2em]">Zybit · Demo</div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tighter leading-[0.95] mb-5">
          {status.stage === "failed"
            ? "Demo setup failed"
            : status.stage === "done"
              ? "Ready, opening dashboard"
              : "Preparing your demo"}
        </h1>
        <p className="text-[15px] leading-relaxed text-[#6B6B6B] mb-8">
          {status.stage === "failed" ? (
            <>
              The seed run hit an error:{" "}
              <code className="mono-text text-[#111]">{status.error ?? "unknown"}</code>. Reload to
              retry.
            </>
          ) : (
            <>
              Zybit is running its real audit pipeline on{" "}
              <strong className="text-[#111]">commitmint.app</strong>: crawl, headless capture,
              brand DNA, vision, copy critique, 23 rules. While that runs we&apos;re overlaying a
              14-day PostHog event stream so the dashboard reads live the moment it opens. First
              visit only; subsequent loads are instant.
            </>
          )}
        </p>

        <ol className="brut-card divide-y divide-black/[0.08]">
          {STAGE_ORDER.slice(0, -1).map((stage, i) => {
            const isActive = stage === status.stage;
            const isDone = i < currentIdx;
            return (
              <li
                key={stage}
                className={`flex items-center gap-3 px-5 py-3.5 transition-opacity ${
                  isDone || isActive ? "opacity-100" : "opacity-40"
                }`}
              >
                <span
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border-[1.5px] border-[#111] ${
                    isDone ? "bg-[#111]" : "bg-transparent"
                  }`}
                  aria-hidden
                >
                  {isDone ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M2 5l2 2 4-5"
                        stroke="#FAFAF8"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : isActive ? (
                    <span
                      className="h-2 w-2 bg-[#111]"
                      style={{ animation: "demo-pulse 1.4s ease-in-out infinite" }}
                    />
                  ) : null}
                </span>
                <span className="mono-text text-[12px] uppercase tracking-[0.08em]">
                  {STAGE_LABELS[stage]}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mono-text mt-6 text-[12px] uppercase tracking-[0.08em] text-[#6B6B6B]">
          {status.findingCount > 0
            ? `${status.findingCount} findings captured · ${status.experimentCount} experiments staged`
            : "Audit in progress. Typically 60-120 seconds."}
        </div>
      </div>
      <style>{`@keyframes demo-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }`}</style>
    </div>
  );
}

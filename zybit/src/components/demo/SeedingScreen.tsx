"use client";

import { useEffect, useState } from "react";
import type { SeedStatus } from "@/lib/demo/seed";

const INK = "#111";
const CREAM = "#FAFAF8";
const MUTED = "#6B6B6B";

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
    <div
      style={{
        minHeight: "100vh",
        background: CREAM,
        color: INK,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, Inter, sans-serif",
      }}
    >
      <div style={{ maxWidth: 560, width: "100%" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: MUTED,
            marginBottom: 16,
          }}
        >
          Zybit · Demo
        </div>
        <h1
          style={{
            margin: "0 0 18px",
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          {status.stage === "failed"
            ? "Demo setup failed"
            : status.stage === "done"
              ? "Ready — opening dashboard"
              : "Preparing your demo"}
        </h1>
        <p style={{ margin: "0 0 28px", color: INK, lineHeight: 1.6 }}>
          {status.stage === "failed" ? (
            <>The seed run hit an error: <code>{status.error ?? "unknown"}</code>. Reload to retry.</>
          ) : (
            <>
              Zybit is running its real audit pipeline on{" "}
              <strong>commitmint.app</strong> — crawl, headless capture, brand
              DNA, vision, copy critique, 23 rules. While that runs we&apos;re
              overlaying a 14-day PostHog event stream so the dashboard reads
              live the moment it opens. First visit only; subsequent loads
              are instant.
            </>
          )}
        </p>

        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {STAGE_ORDER.slice(0, -1).map((stage, i) => {
            const isActive = stage === status.stage;
            const isDone = i < currentIdx;
            return (
              <li
                key={stage}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                  opacity: isDone || isActive ? 1 : 0.4,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    border: `1.5px solid ${INK}`,
                    background: isDone ? INK : "transparent",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  {isDone ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M2 5l2 2 4-5"
                        stroke={CREAM}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : isActive ? (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: INK,
                        animation: "demo-pulse 1.4s ease-in-out infinite",
                      }}
                    />
                  ) : null}
                </span>
                <span style={{ fontSize: 14 }}>{STAGE_LABELS[stage]}</span>
              </li>
            );
          })}
        </ol>

        <div
          style={{
            marginTop: 28,
            fontSize: 12,
            color: MUTED,
          }}
        >
          {status.findingCount > 0
            ? `${status.findingCount} findings captured · ${status.experimentCount} experiments staged`
            : "Audit in progress — typically 60–120 seconds."}
        </div>
      </div>
      <style>{`@keyframes demo-pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }`}</style>
    </div>
  );
}

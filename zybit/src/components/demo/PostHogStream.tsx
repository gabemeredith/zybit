"use client";

/**
 * Demo-only live ticker. Animates a small set of pre-seeded counters as
 * if PostHog were streaming events in. The numbers come from the
 * already-seeded `phase1_events` for the demo site — this component
 * just paces their reveal. Renders only when the cockpit knows it's
 * the demo org (`organizationId === DEMO_ORG_ID`).
 */

import { useEffect, useState } from "react";

const INK = "#111";
const MUTED = "#6B6B6B";

interface TickerEvent {
  label: string;
  detail: string;
  ts: number;
}

const SAMPLES: Array<{ label: string; detail: string }> = [
  { label: "pageview", detail: "/pricing — Twitter referral" },
  { label: "click", detail: "/pricing → plan-pro" },
  { label: "rage_click", detail: "/pricing — checkout button" },
  { label: "scroll", detail: "/ — 87% depth" },
  { label: "conversion", detail: "/signup — github OAuth" },
  { label: "pageview", detail: "/ — direct visit" },
  { label: "click", detail: "/ → hero-primary" },
  { label: "experiment_assignment", detail: "variant · /pricing" },
  { label: "click", detail: "/signup → email-submit" },
  { label: "pageview", detail: "/docs — Google referral" },
];

function pluralize(n: number, s: string) {
  return `${n.toLocaleString()} ${s}${n === 1 ? "" : "s"}`;
}

export default function PostHogStream({
  eventCount7d,
  bridgeLabel,
}: {
  eventCount7d: number;
  bridgeLabel: string;
}) {
  const [feed, setFeed] = useState<TickerEvent[]>([]);
  const [perMinute, setPerMinute] = useState(34);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const tick = setInterval(() => {
      const next = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
      setFeed((prev) => [{ ...next, ts: Date.now() }, ...prev].slice(0, 6));
      setPerMinute((m) => Math.max(18, Math.min(62, m + Math.round((Math.random() - 0.5) * 6))));
    }, 1400);
    return () => clearInterval(tick);
  }, [paused]);

  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(0,0,0,0.05)",
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: MUTED,
              marginBottom: 6,
            }}
          >
            Live · PostHog
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: INK }}>
            {pluralize(perMinute, "event")}/min
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {pluralize(eventCount7d, "event")} in the last 7 days · {bridgeLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.1)",
            color: INK,
            padding: "6px 10px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {feed.length === 0 && (
          <li style={{ color: MUTED, fontSize: 12, padding: "8px 0" }}>
            Listening for events…
          </li>
        )}
        {feed.map((e) => (
          <li
            key={`${e.ts}-${e.label}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 0",
              borderTop: "1px solid rgba(0,0,0,0.04)",
              animation: "demo-fade 600ms ease-out",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: badgeColor(e.label),
              }}
            >
              {e.label}
            </span>
            <span style={{ fontSize: 12, color: INK, marginLeft: 12, flex: 1, textAlign: "left", paddingLeft: 12 }}>
              {e.detail}
            </span>
            <span style={{ fontSize: 11, color: MUTED }}>just now</span>
          </li>
        ))}
      </ul>
      <style>{`@keyframes demo-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

function badgeColor(label: string): string {
  switch (label) {
    case "conversion":
      return "#0E6F38";
    case "rage_click":
      return "#B12A2A";
    case "experiment_assignment":
      return "#4A2EAA";
    case "click":
      return "#0B3D8A";
    default:
      return "#6B6B6B";
  }
}

"use client";

/**
 * Demo-only live ticker. Animates a small set of pre-seeded counters as
 * if PostHog were streaming events in. The numbers come from the
 * already-seeded `phase1_events` for the demo site — this component
 * just paces their reveal. Renders only when the cockpit knows it's
 * the demo org (`organizationId === DEMO_ORG_ID`).
 */

import { useEffect, useState } from "react";

interface TickerEvent {
  label: string;
  detail: string;
  ts: number;
}

const SAMPLES: Array<{ label: string; detail: string }> = [
  { label: "pageview", detail: "/pricing (Twitter referral)" },
  { label: "click", detail: "/pricing -> plan-pro" },
  { label: "rage_click", detail: "/pricing checkout button" },
  { label: "scroll", detail: "/ 87% depth" },
  { label: "conversion", detail: "/signup github OAuth" },
  { label: "pageview", detail: "/ direct visit" },
  { label: "click", detail: "/ -> hero-primary" },
  { label: "experiment_assignment", detail: "variant · /pricing" },
  { label: "click", detail: "/signup -> email-submit" },
  { label: "pageview", detail: "/docs (Google referral)" },
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
    <div className="brut-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="brut-label mb-1.5 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 bg-emerald-500 animate-pulse" />
            Live · PostHog
          </div>
          <div className="text-2xl font-bold tracking-tighter text-[#111]">
            {pluralize(perMinute, "event")}/min
          </div>
          <div className="text-xs text-[#6B6B6B] mt-0.5">
            {pluralize(eventCount7d, "event")} in the last 7 days · {bridgeLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="mono-text text-[10px] font-bold uppercase tracking-[0.1em] border-[1.5px] border-[#111] px-2.5 py-1 hover:bg-[#111] hover:text-[#FAFAF8] transition-colors"
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>

      <ul className="m-0 p-0 list-none">
        {feed.length === 0 && (
          <li className="text-[#6B6B6B] text-xs py-2">Listening for events…</li>
        )}
        {feed.map((e) => (
          <li
            key={`${e.ts}-${e.label}`}
            className="flex items-center justify-between py-2 border-t border-black/[0.06]"
            style={{ animation: "demo-fade 600ms ease-out" }}
          >
            <span
              className="mono-text text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{ color: badgeColor(e.label) }}
            >
              {e.label}
            </span>
            <span className="text-xs text-[#111] ml-3 flex-1 text-left pl-3">{e.detail}</span>
            <span className="mono-text text-[10px] text-[#6B6B6B]">just now</span>
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

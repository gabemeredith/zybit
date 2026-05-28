"use client";

import { useEffect, useState } from "react";

interface ScreenshotResponse {
  beforeUrl: string | null;
  afterUrl?: string;
  reason?: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; beforeUrl: string; afterUrl: string }
  | { kind: "unavailable" };

const SECTION_LABEL = "text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-2";

/**
 * Renders the control/variant as styled before/after screenshots (via the
 * Browserless render endpoint) instead of live iframes — so the variant shows
 * correctly even on client-rendered (SPA) pages. First load triggers the
 * render (a few seconds); the endpoint caches the result for later views.
 */
export default function ExperimentScreenshotPreview({
  experimentId,
}: {
  experimentId: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/preview/${experimentId}/screenshots`);
        const data = (await res.json()) as ScreenshotResponse;
        if (cancelled) return;
        if (data.beforeUrl && data.afterUrl) {
          setState({ kind: "ready", beforeUrl: data.beforeUrl, afterUrl: data.afterUrl });
        } else {
          setState({ kind: "unavailable" });
        }
      } catch {
        if (!cancelled) setState({ kind: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <div className={SECTION_LABEL} style={{ marginBottom: 0 }}>
          Preview
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/preview/${experimentId}?bucket=control`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#6B6B6B] hover:text-[#111] transition-colors"
          >
            Open live control ↗
          </a>
          <a
            href={`/api/preview/${experimentId}?bucket=variant`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-[#111] hover:underline underline-offset-2"
          >
            Open live variant ↗
          </a>
        </div>
      </div>
      {state.kind === "loading" && (
        <div className="grid grid-cols-2 gap-3">
          {(["Control", "Variant"] as const).map((label) => (
            <div key={label}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9B9B9B] mb-1.5">
                {label}
              </p>
              <div
                className="rounded-xl border border-black/[0.07] bg-[#F5F5F3] flex items-center justify-center text-xs text-[#9B9B9B]"
                style={{ aspectRatio: "1280 / 900" }}
              >
                Rendering preview…
              </div>
            </div>
          ))}
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["Control", state.beforeUrl],
                ["Variant", state.afterUrl],
              ] as const
            ).map(([label, url]) => (
              <div key={label}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#9B9B9B] mb-1.5">
                  {label}
                </p>
                <div className="rounded-xl overflow-hidden border border-black/[0.07] bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${label} preview`} className="block w-full h-auto" />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#9B9B9B] mt-2">
            Rendered preview of the control and variant. Not live — deploys via the reverse proxy.
          </p>
        </>
      )}

      {state.kind === "unavailable" && (
        <div
          className="rounded-xl border border-black/[0.07] bg-[#F5F5F3] flex items-center justify-center text-xs text-[#9B9B9B]"
          style={{ height: 200 }}
        >
          Preview unavailable for this variant.
        </div>
      )}
    </div>
  );
}

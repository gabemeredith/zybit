"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  findingId: string;
  ruleId: string;
  initialScreenshotUrl: string | null;
  pageName: string;
}

type LoadState =
  | { kind: "generating" }
  | { kind: "ready"; url: string; annotationsCount: number | null }
  | { kind: "fallback"; reason: string };

interface ScreenshotResponse {
  screenshotUrl: string | null;
  capturedAt?: string;
  annotationsCount?: number;
  cached?: boolean;
  reason?: string;
}

const LEGENDS: Record<
  string,
  { label: string; color: string; description: string }[]
> = {
  "hero-hierarchy-inversion": [
    {
      label: "Your design emphasizes this",
      color: "#ef4444",
      description: "The visually-heaviest CTA — the one your styling pulls the eye toward.",
    },
    {
      label: "Your users click this",
      color: "#22c55e",
      description: "The CTA that wins clicks despite being visually quieter.",
    },
  ],
};

export default function AnnotatedFindingPreview({
  findingId,
  ruleId,
  initialScreenshotUrl,
  pageName,
}: Props) {
  const [state, setState] = useState<LoadState>(
    initialScreenshotUrl
      ? { kind: "ready", url: initialScreenshotUrl, annotationsCount: null }
      : { kind: "generating" },
  );
  const [modalOpen, setModalOpen] = useState(false);
  const generationStarted = useRef(false);

  const triggerGenerate = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/findings/${findingId}/screenshot`, {
        method: "POST",
      });
      const data = (await res.json()) as ScreenshotResponse;
      if (data.screenshotUrl) {
        setState({
          kind: "ready",
          url: data.screenshotUrl,
          annotationsCount: data.annotationsCount ?? null,
        });
      } else {
        setState({ kind: "fallback", reason: data.reason ?? "render_failed" });
      }
    } catch (err) {
      setState({
        kind: "fallback",
        reason: err instanceof Error ? err.message : "network_error",
      });
    }
  }, [findingId]);

  useEffect(() => {
    if (initialScreenshotUrl || generationStarted.current) return;
    generationStarted.current = true;
    void triggerGenerate();
  }, [initialScreenshotUrl, triggerGenerate]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const legend = LEGENDS[ruleId];

  return (
    <section className="mt-6 bg-white border border-black/[0.05] rounded-2xl px-6 py-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#111]">Where on {pageName}</h2>
        {state.kind === "ready" && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="text-xs text-[#6B6B6B] hover:text-[#111] transition-colors"
          >
            Open live preview →
          </button>
        )}
      </div>

      <div className="relative rounded-lg overflow-hidden border border-black/[0.05] bg-[#FAFAF8]">
        {state.kind === "generating" && (
          <div className="aspect-[1280/900] w-full flex items-center justify-center text-xs text-[#6B6B6B]">
            Generating preview…
          </div>
        )}
        {state.kind === "ready" && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="block w-full text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.url}
              alt={`Annotated view of ${pageName}`}
              className="block w-full h-auto"
            />
          </button>
        )}
        {state.kind === "fallback" && (
          <div className="aspect-[1280/900] w-full flex flex-col items-center justify-center text-xs text-[#6B6B6B] gap-2">
            <span>Static preview unavailable.</span>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="px-3 py-1 rounded-md border border-black/10 text-[#111] hover:bg-black/[0.03] transition-colors"
            >
              Open live preview
            </button>
          </div>
        )}
      </div>

      {legend &&
        state.kind !== "fallback" &&
        !(state.kind === "ready" && state.annotationsCount === 0) && (
          <ul className="mt-3 space-y-1.5">
            {legend.map((l) => (
              <li key={l.label} className="flex items-start gap-2 text-xs text-[#6B6B6B]">
                <span
                  className="mt-1 inline-block w-3 h-3 rounded-sm border-2 border-dashed flex-shrink-0"
                  style={{ borderColor: l.color }}
                  aria-hidden
                />
                <span>
                  <span className="text-[#111] font-medium">{l.label}.</span> {l.description}
                </span>
              </li>
            ))}
          </ul>
        )}

      {state.kind === "ready" && state.annotationsCount === 0 && (
        <p className="mt-3 text-xs text-[#6B6B6B]">
          Visual preview not available for this finding type.
        </p>
      )}

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setModalOpen(false)}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-black/60"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-black/[0.05]">
              <span className="text-sm font-medium text-[#111]">
                Live preview — {pageName}
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-xs text-[#6B6B6B] hover:text-[#111] transition-colors px-2 py-1"
                aria-label="Close preview"
              >
                Close (Esc)
              </button>
            </div>
            <iframe
              title={`Annotated preview of ${pageName}`}
              src={`/api/dashboard/findings/${findingId}/preview`}
              sandbox=""
              className="flex-1 w-full bg-white"
            />
          </div>
        </div>
      )}
    </section>
  );
}

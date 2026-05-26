"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ANNOTATION_CLICKED_COLOR,
  ANNOTATION_HEAVY_COLOR,
  ANNOTATION_WARN_COLOR,
} from "@/lib/phase2/rules/annotationColors";

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

/**
 * Per-rule "why this is highlighted" framing, rendered as a callout
 * above the colored-swatch legend. Each note states (1) what the
 * highlight marks, (2) what the variant is *not* (a common misread),
 * and (3) what the variant actually is. This is what stops a PM from
 * reading an amber outline as "fix this button" when it's really a
 * contextual anchor pointing at the page-level diagnosis.
 */
const HIGHLIGHT_INTENTS: Record<string, string> = {
  "hero-hierarchy-inversion":
    "The two outlines are your design's pull vs. your users' actual clicks. The variant isn't 'remove the loud CTA' — it's 'restyle the CTA that wins clicks so visual weight matches user intent.'",
  "above-fold-coverage":
    "The outline marks your primary CTA — sitting below the fold. The variant isn't 'change the CTA' — it's 'move it (or its message) above the fold where visitors actually see it.'",
  "rage-click-target":
    "The outline marks the element visitors are rage-clicking — they expect it to be interactive but it isn't. The variant is either to make it actually clickable, or strip the affordance so it stops baiting clicks.",
  "form-abandonment":
    "The outline marks the form visitors start and abandon. The variant usually isn't 'restyle the submit button' — it's 'cut a required field or rephrase the commitment copy that's losing them.'",
  "bounce-on-key-page":
    "Amber marks a contextual anchor, not a broken element. This is the most-prominent thing visitors see before bouncing — the variant rewrites the page's primary message so it earns the click, not redesigning this CTA.",
  "help-seeking-spike":
    "Amber marks a contextual anchor. The outline shows where visitors click 'help' instead of converting — the variant answers their question inline above this, rather than routing them to a help page.",
  "hesitation-pattern":
    "Amber marks a contextual anchor. The outline shows where visitors dwell without clicking — the variant clarifies the value proposition above it so they don't have to deliberate, not restyling the button.",
  "flow-inter-step-dropoff":
    "The outline marks the primary CTA on the step losing the most users. The variant cuts friction in the step (shorten the form, clarify what happens next) — not redesigning the button itself.",
  "return-visit-thrash":
    "Amber marks a contextual anchor, not a broken element. The outline shows the most-prominent thing visitors see when they keep coming back — the variant adds a Quick Answer section or anchor nav above it, not 'fix this button.'",
};

const LEGENDS: Record<
  string,
  { label: string; color: string; description: string }[]
> = {
  "hero-hierarchy-inversion": [
    {
      label: "Your design emphasizes this",
      color: ANNOTATION_HEAVY_COLOR,
      description: "The visually-heaviest CTA — the one your styling pulls the eye toward.",
    },
    {
      label: "Your users click this",
      color: ANNOTATION_CLICKED_COLOR,
      description: "The CTA that wins clicks despite being visually quieter.",
    },
  ],
  "above-fold-coverage": [
    {
      label: "Hidden below the fold",
      color: ANNOTATION_HEAVY_COLOR,
      description: "Your primary CTA — most visitors never scroll far enough to see it.",
    },
  ],
  "rage-click-target": [
    {
      label: "Users are angrily clicking here",
      color: ANNOTATION_HEAVY_COLOR,
      description: "This element looks clickable but doesn't behave like one — repeated rage clicks.",
    },
  ],
  "form-abandonment": [
    {
      label: "Users drop off in this form",
      color: ANNOTATION_HEAVY_COLOR,
      description: "Visitors start but don't finish — usually a required-field or commitment-copy issue.",
    },
  ],
  "bounce-on-key-page": [
    {
      label: "Primary CTA on the bounce page",
      color: ANNOTATION_HEAVY_COLOR,
      description: "Most visitors arrive on this page and leave without clicking — your primary CTA isn't pulling them in.",
    },
  ],
  "help-seeking-spike": [
    {
      label: "Users are asking for help here",
      color: ANNOTATION_WARN_COLOR,
      description: "The help/contact CTA visitors click instead of converting — answer inline above this.",
    },
  ],
  "hesitation-pattern": [
    {
      label: "Users dwell here without clicking",
      color: ANNOTATION_WARN_COLOR,
      description: "Your primary CTA — long active dwell with no follow-up is a value-clarity gap.",
    },
  ],
  "flow-inter-step-dropoff": [
    {
      label: "Users drop out of the flow here",
      color: ANNOTATION_HEAVY_COLOR,
      description: "The primary CTA on the step that loses the most users between flow steps.",
    },
  ],
  "return-visit-thrash": [
    {
      label: "What visitors see when they keep coming back",
      color: ANNOTATION_WARN_COLOR,
      description: "Your primary CTA on the looping page — visitors return because the answer they need isn't here. Add a TL;DR or anchor nav above this.",
    },
  ],
};

/**
 * Rule-specific empty-state copy for findings whose violation isn't
 * anchored to a single DOM element (site-wide signals, JS-error
 * clusters, cohort comparisons, etc.). Falls back to the generic
 * caption when the rule has annotations but they couldn't anchor.
 */
const EMPTY_STATE_CAPTIONS: Record<string, string> = {
  "nav-dispersion":
    "Navigation findings span the whole site — there isn't one page to outline.",
  "error-exposure":
    "JavaScript exception clusters live in code, not in a single page element.",
  "cohort-pain-asymmetry":
    "Cohort-vs-cohort comparisons aren't anchored to a single page element.",
  "mobile-engagement-asymmetry":
    "Mobile/desktop step asymmetry is a site-wide signal — no single element to outline.",
};
const DEFAULT_EMPTY_STATE_CAPTION = "Visual preview not available for this finding type.";

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
  const intent = HIGHLIGHT_INTENTS[ruleId];
  const hasAnnotations =
    state.kind !== "fallback" && !(state.kind === "ready" && state.annotationsCount === 0);

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
              onError={() =>
                setState({ kind: "fallback", reason: "image_load_failed" })
              }
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

      {intent && hasAnnotations && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Why this is highlighted
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#3F2D08]">{intent}</p>
        </div>
      )}

      {legend && hasAnnotations && (
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
          {EMPTY_STATE_CAPTIONS[ruleId] ?? DEFAULT_EMPTY_STATE_CAPTION}
        </p>
      )}

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`finding-preview-modal-title-${findingId}`}
          onClick={() => setModalOpen(false)}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-black/60"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-black/[0.05]">
              <span
                id={`finding-preview-modal-title-${findingId}`}
                className="text-sm font-medium text-[#111]"
              >
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

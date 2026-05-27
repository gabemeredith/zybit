'use client';

/**
 * Drag-to-swipe before/after viewer for the /audit/[id] page.
 *
 * The two screenshots are stacked. The "after" sits on top and is clipped
 * with `clip-path: inset(0 X% 0 0)` driven by a draggable vertical handle.
 * Pointer events go on the wrapper so a single handler covers mouse +
 * touch + stylus without separate touch listeners. Falls back to a plain
 * "before only" image when `afterUrl` is null (tier-3 case).
 *
 * No external deps — keeps the audit page bundle tight (this surface is
 * the lead-magnet conversion page; every kilobyte counts).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';

export interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl?: string | null;
  /** Optional one-liner from the AI advisor — "Replaced 'Click here' with…" */
  rationale?: string | null;
  /** Optional badge text — "AI suggestion", "Variant 1", etc. */
  badge?: string;
  /** alt text seed; default "page" */
  alt?: string;
}

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  rationale,
  badge,
  alt = 'page',
}: BeforeAfterSliderProps): React.JSX.Element {
  // Tier-3 path: no "after" exists, just show the before with a CTA hint.
  if (!afterUrl) {
    return (
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 8,
          }}
        >
          Current state
        </div>
        <img
          src={beforeUrl}
          alt={`${alt} — current state`}
          style={{ display: 'block', width: '100%', height: 'auto', border: `1px solid ${INK}` }}
        />
        <p style={{ margin: '8px 0 0', fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
          Sign up to see the proposed fix rendered side-by-side.
        </p>
      </div>
    );
  }

  return (
    <ActiveSlider
      beforeUrl={beforeUrl}
      afterUrl={afterUrl}
      rationale={rationale ?? null}
      badge={badge ?? null}
      alt={alt}
    />
  );
}

function ActiveSlider({
  beforeUrl,
  afterUrl,
  rationale,
  badge,
  alt,
}: {
  beforeUrl: string;
  afterUrl: string;
  rationale: string | null;
  badge: string | null;
  alt: string;
}): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [splitPct, setSplitPct] = useState(50);
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(0, Math.min(100, raw));
    setSplitPct(clamped);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      updateFromClientX(e.clientX);
    },
    [dragging, updateFromClientX],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setDragging(false);
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    },
    [],
  );

  // Keyboard accessibility — left/right arrows on the focused handle nudge
  // the split. Page Up/Down jump 10%. The whole wrapper is focusable so a
  // keyboard-only user can land on it via Tab.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplitPct((p) => Math.max(0, p - 2));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplitPct((p) => Math.min(100, p + 2));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSplitPct(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSplitPct(100);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setSplitPct((p) => Math.min(100, p + 10));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setSplitPct((p) => Math.max(0, p - 10));
    }
  }, []);

  // Re-center on resize so the handle stays aligned with whatever the
  // current splitPct is. (Pure CSS would keep the percentage; we just
  // recompute on resize to be defensive about subpixel jitter on Safari.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setSplitPct((p) => p);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          Before / After · drag to compare
        </div>
        {badge ? (
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: INK,
              border: `1px solid ${INK}`,
              padding: '2px 8px',
              background: CREAM,
            }}
          >
            {badge}
          </div>
        ) : null}
      </div>

      <div
        ref={wrapperRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(splitPct)}
        aria-label={`Compare ${alt} before and after fix`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1280 / 900',
          background: '#000',
          border: `2px solid ${INK}`,
          overflow: 'hidden',
          touchAction: 'none',
          cursor: dragging ? 'grabbing' : 'ew-resize',
          userSelect: 'none',
        }}
      >
        {/* Before — base layer */}
        <img
          src={beforeUrl}
          alt={`${alt} before fix`}
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top left',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
        {/* After — clipped to the left of the split */}
        <img
          src={afterUrl}
          alt={`${alt} after fix`}
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top left',
            display: 'block',
            pointerEvents: 'none',
            clipPath: `inset(0 ${100 - splitPct}% 0 0)`,
            WebkitClipPath: `inset(0 ${100 - splitPct}% 0 0)`,
          }}
        />
        {/* Corner labels — "BEFORE" right side, "AFTER" left side */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: CREAM,
            background: INK,
            padding: '4px 8px',
            pointerEvents: 'none',
          }}
        >
          After
        </div>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: INK,
            background: CREAM,
            border: `1px solid ${INK}`,
            padding: '3px 7px',
            pointerEvents: 'none',
          }}
        >
          Before
        </div>
        {/* Handle */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${splitPct}%`,
            width: 2,
            background: CREAM,
            boxShadow: `0 0 0 1px ${INK}`,
            transform: 'translateX(-1px)',
            pointerEvents: 'none',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: `${splitPct}%`,
            transform: 'translate(-50%, -50%)',
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: CREAM,
            border: `2px solid ${INK}`,
            boxShadow: `2px 2px 0 ${INK}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: INK,
            fontSize: 14,
            fontWeight: 700,
            pointerEvents: 'none',
          }}
        >
          ⇆
        </div>
      </div>

      {rationale ? (
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 12,
            lineHeight: 1.5,
            color: MUTED,
            fontStyle: 'italic',
          }}
        >
          {rationale}
        </p>
      ) : null}
    </div>
  );
}

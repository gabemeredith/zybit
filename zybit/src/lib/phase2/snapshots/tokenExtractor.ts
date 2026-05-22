/**
 * Zybit-143 — Derive a compact design-token set from the per-element
 * computed styles written by `buildFullDesignSnapshot` (Zybit-142).
 *
 * Tokens are the "design DNA" the AI Variant Advisor (Zybit-144) reads when
 * drafting variant options. Keep the contract pure (no IO, no clock) so the
 * builder can co-write tokens atomically with the full row.
 *
 * Today's measured fields (PR #58):
 *   - cta:<ref>      → { selector, backgroundColor?, color?, boundingBox? }
 *   - heading:hN-<i> → { color?, fontSize?, boundingBox? }
 *
 * Spec-listed tokens not yet derivable (capture/styles.ts does not measure
 * them — additive when extended):
 *   - accentColor   (no border-/outline-color captured)
 *   - fontFamily    (not captured)
 *   - borderRadius  (not captured)
 *   - spacingUnit   (no padding captured)
 *   - ctaVocabulary (text lives on the structural snapshot; the AI prompt
 *                    composes it at request time from `CtaCandidate.text`)
 */

export interface DesignTokens {
  /** Mode of CTA `background-color`. Omitted when no CTA has a bg color. */
  primaryColor?: string;
  /** Mode of heading `color`. Omitted when no heading has a color. */
  secondaryColor?: string;
  /** Sorted unique heading font sizes in px. Omitted when none measured. */
  typeScale?: number[];
}

interface CtaStyle {
  backgroundColor?: string;
  color?: string;
}

interface HeadingStyle {
  color?: string;
  fontSize?: string;
}

/**
 * Returns the most-frequent value, breaking ties by first occurrence.
 * Returns null when the input is empty.
 */
function modeOf(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  values.forEach((v, i) => {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!firstSeen.has(v)) firstSeen.set(v, i);
  });
  let best = values[0];
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (
      c > bestCount ||
      (c === bestCount && (firstSeen.get(v) ?? 0) < (firstSeen.get(best) ?? 0))
    ) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Parse "16px" → 16. Returns null for any non-px or malformed value. */
function parsePx(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract design tokens from the `computedStyles` jsonb written by
 * `buildFullDesignSnapshot`. Returns `null` when nothing usable is present
 * (so the caller can leave `designTokens` null on the row).
 */
export function extractDesignTokens(
  computedStyles: Record<string, unknown> | null | undefined,
): DesignTokens | null {
  if (!computedStyles) return null;

  const ctaBgs: string[] = [];
  const headingColors: string[] = [];
  const fontSizesPx: number[] = [];

  for (const [key, raw] of Object.entries(computedStyles)) {
    if (!raw || typeof raw !== 'object') continue;

    if (key.startsWith('cta:')) {
      const style = raw as CtaStyle;
      if (typeof style.backgroundColor === 'string') ctaBgs.push(style.backgroundColor);
      continue;
    }

    if (key.startsWith('heading:')) {
      const style = raw as HeadingStyle;
      if (typeof style.color === 'string') headingColors.push(style.color);
      const px = parsePx(style.fontSize);
      if (px !== null) fontSizesPx.push(px);
      continue;
    }
  }

  const tokens: DesignTokens = {};
  const primary = modeOf(ctaBgs);
  if (primary) tokens.primaryColor = primary;
  const secondary = modeOf(headingColors);
  if (secondary) tokens.secondaryColor = secondary;
  if (fontSizesPx.length > 0) {
    tokens.typeScale = [...new Set(fontSizesPx)].sort((a, b) => a - b);
  }

  return Object.keys(tokens).length > 0 ? tokens : null;
}

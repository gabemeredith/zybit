import type { CtaCandidate } from './types';

/**
 * Pick a browser-runnable CSS selector for a finding by reading the parser's
 * per-CTA `cssSelector` (computed via the testid → human-id → name → role
 * stability ladder in `cssSelector.ts`).
 *
 * Tries the finding's referenced CTA first; falls back to the highest
 * visual-weight CTA on the same page that has a non-null `cssSelector`.
 * Returns `null` when nothing usable exists — better to leave the field
 * empty than stamp a selector that won't match the live page.
 *
 * Shared between Lighthouse's synthetic experiment generator and the
 * dashboard's Findings → Launch Experiment form so both code paths derive
 * defaults from the same evidence.
 */
export function pickSelectorForFinding(
  ctas: CtaCandidate[],
  findingCtaRef: string | undefined,
): string | null {
  if (findingCtaRef) {
    const matched = ctas.find((c) => c.ref === findingCtaRef);
    if (matched?.cssSelector) return matched.cssSelector;
  }
  const candidates = ctas
    .filter((c) => c.cssSelector !== null)
    .sort((a, b) => b.visualWeight - a.visualWeight);
  return candidates[0]?.cssSelector ?? null;
}

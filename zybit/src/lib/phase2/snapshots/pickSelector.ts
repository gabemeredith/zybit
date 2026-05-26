import type { CtaCandidate, FormCandidate } from './types';

/**
 * Pick a browser-runnable CSS selector for a finding by reading the parser's
 * per-element `cssSelector` (computed via the testid → human-id → name → role
 * stability ladder in `cssSelector.ts`).
 *
 * Resolution order:
 *   1. `refs.ctaRef` against `ctas` — used by every CTA-shaped finding.
 *   2. `refs.formRef` against `forms` — used by form-abandonment, whose refs
 *      stash a `formRef` instead of a `ctaRef`. Without this branch, the
 *      lookup falls through to (3) and returns an unrelated hero CTA.
 *   3. Fallback: the highest visual-weight CTA on the same page that has a
 *      non-null `cssSelector`.
 *
 * Returns `null` when nothing usable exists — better to leave the field
 * empty than stamp a selector that won't match the live page.
 *
 * Shared between Lighthouse's synthetic experiment generator and the
 * dashboard's Findings → Launch Experiment form so both code paths derive
 * defaults from the same evidence.
 */
export function pickSelectorForFinding(
  ctas: CtaCandidate[],
  forms: FormCandidate[],
  refs: { ctaRef?: string; formRef?: string } | null | undefined,
): string | null {
  if (refs?.ctaRef) {
    const matched = ctas.find((c) => c.ref === refs.ctaRef);
    if (matched?.cssSelector) return matched.cssSelector;
  }
  if (refs?.formRef) {
    const matched = forms.find((f) => f.ref === refs.formRef);
    if (matched?.cssSelector) return matched.cssSelector;
  }
  const candidates = ctas
    .filter((c) => c.cssSelector !== null)
    .sort((a, b) => b.visualWeight - a.visualWeight);
  return candidates[0]?.cssSelector ?? null;
}

/**
 * Shared types for the audit before/after fix-preview pipeline.
 *
 * See `generateFixPreviews.ts` for the orchestrator and `auditFixAdvisor.ts`
 * for the bolder-than-production Gemini advisor that proposes the mods.
 */

import type { VariantModification } from '@/lib/experiments/types';

export type FixPreviewTier = 1 | 2 | 3;

/**
 * One generated fix preview, one finding. Stored on `forge_findings`
 * (columns added in migration 0023) and surfaced inline on
 * `public_audits.findings` so the prospect-facing audit page can render
 * the swipe slider without an extra round trip.
 */
export interface FixPreview {
  findingId: string;
  tier: FixPreviewTier;
  beforeUrl: string;
  /** Null for tier 3 (annotated-before-only fallback). */
  afterUrl: string | null;
  /** Populated for tier 1 only; null for tier 2/3. */
  modifications: VariantModification[] | null;
  /** PM-readable one-liner — "Replaced generic 'Click here' with action-led CTA copy." */
  rationale: string | null;
  generatedAt: Date;
}

/**
 * Per-finding outcome the orchestrator returns. A null `preview` means
 * the pipeline failed all three tiers for this finding (e.g. live origin
 * fetch failed AND inpaint env was unset); the caller leaves the existing
 * annotated `screenshotUrl` in place.
 */
export interface FixPreviewOutcome {
  findingId: string;
  preview: FixPreview | null;
  reason: 'ok' | 'no-html' | 'no-mods' | 'render-failed' | 'inpaint-failed' | 'tier3-fallback' | 'rule-skipped';
}

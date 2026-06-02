/**
 * Competitor pass (axis 3) — deterministic delta engine + context block.
 *
 * The differentiated move: snapshot a few competitor pages, run the SAME
 * extraction, and feed the *deltas* as context so findings become positioned
 * ("competitors X and Y show a security badge above the fold; you don't")
 * instead of generic ("add social proof").
 *
 * This file is the deterministic, testable core: pure functions that turn
 * already-captured competitor signals into a delta and a prompt block. It is NOT
 * an LLM call — competitor facts are *evidence/context*, computed by code, never
 * a finding the model invents. (The bounded competitor-URL snapshotting + the
 * pipeline wiring that supplies competitor URLs are the remaining wire-up; see
 * HANDOFF §7b.)
 */

import type { PageSnapshot } from '@/lib/phase2/snapshots/types';

export interface CompetitiveSignals {
  /** 'this site' or the competitor's domain — used verbatim in the prompt block. */
  label: string;
  proofSignals: string[];
  hasAboveFoldCta: boolean;
  hasPricingPage: boolean;
}

export interface CompetitorDelta {
  /** Competitors that show proof signals when the audited site shows none. */
  competitorsWithProof: string[];
  /** Competitors that surface pricing when the audited site does not. */
  competitorsWithPricing: string[];
  /** Competitors with an above-fold CTA when the audited site lacks one. */
  competitorsWithAboveFoldCta: string[];
}

/** Master flag for the competitor-context axis (independent of SiteContext). */
export function isCompetitorContextEnabled(override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  return process.env.LLM_COMPETITOR_CONTEXT_ENABLED === '1';
}

const PRICING_PATH = /\/(pricing|plans|plan)(\/|$)/i;

/** Derive competitor-relevant signals from a site's snapshots. Deterministic. */
export function competitiveSignalsFromSnapshots(
  label: string,
  snapshots: PageSnapshot[],
): CompetitiveSignals {
  const proof = new Set<string>();
  let hasAboveFoldCta = false;
  let hasPricingPage = false;

  for (const snap of snapshots) {
    const d = snap?.data;
    if (!d) continue;

    for (const p of d.copyCritique?.proofSignals ?? []) {
      if (typeof p === 'string' && p.trim()) proof.add(p.trim());
    }
    if (d.visualSignals?.visualPrimaryCta) hasAboveFoldCta = true;
    if ((d.ctas ?? []).some((c) => c.foldGuess === 'above')) hasAboveFoldCta = true;
    if (d.visualSignals?.pageType === 'pricing' || PRICING_PATH.test(snap.pathRef ?? '')) {
      hasPricingPage = true;
    }
  }

  return { label, proofSignals: [...proof], hasAboveFoldCta, hasPricingPage };
}

/**
 * Compute what the competitors have that the audited site lacks. Pure: a
 * competitor only counts toward a delta when IT has the trait and the SITE does
 * not — so we never surface a "gap" the site has already closed.
 */
export function computeCompetitorDeltas(
  site: CompetitiveSignals,
  competitors: CompetitiveSignals[],
): CompetitorDelta {
  const siteHasProof = site.proofSignals.length > 0;
  return {
    competitorsWithProof: siteHasProof
      ? []
      : competitors.filter((c) => c.proofSignals.length > 0).map((c) => c.label),
    competitorsWithPricing: site.hasPricingPage
      ? []
      : competitors.filter((c) => c.hasPricingPage).map((c) => c.label),
    competitorsWithAboveFoldCta: site.hasAboveFoldCta
      ? []
      : competitors.filter((c) => c.hasAboveFoldCta).map((c) => c.label),
  };
}

/** True when there's at least one notable gap worth telling the model about. */
export function hasNotableDelta(d: CompetitorDelta): boolean {
  return (
    d.competitorsWithProof.length > 0 ||
    d.competitorsWithPricing.length > 0 ||
    d.competitorsWithAboveFoldCta.length > 0
  );
}

/**
 * Render the delta as a prompt block for Layer B / advisors. Returns '' when
 * there's no notable gap so callers can unconditionally concatenate (and the
 * flag-off / no-gap path appends nothing — prose stays at baseline).
 */
export function competitorDeltaPromptBlock(d: CompetitorDelta): string {
  if (!hasNotableDelta(d)) return '';
  const lines: string[] = [];
  const join = (labels: string[]) => labels.slice(0, 3).join(', ');
  if (d.competitorsWithProof.length) {
    lines.push(`  ${join(d.competitorsWithProof)} show customer proof (logos / metrics / testimonials); this site shows none.`);
  }
  if (d.competitorsWithPricing.length) {
    lines.push(`  ${join(d.competitorsWithPricing)} surface pricing; this site does not.`);
  }
  if (d.competitorsWithAboveFoldCta.length) {
    lines.push(`  ${join(d.competitorsWithAboveFoldCta)} place a primary CTA above the fold; this site does not.`);
  }
  return [
    'COMPETITOR CONTEXT (observed gaps vs competitors — use to make the finding',
    'positioned and concrete; do NOT invent competitor details beyond these):',
    ...lines,
  ].join('\n');
}

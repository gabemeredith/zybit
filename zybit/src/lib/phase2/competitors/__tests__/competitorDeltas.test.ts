import { describe, it, expect } from 'vitest';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';
import {
  competitiveSignalsFromSnapshots,
  competitorDeltaPromptBlock,
  computeCompetitorDeltas,
  hasNotableDelta,
  isCompetitorContextEnabled,
  type CompetitiveSignals,
} from '../competitorDeltas';

const sig = (label: string, over: Partial<CompetitiveSignals> = {}): CompetitiveSignals => ({
  label,
  proofSignals: [],
  hasAboveFoldCta: false,
  hasPricingPage: false,
  ...over,
});

describe('computeCompetitorDeltas', () => {
  it('flags only gaps the site has NOT closed', () => {
    const site = sig('this site', { proofSignals: ['named customer logo'], hasAboveFoldCta: false, hasPricingPage: false });
    const competitors = [
      sig('a.com', { proofSignals: ['metric'], hasAboveFoldCta: true, hasPricingPage: true }),
      sig('b.com', { proofSignals: [], hasAboveFoldCta: true, hasPricingPage: false }),
    ];
    const d = computeCompetitorDeltas(site, competitors);
    // site already has proof → no proof gap
    expect(d.competitorsWithProof).toEqual([]);
    // site lacks pricing → only a.com surfaces it
    expect(d.competitorsWithPricing).toEqual(['a.com']);
    // site lacks above-fold CTA → both competitors have it
    expect(d.competitorsWithAboveFoldCta).toEqual(['a.com', 'b.com']);
  });

  it('reports no delta when the site matches or beats competitors', () => {
    const site = sig('this site', { proofSignals: ['logo'], hasAboveFoldCta: true, hasPricingPage: true });
    const d = computeCompetitorDeltas(site, [sig('a.com', { hasAboveFoldCta: true })]);
    expect(hasNotableDelta(d)).toBe(false);
    expect(competitorDeltaPromptBlock(d)).toBe('');
  });
});

describe('competitorDeltaPromptBlock', () => {
  it('renders a positioned, capped block', () => {
    const block = competitorDeltaPromptBlock({
      competitorsWithProof: ['a.com', 'b.com', 'c.com', 'd.com'],
      competitorsWithPricing: [],
      competitorsWithAboveFoldCta: ['a.com'],
    });
    expect(block).toContain('COMPETITOR CONTEXT');
    expect(block).toContain('customer proof');
    expect(block).toContain('a.com, b.com, c.com'); // capped at 3
    expect(block).not.toContain('d.com');
    expect(block).toContain('CTA above the fold');
    expect(block).not.toContain('surface pricing'); // empty arm omitted
  });
});

describe('competitiveSignalsFromSnapshots', () => {
  const snap = (pathRef: string, data: Record<string, unknown>): PageSnapshot =>
    ({ pathRef, url: `https://x.com${pathRef}`, data } as unknown as PageSnapshot);

  it('extracts proof / above-fold CTA / pricing presence deterministically', () => {
    const s = competitiveSignalsFromSnapshots('x.com', [
      snap('/', {
        copyCritique: { proofSignals: ['named customer logo'] },
        visualSignals: { visualPrimaryCta: { text: 'Get started' }, pageType: 'home' },
        ctas: [{ foldGuess: 'below' }],
      }),
      snap('/pricing', { ctas: [{ foldGuess: 'above' }] }),
    ]);
    expect(s.proofSignals).toEqual(['named customer logo']);
    expect(s.hasAboveFoldCta).toBe(true); // visualPrimaryCta on home + above-fold cta on pricing
    expect(s.hasPricingPage).toBe(true); // /pricing path
  });

  it('reports no signals for an empty/thin site', () => {
    const s = competitiveSignalsFromSnapshots('y.com', [snap('/', {})]);
    expect(s).toEqual({ label: 'y.com', proofSignals: [], hasAboveFoldCta: false, hasPricingPage: false });
  });
});

describe('isCompetitorContextEnabled', () => {
  it('honors the override then the env flag', () => {
    expect(isCompetitorContextEnabled(true)).toBe(true);
    expect(isCompetitorContextEnabled(false)).toBe(false);
    const prev = process.env.LLM_COMPETITOR_CONTEXT_ENABLED;
    delete process.env.LLM_COMPETITOR_CONTEXT_ENABLED;
    expect(isCompetitorContextEnabled()).toBe(false);
    process.env.LLM_COMPETITOR_CONTEXT_ENABLED = '1';
    expect(isCompetitorContextEnabled()).toBe(true);
    if (prev === undefined) delete process.env.LLM_COMPETITOR_CONTEXT_ENABLED;
    else process.env.LLM_COMPETITOR_CONTEXT_ENABLED = prev;
  });
});

/**
 * Tests for the Layer F AI-copy-critique rule family:
 *   - vague-claim-detected
 *   - proof-missing
 *   - cta-verb-mismatch
 *
 * Each rule is a pure deterministic function over `snapshot.data.copyCritique`
 * (which is produced at capture time by `captureCopyCritique` and validated
 * against a strict schema before the rule reads it). The tests below
 * inject synthetic critique objects directly on the snapshot — no LLM
 * call participates in the test path, mirroring how production cached
 * critique works.
 */

import { describe, it, expect } from 'vitest';
import { vagueClaimDetected } from '../vagueClaimDetected';
import { proofMissing } from '../proofMissing';
import { ctaVerbMismatch } from '../ctaVerbMismatch';
import type { CopyCritique } from '@/lib/audit/captureCopyCritique';
import type { PageType, VisualSignals } from '@/lib/phase2/snapshots/types';
import { makeContext, makeCta, makeSnapshot } from './fixtures';

function makeVisualSignals(
  pageType: PageType,
  overrides: Partial<VisualSignals> = {},
): VisualSignals {
  return {
    visualPrimaryCta: null,
    visualSecondaryCta: null,
    pageType,
    heroBlock: {
      headline: 'Empower your team',
      subheadline: 'Real CRO for product teams',
      firstParagraph: null,
    },
    capturedAt: '2026-05-26T12:00:00Z',
    modelVersion: 'gemini-3.5-flash',
    ...overrides,
  };
}

function makeCritique(overrides: Partial<CopyCritique> = {}): CopyCritique {
  return {
    specificity: 0.7,
    vagueTerms: [],
    suggestedRewrites: [],
    proofSignals: ['named customer logo', 'specific metric'],
    ctaAlignment: { matches: true, suggestedVerbs: [] },
    capturedAt: '2026-05-26T12:00:00Z',
    modelVersion: 'gemini-3.5-flash',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// vague-claim-detected
// ---------------------------------------------------------------------------

describe('vague-claim-detected', () => {
  it('does not fire when copyCritique is missing (capture-time skipped)', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('home');
    // No copyCritique attached.
    const ctx = makeContext([], [snap]);
    expect(vagueClaimDetected.evaluate(ctx)).toEqual([]);
  });

  it('does not fire when specificity is above the 0.4 floor', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('home');
    snap.data.copyCritique = makeCritique({ specificity: 0.6 });
    const ctx = makeContext([], [snap]);
    expect(vagueClaimDetected.evaluate(ctx)).toEqual([]);
  });

  it('fires when specificity is below the 0.4 floor on a landing page', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('landing');
    snap.data.copyCritique = makeCritique({
      specificity: 0.2,
      vagueTerms: ['Empower your team'],
      suggestedRewrites: ['Cut SOC2 audits from 80h to 6h'],
    });
    const ctx = makeContext([], [snap]);
    const findings = vagueClaimDetected.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].pathRef).toBe('/');
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].evidence.some((e) => String(e.value).includes('Cut SOC2'))).toBe(true);
  });

  it('emits info severity above 0.2 (only warn on the lowest scores)', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('home');
    snap.data.copyCritique = makeCritique({ specificity: 0.3 });
    const ctx = makeContext([], [snap]);
    const findings = vagueClaimDetected.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('info');
  });

  it.each(['docs', 'legal', 'support', 'unknown'] as const)(
    'does not fire on suppressed pageType=%s',
    (pageType) => {
      const snap = makeSnapshot('/', []);
      snap.data.visualSignals = makeVisualSignals(pageType);
      snap.data.copyCritique = makeCritique({ specificity: 0.1 });
      const ctx = makeContext([], [snap]);
      expect(vagueClaimDetected.evaluate(ctx)).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// proof-missing
// ---------------------------------------------------------------------------

describe('proof-missing', () => {
  it('does not fire when copyCritique is missing', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('home');
    const ctx = makeContext([], [snap]);
    expect(proofMissing.evaluate(ctx)).toEqual([]);
  });

  it('does not fire when at least one proof signal is identified', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('home');
    snap.data.copyCritique = makeCritique({ proofSignals: ['named customer logo'] });
    const ctx = makeContext([], [snap]);
    expect(proofMissing.evaluate(ctx)).toEqual([]);
  });

  it('fires on a home page with zero proof signals', () => {
    const snap = makeSnapshot('/', []);
    snap.data.visualSignals = makeVisualSignals('home');
    snap.data.copyCritique = makeCritique({ proofSignals: [] });
    const ctx = makeContext([], [snap]);
    const findings = proofMissing.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].pathRef).toBe('/');
  });

  it('fires on a pricing page with warn severity (higher stakes)', () => {
    const snap = makeSnapshot('/pricing', []);
    snap.data.visualSignals = makeVisualSignals('pricing');
    snap.data.copyCritique = makeCritique({ proofSignals: [] });
    const ctx = makeContext([], [snap]);
    const findings = proofMissing.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warn');
  });

  it.each(['docs', 'legal', 'support', 'about', 'signup', 'checkout', 'blog', 'unknown'] as const)(
    'does not fire on non-relevant pageType=%s',
    (pageType) => {
      const snap = makeSnapshot('/', []);
      snap.data.visualSignals = makeVisualSignals(pageType);
      snap.data.copyCritique = makeCritique({ proofSignals: [] });
      const ctx = makeContext([], [snap]);
      expect(proofMissing.evaluate(ctx)).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// cta-verb-mismatch
// ---------------------------------------------------------------------------

describe('cta-verb-mismatch', () => {
  it('does not fire when copyCritique is missing', () => {
    const snap = makeSnapshot('/pricing', [makeCta('Read more', 0.8, 'above')]);
    snap.data.visualSignals = makeVisualSignals('pricing');
    const ctx = makeContext([], [snap]);
    expect(ctaVerbMismatch.evaluate(ctx)).toEqual([]);
  });

  it('does not fire when ctaAlignment is null (no CTA observed)', () => {
    const snap = makeSnapshot('/pricing', [makeCta('Read more', 0.8, 'above')]);
    snap.data.visualSignals = makeVisualSignals('pricing');
    snap.data.copyCritique = makeCritique({ ctaAlignment: null });
    const ctx = makeContext([], [snap]);
    expect(ctaVerbMismatch.evaluate(ctx)).toEqual([]);
  });

  it('does not fire when the CTA aligns', () => {
    const snap = makeSnapshot('/pricing', [makeCta('Get started', 0.8, 'above')]);
    snap.data.visualSignals = makeVisualSignals('pricing');
    snap.data.copyCritique = makeCritique({
      ctaAlignment: { matches: true, suggestedVerbs: [] },
    });
    const ctx = makeContext([], [snap]);
    expect(ctaVerbMismatch.evaluate(ctx)).toEqual([]);
  });

  it('fires when the CTA does not align with the page type', () => {
    const snap = makeSnapshot('/pricing', [makeCta('Read more', 0.8, 'above')]);
    snap.data.visualSignals = makeVisualSignals('pricing');
    snap.data.copyCritique = makeCritique({
      ctaAlignment: { matches: false, suggestedVerbs: ['Start free trial', 'Get started', 'Try now'] },
    });
    const ctx = makeContext([], [snap]);
    const findings = ctaVerbMismatch.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].evidence.some((e) => String(e.value).includes('Start free trial'))).toBe(true);
  });

  it('uses the vision-extracted primary CTA when available', () => {
    // Parser sees an empty CTA (icon-only); vision sees "Get started".
    // Without vision, the rule would skip — the wrong cure for a real
    // mismatch. The fallback ensures the rule reports the right label.
    const snap = makeSnapshot('/pricing', [makeCta('', 0.9, 'above')]);
    snap.data.visualSignals = makeVisualSignals('pricing', {
      visualPrimaryCta: {
        text: 'Read the docs',
        bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
        confidence: 0.9,
      },
    });
    snap.data.copyCritique = makeCritique({
      ctaAlignment: { matches: false, suggestedVerbs: ['Start free trial'] },
    });
    const ctx = makeContext([], [snap]);
    const findings = ctaVerbMismatch.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].evidence.some((e) => e.label === 'Current CTA' && String(e.value) === 'Read the docs')).toBe(true);
  });

  it('does not fire when pageType is unknown (we need a confident classification)', () => {
    const snap = makeSnapshot('/', [makeCta('Read more', 0.8, 'above')]);
    snap.data.visualSignals = makeVisualSignals('unknown');
    snap.data.copyCritique = makeCritique({
      ctaAlignment: { matches: false, suggestedVerbs: ['Start free trial'] },
    });
    const ctx = makeContext([], [snap]);
    expect(ctaVerbMismatch.evaluate(ctx)).toEqual([]);
  });

  it('does not fire when there is no observable CTA text anywhere', () => {
    const snap = makeSnapshot('/pricing', [makeCta('', 0.9, 'above')]);
    snap.data.visualSignals = makeVisualSignals('pricing');
    // No vision primary CTA, no parser CTA text → nothing to quote.
    snap.data.copyCritique = makeCritique({
      ctaAlignment: { matches: false, suggestedVerbs: ['Get started'] },
    });
    const ctx = makeContext([], [snap]);
    expect(ctaVerbMismatch.evaluate(ctx)).toEqual([]);
  });
});

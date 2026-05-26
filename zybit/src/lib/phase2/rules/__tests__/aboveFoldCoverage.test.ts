import { describe, it, expect } from 'vitest';
import { aboveFoldCoverage } from '@/lib/phase2/rules/aboveFoldCoverage';
import {
  makeContext,
  makeCta,
  makeGoalConfig,
  makeLowScrollViews,
  makeHighScrollViews,
  makeSnapshot,
} from './fixtures';

const PATH = '/pricing';

function makeAboveFoldContext(lowCount: number, highCount: number, withSnapshot = true) {
  const events = [
    ...makeLowScrollViews(PATH, lowCount),
    ...makeHighScrollViews(PATH, highCount),
  ];
  const cta = makeCta('Get started', 0.85, 'below');
  const snapshot = makeSnapshot(
    PATH,
    [cta],
    [{ level: 1, text: 'Pricing plans' }],
  );
  return makeContext(events, withSnapshot ? [snapshot] : []);
}

describe('aboveFoldCoverage rule', () => {
  it('below threshold → returns []', () => {
    // Only 10 pageviews, needs 30
    const ctx = makeAboveFoldContext(8, 2);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  it('all high scroll, no below-fold issue → returns []', () => {
    // 60 pageviews all high scroll → belowFoldShare = 0, not > 0.5
    const ctx = makeAboveFoldContext(0, 60);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  it('no snapshot → returns []', () => {
    const ctx = makeAboveFoldContext(40, 10, false);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  it('above threshold with majority low-scroll → returns finding', () => {
    // 40 low-scroll, 10 high-scroll → belowFoldShare = 0.8 > 0.5
    const ctx = makeAboveFoldContext(40, 10);
    const findings = aboveFoldCoverage.evaluate(ctx);
    expect(findings).toHaveLength(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeAboveFoldContext(40, 10);
    const [f] = aboveFoldCoverage.evaluate(ctx);
    expect(f.ruleId).toBe('above-fold-coverage');
    expect(f.category).toBe('fold');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeAboveFoldContext(40, 10);
    const [f] = aboveFoldCoverage.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate is present with goalConfig', () => {
    const config = makeGoalConfig('revenue');
    const ctx = makeAboveFoldContext(40, 10);
    const ctxWithConfig = makeContext(ctx.events, ctx.pageSnapshots, config);
    const [f] = aboveFoldCoverage.evaluate(ctxWithConfig);
    expect(f.impactEstimate).toBeDefined();
    expect(f.impactEstimate!.unit).toBe('conversions');
    expect(f.impactEstimate!.value).toBeGreaterThan(0);
  });

  it('snapshotDiagram is present with type=page-structure, has items and foldAfterIndex', () => {
    const ctx = makeAboveFoldContext(40, 10);
    const [f] = aboveFoldCoverage.evaluate(ctx);
    expect(f.snapshotDiagram).toBeDefined();
    expect(f.snapshotDiagram!.type).toBe('page-structure');
    expect(Array.isArray(f.snapshotDiagram!.items)).toBe(true);
    expect(f.snapshotDiagram!.items!.length).toBeGreaterThan(0);
    expect(typeof f.snapshotDiagram!.foldAfterIndex).toBe('number');
  });

  it('finding id includes ruleId', () => {
    const ctx = makeAboveFoldContext(40, 10);
    const [f] = aboveFoldCoverage.evaluate(ctx);
    expect(f.id).toContain('above-fold-coverage');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeAboveFoldContext(40, 10);
    const [f] = aboveFoldCoverage.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('severity is critical when belowFoldShare > 0.7', () => {
    // 35 low, 5 high → 87.5% low scroll → critical
    const ctx = makeAboveFoldContext(35, 5);
    const [f] = aboveFoldCoverage.evaluate(ctx);
    expect(f.severity).toBe('critical');
  });

  it('low weight CTA (< 0.4) → no finding even with low scroll', () => {
    const events = [
      ...makeLowScrollViews(PATH, 40),
      ...makeHighScrollViews(PATH, 10),
    ];
    const cta = makeCta('Low weight', 0.3, 'below');
    const snapshot = makeSnapshot(PATH, [cta]);
    const ctx = makeContext(events, [snapshot]);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  it('CTA above fold → no finding', () => {
    const events = [
      ...makeLowScrollViews(PATH, 40),
      ...makeHighScrollViews(PATH, 10),
    ];
    const cta = makeCta('Sign up', 0.9, 'above');
    const snapshot = makeSnapshot(PATH, [cta]);
    const ctx = makeContext(events, [snapshot]);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'above-fold-coverage:/pricing',
        ruleId: 'above-fold-coverage',
        category: 'fold' as const,
        severity: 'warn' as const,
        confidence: 0.6,
        priorityScore: 0.6,
        pathRef: PATH,
        title: 't',
        summary: 's',
        recommendation: [],
        evidence: [],
        refs,
      };
    }

    it('returns one red outline mod when the CTA resolves to a stable selector', () => {
      const cta = { ...makeCta('Get started', 0.85, 'below', 'cta-x'), cssSelector: 'button.get-started' };
      const out = aboveFoldCoverage.proposeAnnotations!(
        makeFinding({ ctaRef: 'cta-x' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'button.get-started' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
    });

    it('returns [] when ctaRef present but the CTA has no cssSelector', () => {
      const cta = makeCta('Get started', 0.85, 'below', 'cta-x');
      expect(cta.cssSelector).toBeNull();
      const out = aboveFoldCoverage.proposeAnnotations!(
        makeFinding({ ctaRef: 'cta-x' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.ctaRef is absent', () => {
      const cta = { ...makeCta('Get started', 0.85, 'below', 'cta-x'), cssSelector: 'button.x' };
      const out = aboveFoldCoverage.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

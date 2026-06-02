import { describe, it, expect } from 'vitest';
import { helpSeekingSpike } from '@/lib/phase2/rules/helpSeekingSpike';
import { makeContext, makeCta, makeCtaClick, makeGoalConfig, makeSnapshot } from './fixtures';

/**
 * helpSeekingSpike needs:
 * - baseline > 0 (some help clicks on non-help pages)
 * - ≥200 site CTA clicks on non-help pages
 * - One page with ≥50 CTA clicks and local help rate ≥2× baseline AND ≥5%
 */
function makeHelpSpikeContext(
  focusPageHelpClicks: number,
  focusPageNonHelpClicks: number,
  siteWideHelpClicks: number,
  siteWideNonHelpClicks: number,
) {
  const events: ReturnType<typeof makeCtaClick>[] = [];

  // Focus page: /pricing
  for (let i = 0; i < focusPageHelpClicks; i++) {
    events.push(makeCtaClick('/pricing', 'Help', `focus-${i}`));
  }
  for (let i = 0; i < focusPageNonHelpClicks; i++) {
    events.push(makeCtaClick('/pricing', 'Get started', `focus-nh-${i}`));
  }

  // Site-wide background
  for (let i = 0; i < siteWideHelpClicks; i++) {
    events.push(makeCtaClick('/features', 'contact us', `site-h-${i}`));
  }
  for (let i = 0; i < siteWideNonHelpClicks; i++) {
    events.push(makeCtaClick('/features', 'Buy now', `site-nh-${i}`));
  }

  return makeContext(events);
}

describe('helpSeekingSpike rule', () => {
  it('no baseline (0 help clicks) → returns []', () => {
    const events = Array.from({ length: 300 }, (_, i) =>
      makeCtaClick('/pricing', 'Buy now', `s-${i}`),
    );
    const ctx = makeContext(events);
    expect(helpSeekingSpike.evaluate(ctx)).toEqual([]);
  });

  it('insufficient site CTA clicks (< 200) → returns []', () => {
    // Only 100 total non-help-page CTA clicks
    const ctx = makeHelpSpikeContext(10, 40, 5, 45); // total = 100
    expect(helpSeekingSpike.evaluate(ctx)).toEqual([]);
  });

  it('page has < 50 CTA clicks → returns []', () => {
    // focus page only has 30 clicks, rest are site-wide
    const ctx = makeHelpSpikeContext(5, 25, 20, 180); // focus = 30, site = 200
    expect(helpSeekingSpike.evaluate(ctx)).toEqual([]);
  });

  it('local help rate < baseline * 2 → returns []', () => {
    // Equal help rates site-wide and on page → no spike
    // 200 total non-help clicks, 10 help on features, 10 help on pricing (= same rate)
    const ctx = makeHelpSpikeContext(10, 90, 10, 90); // rates equal
    expect(helpSeekingSpike.evaluate(ctx)).toEqual([]);
  });

  it('high help-seeking spike → returns finding', () => {
    // /pricing: 40 help / 60 total = 67% local rate
    // site: 5 help / 150 non-help-page = ~3.3% baseline
    // 67% >> 2× 3.3% and > 5%
    const ctx = makeHelpSpikeContext(40, 20, 5, 145);
    const findings = helpSeekingSpike.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeHelpSpikeContext(40, 20, 5, 145);
    const findings = helpSeekingSpike.evaluate(ctx);
    if (findings.length > 0) {
      expect(findings[0].ruleId).toBe('help-seeking-spike');
      expect(findings[0].category).toBe('help');
    }
  });

  it('prescription present', () => {
    const ctx = makeHelpSpikeContext(40, 20, 5, 145);
    for (const f of helpSeekingSpike.evaluate(ctx)) {
      expect(f.prescription).toBeDefined();
      expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
      expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
      expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
    }
  });

  it('impactEstimate present with goalConfig', () => {
    const events: ReturnType<typeof makeCtaClick>[] = [
      ...Array.from({ length: 40 }, (_, i) => makeCtaClick('/pricing', 'Help', `h-${i}`)),
      ...Array.from({ length: 20 }, (_, i) => makeCtaClick('/pricing', 'Buy now', `nh-${i}`)),
      ...Array.from({ length: 5 }, (_, i) => makeCtaClick('/features', 'contact', `sh-${i}`)),
      ...Array.from({ length: 145 }, (_, i) => makeCtaClick('/features', 'Get started', `s-${i}`)),
    ];
    const config = makeGoalConfig('growth');
    const ctx = makeContext(events, [], config);
    for (const f of helpSeekingSpike.evaluate(ctx)) {
      expect(f.impactEstimate).toBeDefined();
      expect(f.impactEstimate!.unit).toBe('signups');
    }
  });

  it('evidence is non-empty', () => {
    const ctx = makeHelpSpikeContext(40, 20, 5, 145);
    for (const f of helpSeekingSpike.evaluate(ctx)) {
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  });

  it('finding id includes ruleId', () => {
    const ctx = makeHelpSpikeContext(40, 20, 5, 145);
    for (const f of helpSeekingSpike.evaluate(ctx)) {
      expect(f.id).toContain('help-seeking-spike');
    }
  });

  describe('proposeAnnotations', () => {
    const PATH = '/pricing';
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'help-seeking-spike:_pricing',
        ruleId: 'help-seeking-spike',
        category: 'help' as const,
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

    it('inserts a "Missing: FAQ" placeholder immediately above the primary CTA (amber)', () => {
      const cta = { ...makeCta('Talk to us', 0.4, 'above', 'help-cta'), cssSelector: 'a.help' };
      const out = helpSeekingSpike.proposeAnnotations!(
        makeFinding({ ctaRef: 'help-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ type: 'element-insert', position: 'before', selector: 'a.help' });
      expect(out[1]).toMatchObject({ type: 'css-inject', selector: '.zybit-anno-help' });
      if (out[1].type === 'css-inject') expect(out[1].css).toContain('#f59e0b');
    });

    it('returns [] when ctaRef present but the CTA has no cssSelector', () => {
      const cta = makeCta('Talk to us', 0.4, 'above', 'help-cta');
      const out = helpSeekingSpike.proposeAnnotations!(
        makeFinding({ ctaRef: 'help-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.ctaRef is absent (no snapshot match)', () => {
      const cta = { ...makeCta('Talk to us', 0.4, 'above', 'help-cta'), cssSelector: 'a.help' };
      const out = helpSeekingSpike.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

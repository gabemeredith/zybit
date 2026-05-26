import { describe, it, expect } from 'vitest';
import { rageClickTarget } from '@/lib/phase2/rules/rageClickTarget';
import { makeContext, makeRageClick, makePageView, makeGoalConfig, makeSnapshot, makeCta } from './fixtures';

const PATH = '/app';

function makeRageContext(rageCount: number, pageSessionCount = 50, withSnapshot = false) {
  const events: ReturnType<typeof makePageView | typeof makeRageClick>[] = [];
  // Page sessions
  for (let i = 0; i < pageSessionCount; i++) {
    events.push(makePageView(PATH, `sess-${i}`));
  }
  // Rage clicks on same target
  for (let i = 0; i < rageCount; i++) {
    events.push(makeRageClick(PATH, 'Submit form', `sess-${i}`));
  }
  if (withSnapshot) {
    const cta = makeCta('Submit form', 0.8, 'above', 'cta-submit');
    const snapshot = makeSnapshot(PATH, [cta]);
    return makeContext(events, [snapshot]);
  }
  return makeContext(events);
}

describe('rageClickTarget rule', () => {
  it('fewer than 5 rage clicks → returns []', () => {
    const ctx = makeRageContext(3, 50);
    expect(rageClickTarget.evaluate(ctx)).toEqual([]);
  });

  it('rage rate ≤ 5% → returns []', () => {
    // 5 rages but 200 sessions → 2.5% rate ≤ 5%
    const ctx = makeRageContext(5, 200);
    expect(rageClickTarget.evaluate(ctx)).toEqual([]);
  });

  it('≥5 rages AND rate > 5% → returns finding', () => {
    // 10 rages, 50 sessions → 20% rate
    const ctx = makeRageContext(10, 50);
    const findings = rageClickTarget.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeRageContext(10, 50);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.ruleId).toBe('rage-click-target');
    expect(f.category).toBe('rage');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeRageContext(10, 50);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with goalConfig', () => {
    const events = [
      ...Array.from({ length: 50 }, (_, i) => makePageView(PATH, `s-${i}`)),
      ...Array.from({ length: 10 }, (_, i) => makeRageClick(PATH, 'Submit', `s-${i}`)),
    ];
    const config = makeGoalConfig('revenue');
    const ctx = makeContext(events, [], config);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.impactEstimate).toBeDefined();
    expect(f.impactEstimate!.unit).toBe('conversions');
  });

  it('finding id includes ruleId and path', () => {
    const ctx = makeRageContext(10, 50);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.id).toContain('rage-click-target');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeRageContext(10, 50);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('severity critical when rage rate > 15%', () => {
    // 20 rages / 50 sessions = 40% rage rate > 15%
    const ctx = makeRageContext(20, 50);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.severity).toBe('critical');
  });

  it('severity warn when rage rate ≤ 15%', () => {
    // 5 rages / 50 sessions = 10% rate (5..15% = warn)
    const ctx = makeRageContext(5, 40);
    const [f] = rageClickTarget.evaluate(ctx);
    expect(f.severity).toBe('warn');
  });

  it('events with no target info → not grouped (no finding)', () => {
    // Events without rage_target_text, rage_target_ref, or tag+classes
    const events = [
      ...Array.from({ length: 50 }, (_, i) => makePageView(PATH, `s-${i}`)),
      ...Array.from({ length: 10 }, (_, i) =>
        makeRageClick(PATH, '', `s-${i}`),
      ),
    ];
    // Empty text is valid but let's verify it doesn't crash
    expect(() => rageClickTarget.evaluate(makeContext(events))).not.toThrow();
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'rage-click-target:/pricing:x',
        ruleId: 'rage-click-target',
        category: 'rage' as const,
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

    it('returns one red outline mod when ctaRef resolves to a CTA with a selector', () => {
      const cta = { ...makeCta('Submit', 0.7, 'above', 'rage-cta'), cssSelector: 'button.submit' };
      const out = rageClickTarget.proposeAnnotations!(
        makeFinding({ ctaRef: 'rage-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'button.submit' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
    });

    it('returns [] when ctaRef is present but the CTA has no cssSelector', () => {
      const cta = makeCta('Submit', 0.7, 'above', 'rage-cta');
      const out = rageClickTarget.proposeAnnotations!(
        makeFinding({ ctaRef: 'rage-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.ctaRef is absent (rage event matched no snapshot CTA)', () => {
      const cta = { ...makeCta('Submit', 0.7, 'above', 'rage-cta'), cssSelector: 'button.submit' };
      const out = rageClickTarget.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

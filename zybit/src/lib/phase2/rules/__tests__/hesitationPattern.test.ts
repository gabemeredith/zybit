import { describe, it, expect } from 'vitest';
import { hesitationPattern } from '@/lib/phase2/rules/hesitationPattern';
import { makeContext, makeCta, makeEvent, makeGoalConfig, makeSnapshot } from './fixtures';

const PATH = '/pricing';

/**
 * Build an event that looks like a long-dwell page_view (activeSeconds >= 45)
 * with no follow-up CTA click, so the session "hesitates".
 */
function makeLongDwellAndBack(sessionId: string, path = PATH): ReturnType<typeof makeEvent>[] {
  const t0 = '2026-01-15T12:00:00Z';
  const t1 = '2026-01-15T12:01:00Z'; // next event
  return [
    // First visit
    makeEvent({
      type: 'page_view',
      path: '/home',
      sessionId,
      occurredAt: '2026-01-15T11:58:00Z',
      metrics: { activeSeconds: 10 },
    }),
    // Long dwell on path
    makeEvent({
      type: 'page_view',
      path,
      sessionId,
      occurredAt: t0,
      metrics: { activeSeconds: 60 },
    }),
    // Back navigation to already-visited path
    makeEvent({
      type: 'page_view',
      path: '/home',
      sessionId,
      occurredAt: t1,
    }),
  ];
}

function makeHesitationContext(hesitateCount: number, normalCount: number) {
  const events: ReturnType<typeof makeEvent>[] = [];
  for (let i = 0; i < hesitateCount; i++) {
    events.push(...makeLongDwellAndBack(`hesitate-${i}`));
  }
  // Normal sessions: long dwell but followed by CTA click → don't count
  for (let i = 0; i < normalCount; i++) {
    const sid = `normal-${i}`;
    events.push(
      makeEvent({ type: 'page_view', path: PATH, sessionId: sid, metrics: { activeSeconds: 60 }, occurredAt: '2026-01-15T12:00:00Z' }),
      makeEvent({ type: 'cta_click', path: PATH, sessionId: sid, occurredAt: '2026-01-15T12:01:00Z' }),
    );
  }
  return makeContext(events);
}

describe('hesitationPattern rule', () => {
  it('fewer than 30 hesitation sessions → returns []', () => {
    const ctx = makeHesitationContext(10, 5);
    expect(hesitationPattern.evaluate(ctx)).toEqual([]);
  });

  it('long dwell followed by CTA click → not counted as hesitation', () => {
    // 0 actual hesitations → []
    const ctx = makeHesitationContext(0, 40);
    expect(hesitationPattern.evaluate(ctx)).toEqual([]);
  });

  it('≥30 hesitation sessions → returns finding', () => {
    const ctx = makeHesitationContext(35, 5);
    const findings = hesitationPattern.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeHesitationContext(35, 5);
    const [f] = hesitationPattern.evaluate(ctx);
    expect(f.ruleId).toBe('hesitation-pattern');
    expect(f.category).toBe('hesitation');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeHesitationContext(35, 5);
    const [f] = hesitationPattern.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with goalConfig', () => {
    const events: ReturnType<typeof makeEvent>[] = [];
    for (let i = 0; i < 35; i++) events.push(...makeLongDwellAndBack(`h-${i}`));
    const config = makeGoalConfig('engagement');
    const ctx = makeContext(events, [], config);
    const [f] = hesitationPattern.evaluate(ctx);
    expect(f.impactEstimate).toBeDefined();
    expect(f.impactEstimate!.unit).toBe('sessions');
  });

  it('finding id includes ruleId', () => {
    const ctx = makeHesitationContext(35, 5);
    const [f] = hesitationPattern.evaluate(ctx);
    expect(f.id).toContain('hesitation-pattern');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeHesitationContext(35, 5);
    const [f] = hesitationPattern.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('severity is valid', () => {
    const ctx = makeHesitationContext(35, 5);
    const [f] = hesitationPattern.evaluate(ctx);
    expect(['critical', 'warn', 'info']).toContain(f.severity);
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'hesitation-pattern:_pricing',
        ruleId: 'hesitation-pattern',
        category: 'hesitation' as const,
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

    it('returns one amber outline mod when the primary CTA has a selector', () => {
      const cta = { ...makeCta('Choose plan', 0.85, 'above', 'plan-cta'), cssSelector: 'button.plan' };
      const out = hesitationPattern.proposeAnnotations!(
        makeFinding({ ctaRef: 'plan-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'button.plan' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#f59e0b');
    });

    it('returns [] when ctaRef present but the CTA has no cssSelector', () => {
      const cta = makeCta('Choose plan', 0.85, 'above', 'plan-cta');
      const out = hesitationPattern.proposeAnnotations!(
        makeFinding({ ctaRef: 'plan-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.ctaRef is absent', () => {
      const cta = { ...makeCta('Choose plan', 0.85, 'above', 'plan-cta'), cssSelector: 'button.plan' };
      const out = hesitationPattern.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

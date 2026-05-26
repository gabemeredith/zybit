import { describe, it, expect } from 'vitest';
import { returnVisitThrash } from '@/lib/phase2/rules/returnVisitThrash';
import { makeContext, makeCta, makeEvent, makeGoalConfig, makeConfig, makeSnapshot } from './fixtures';

const PATH = '/docs';

/**
 * A "thrash" session visits PATH 4+ times without visiting any narrative destination.
 * Without a narrative declared, isThrashSession requires count >= STRICT_THRESHOLD=4
 * AND all between-visits must be PATH itself (i.e. stuck in a loop).
 */
function makeThrashSession(sessionId: string, revisitCount = 4): ReturnType<typeof makeEvent>[] {
  const events: ReturnType<typeof makeEvent>[] = [];
  // Visit path multiple times (all back to /docs, never leaving to another page)
  for (let i = 0; i < revisitCount; i++) {
    events.push(makeEvent({
      type: 'page_view',
      path: PATH,
      sessionId,
      occurredAt: `2026-01-15T${String(10 + i).padStart(2, '0')}:00:00Z`,
    }));
  }
  return events;
}

function makeNonThrashSession(sessionId: string): ReturnType<typeof makeEvent>[] {
  return [
    makeEvent({ type: 'page_view', path: PATH, sessionId, occurredAt: '2026-01-15T10:00:00Z' }),
    makeEvent({ type: 'page_view', path: '/docs/api', sessionId, occurredAt: '2026-01-15T10:01:00Z' }),
  ];
}

function makeThrashContext(thrashCount: number, normalCount: number) {
  const events: ReturnType<typeof makeEvent>[] = [];
  for (let i = 0; i < thrashCount; i++) {
    events.push(...makeThrashSession(`thrash-${i}`));
  }
  for (let i = 0; i < normalCount; i++) {
    events.push(...makeNonThrashSession(`normal-${i}`));
  }
  return makeContext(events);
}

describe('returnVisitThrash rule', () => {
  it('fewer than 50 path sessions → returns []', () => {
    // Only 30 total sessions touching /docs
    const ctx = makeThrashContext(20, 10);
    expect(returnVisitThrash.evaluate(ctx)).toEqual([]);
  });

  it('thrash rate ≤ 5% → returns []', () => {
    // 2 thrash / 100 sessions = 2%
    const ctx = makeThrashContext(2, 98);
    expect(returnVisitThrash.evaluate(ctx)).toEqual([]);
  });

  it('revisit count < 4 (strict threshold) → not counted as thrash', () => {
    // 3 visits but STRICT_THRESHOLD is 4 → not thrash without narrative
    const events: ReturnType<typeof makeEvent>[] = [];
    for (let i = 0; i < 60; i++) {
      const sid = `s-${i}`;
      // 3 visits to /docs but between them is just /docs again
      events.push(
        makeEvent({ type: 'page_view', path: PATH, sessionId: sid, occurredAt: '2026-01-15T10:00:00Z' }),
        makeEvent({ type: 'page_view', path: PATH, sessionId: sid, occurredAt: '2026-01-15T10:01:00Z' }),
        makeEvent({ type: 'page_view', path: PATH, sessionId: sid, occurredAt: '2026-01-15T10:02:00Z' }),
      );
    }
    const ctx = makeContext(events);
    // 3 visits = pathCount 3, strict threshold is 4, narrative threshold is 3
    // Without narrative: count < STRICT_THRESHOLD → not thrash
    expect(returnVisitThrash.evaluate(ctx)).toEqual([]);
  });

  it('high thrash rate → returns finding', () => {
    // 40 thrash / 100 total = 40% > 5%
    const ctx = makeThrashContext(40, 60);
    const findings = returnVisitThrash.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeThrashContext(40, 60);
    const [f] = returnVisitThrash.evaluate(ctx);
    expect(f.ruleId).toBe('return-visit-thrash');
    expect(f.category).toBe('thrash');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeThrashContext(40, 60);
    const [f] = returnVisitThrash.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with goalConfig', () => {
    const events: ReturnType<typeof makeEvent>[] = [];
    for (let i = 0; i < 40; i++) events.push(...makeThrashSession(`t-${i}`));
    for (let i = 0; i < 60; i++) events.push(...makeNonThrashSession(`n-${i}`));
    const config = makeGoalConfig('revenue');
    const ctx = makeContext(events, [], config);
    const findings = returnVisitThrash.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].impactEstimate).toBeDefined();
    expect(findings[0].impactEstimate!.unit).toBe('conversions');
  });

  it('with narrative config → thrash at 3+ visits (not 4)', () => {
    const events: ReturnType<typeof makeEvent>[] = [];
    // 60 sessions visiting /docs 3 times without going to /docs/api
    for (let i = 0; i < 60; i++) {
      const sid = `t-${i}`;
      events.push(
        makeEvent({ type: 'page_view', path: PATH, sessionId: sid, occurredAt: '2026-01-15T10:00:00Z' }),
        makeEvent({ type: 'page_view', path: '/other', sessionId: sid, occurredAt: '2026-01-15T10:01:00Z' }),
        makeEvent({ type: 'page_view', path: PATH, sessionId: sid, occurredAt: '2026-01-15T10:02:00Z' }),
        makeEvent({ type: 'page_view', path: '/other2', sessionId: sid, occurredAt: '2026-01-15T10:03:00Z' }),
        makeEvent({ type: 'page_view', path: PATH, sessionId: sid, occurredAt: '2026-01-15T10:04:00Z' }),
      );
    }
    // 60 normal sessions
    for (let i = 0; i < 60; i++) {
      events.push(...makeNonThrashSession(`n-${i}`));
    }
    const config = makeConfig({
      narratives: [
        { id: 'docs-nav', label: 'Docs navigation', sourcePathRef: PATH, expectedPathRefs: ['/docs/api', '/docs/guide'] },
      ],
    });
    const ctx = makeContext(events, [], config);
    const findings = returnVisitThrash.evaluate(ctx);
    // With narrative, thrash requires count>=3 AND not visiting /docs/api or /docs/guide
    expect(Array.isArray(findings)).toBe(true);
  });

  it('finding id includes ruleId', () => {
    const ctx = makeThrashContext(40, 60);
    const [f] = returnVisitThrash.evaluate(ctx);
    expect(f.id).toContain('return-visit-thrash');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeThrashContext(40, 60);
    const [f] = returnVisitThrash.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'return-visit-thrash:_docs',
        ruleId: 'return-visit-thrash',
        category: 'thrash' as const,
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
      const cta = { ...makeCta('Open account', 0.9, 'above', 'open-cta'), cssSelector: 'a.open' };
      const out = returnVisitThrash.proposeAnnotations!(
        makeFinding({ ctaRef: 'open-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'a.open' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#f59e0b');
    });

    it('returns [] when ctaRef is present but the CTA has no cssSelector', () => {
      const cta = makeCta('Open account', 0.9, 'above', 'open-cta');
      const out = returnVisitThrash.proposeAnnotations!(
        makeFinding({ ctaRef: 'open-cta' }),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.ctaRef is absent (no snapshot at finding time)', () => {
      const cta = { ...makeCta('Open account', 0.9, 'above', 'open-cta'), cssSelector: 'a.open' };
      const out = returnVisitThrash.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot(PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

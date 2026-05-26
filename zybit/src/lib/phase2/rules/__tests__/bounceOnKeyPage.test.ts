import { describe, it, expect } from 'vitest';
import { bounceOnKeyPage } from '@/lib/phase2/rules/bounceOnKeyPage';
import {
  makeContext,
  makePageView,
  makeGoalConfig,
  makeConfig,
  makeSnapshot,
  makeCta,
} from './fixtures';

const KEY_PATH = '/pricing';

/**
 * Build sessions that all bounce on KEY_PATH (single path, ≤3 events, no cta_click).
 */
function makeBounceSession(i: number) {
  return makePageView(KEY_PATH, `bounce-session-${i}`, {
    deviceType: 'desktop',
    referrer: 'https://google.com',
  });
}

function makeNonBounceSession(i: number) {
  // Multi-path = not a bounce
  const sid = `non-bounce-session-${i}`;
  return [
    makePageView(KEY_PATH, sid),
    makePageView('/dashboard', sid),
  ];
}

function makeBounceContext(bounceCount: number, nonBounceCount: number) {
  const events: ReturnType<typeof makePageView>[] = [];
  for (let i = 0; i < bounceCount; i++) events.push(makeBounceSession(i));
  for (let i = 0; i < nonBounceCount; i++) events.push(...makeNonBounceSession(i));

  const cta = makeCta('Start free trial', 0.8, 'above');
  const snapshot = makeSnapshot(KEY_PATH, [cta]);

  // Make KEY_PATH a key path via onboardingSteps
  const config = makeConfig({
    onboardingSteps: [
      {
        id: 'step-1',
        label: 'Pricing',
        match: { kind: 'path-prefix', prefix: '/pricing' },
        order: 1,
      },
    ],
  });

  return makeContext(events, [snapshot], config);
}

describe('bounceOnKeyPage rule', () => {
  it('below threshold (< 100 entries) → returns []', () => {
    const ctx = makeBounceContext(50, 20); // only 70 sessions
    expect(bounceOnKeyPage.evaluate(ctx)).toEqual([]);
  });

  it('bounce rate ≤ 50% → returns []', () => {
    // 100 bounces out of 300 = 33%
    const ctx = makeBounceContext(100, 200);
    expect(bounceOnKeyPage.evaluate(ctx)).toEqual([]);
  });

  it('non-key page → returns []', () => {
    // Only page_view events on /about — not in onboarding config
    const events = Array.from({ length: 150 }, (_, i) =>
      makePageView('/about', `session-${i}`),
    );
    const ctx = makeContext(events);
    expect(bounceOnKeyPage.evaluate(ctx)).toEqual([]);
  });

  it('above threshold with high bounce rate → returns finding', () => {
    // 150 bounces / 160 total = ~94% bounce
    const ctx = makeBounceContext(150, 10);
    const findings = bounceOnKeyPage.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeBounceContext(150, 10);
    const [f] = bounceOnKeyPage.evaluate(ctx);
    expect(f.ruleId).toBe('bounce-on-key-page');
    expect(f.category).toBe('bounce');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeBounceContext(150, 10);
    const [f] = bounceOnKeyPage.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with revenue config', () => {
    const bounceEvents = Array.from({ length: 150 }, (_, i) =>
      makePageView(KEY_PATH, `bounce-${i}`),
    );
    const nonBounceEvents = Array.from({ length: 10 }, (_, i) => [
      makePageView(KEY_PATH, `nb-${i}`),
      makePageView('/dashboard', `nb-${i}`),
    ]).flat();

    const cta = makeCta('Start free trial', 0.8, 'above');
    const snapshot = makeSnapshot(KEY_PATH, [cta]);
    const config = makeGoalConfig('revenue');
    // Add key path via ctas config
    config.ctas = [
      {
        pageRef: KEY_PATH,
        ctaId: 'cta-1',
        label: 'Start free trial',
        visualWeight: 0.8,
        match: { kind: 'event-type', type: 'cta_click' },
      },
    ];
    const ctx = makeContext([...bounceEvents, ...nonBounceEvents], [snapshot], config);
    const findings = bounceOnKeyPage.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].impactEstimate).toBeDefined();
    expect(findings[0].impactEstimate!.unit).toBe('conversions');
  });

  it('finding id includes ruleId', () => {
    const ctx = makeBounceContext(150, 10);
    const [f] = bounceOnKeyPage.evaluate(ctx);
    expect(f.id).toContain('bounce-on-key-page');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeBounceContext(150, 10);
    const [f] = bounceOnKeyPage.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'bounce-on-key-page:_pricing',
        ruleId: 'bounce-on-key-page',
        category: 'bounce' as const,
        severity: 'warn' as const,
        confidence: 0.6,
        priorityScore: 0.6,
        pathRef: KEY_PATH,
        title: 't',
        summary: 's',
        recommendation: [],
        evidence: [],
        refs,
      };
    }

    it('outlines the first heading + captions it "Rewrite to answer referrer question" (red)', () => {
      const cta = { ...makeCta('Get started', 0.9, 'above', 'primary'), cssSelector: 'a.cta' };
      const out = bounceOnKeyPage.proposeAnnotations!(
        makeFinding({ ctaRef: 'primary' }),
        { snapshot: makeSnapshot(KEY_PATH, [cta], [{ level: 1, text: 'Pricing' }]), designTokens: null },
      );
      expect(out).toHaveLength(3);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'h1:nth-of-type(1)' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
      expect(out[1]).toMatchObject({ type: 'element-insert', position: 'after', selector: 'h1:nth-of-type(1)' });
      expect(out[2]).toMatchObject({ type: 'css-inject', selector: '.zybit-anno-bounce' });
    });

    it('returns [] when the page has no headings (rare — nothing to anchor to)', () => {
      const cta = { ...makeCta('Get started', 0.9, 'above', 'primary'), cssSelector: 'a.cta' };
      const out = bounceOnKeyPage.proposeAnnotations!(
        makeFinding({ ctaRef: 'primary' }),
        { snapshot: makeSnapshot(KEY_PATH, [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

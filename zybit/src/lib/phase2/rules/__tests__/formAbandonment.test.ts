import { describe, it, expect } from 'vitest';
import { formAbandonment } from '@/lib/phase2/rules/formAbandonment';
import {
  makeContext,
  makePageView,
  makeFormSubmit,
  makeGoalConfig,
  makeSnapshot,
  makeForm,
  makeCta,
} from './fixtures';

const PATH = '/signup';

function makeFormAbandonContext(
  viewCount: number,
  submitCount: number,
  withSnapshot = true,
) {
  const events: ReturnType<typeof makePageView | typeof makeFormSubmit>[] = [];

  // viewCount distinct sessions view the form
  for (let i = 0; i < viewCount; i++) {
    events.push(makePageView(PATH, `viewer-session-${i}`));
  }
  // submitCount of them also submit
  for (let i = 0; i < submitCount; i++) {
    events.push(makeFormSubmit(PATH, `viewer-session-${i}`));
  }

  const form = makeForm('form-signup', [
    { name: 'email', required: true, labelText: 'Email address' },
    { name: 'password', required: true, labelText: 'Password' },
    { name: 'company', required: false, labelText: 'Company' },
  ]);
  const cta = makeCta('Sign up', 0.9, 'above');
  const snapshot = makeSnapshot(PATH, [cta], [], [form]);

  return makeContext(events, withSnapshot ? [snapshot] : []);
}

describe('formAbandonment rule', () => {
  it('no snapshots → returns []', () => {
    const ctx = makeFormAbandonContext(150, 50, false);
    expect(formAbandonment.evaluate(ctx)).toEqual([]);
  });

  it('below minimum form views (< 100) → returns []', () => {
    const ctx = makeFormAbandonContext(50, 10);
    expect(formAbandonment.evaluate(ctx)).toEqual([]);
  });

  it('submit rate ≥ 50% → returns []', () => {
    // 150 views, 80 submits → 53% submit rate → no finding
    const ctx = makeFormAbandonContext(150, 80);
    expect(formAbandonment.evaluate(ctx)).toEqual([]);
  });

  it('above threshold with high abandonment → returns finding', () => {
    // 150 views, 20 submits → 87% abandonment
    const ctx = makeFormAbandonContext(150, 20);
    const findings = formAbandonment.evaluate(ctx);
    expect(findings).toHaveLength(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeFormAbandonContext(150, 20);
    const [f] = formAbandonment.evaluate(ctx);
    expect(f.ruleId).toBe('form-abandonment');
    expect(f.category).toBe('abandonment');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeFormAbandonContext(150, 20);
    const [f] = formAbandonment.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with goalConfig', () => {
    const events: ReturnType<typeof makePageView | typeof makeFormSubmit>[] = [];
    for (let i = 0; i < 150; i++) events.push(makePageView(PATH, `viewer-${i}`));
    for (let i = 0; i < 20; i++) events.push(makeFormSubmit(PATH, `viewer-${i}`));

    const form = makeForm('form-signup', [
      { name: 'email', required: true },
      { name: 'name', required: true },
    ]);
    const snapshot = makeSnapshot(PATH, [makeCta('Sign up', 0.9, 'above')], [], [form]);
    const config = makeGoalConfig('growth');
    const ctx = makeContext(events, [snapshot], config);

    const findings = formAbandonment.evaluate(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].impactEstimate).toBeDefined();
    expect(findings[0].impactEstimate!.unit).toBe('signups');
  });

  it('snapshotDiagram is present with type=form-funnel and funnelSteps', () => {
    const ctx = makeFormAbandonContext(150, 20);
    const [f] = formAbandonment.evaluate(ctx);
    expect(f.snapshotDiagram).toBeDefined();
    expect(f.snapshotDiagram!.type).toBe('form-funnel');
    expect(Array.isArray(f.snapshotDiagram!.funnelSteps)).toBe(true);
    expect(f.snapshotDiagram!.funnelSteps!.length).toBeGreaterThanOrEqual(2);
  });

  it('finding id includes ruleId', () => {
    const ctx = makeFormAbandonContext(150, 20);
    const [f] = formAbandonment.evaluate(ctx);
    expect(f.id).toContain('form-abandonment');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeFormAbandonContext(150, 20);
    const [f] = formAbandonment.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('form with < 2 fields → returns []', () => {
    const events = Array.from({ length: 150 }, (_, i) => makePageView(PATH, `s-${i}`));
    const singleFieldForm = makeForm('form-1', [
      { name: 'email', required: true },
    ]);
    const snapshot = makeSnapshot(PATH, [], [], [singleFieldForm]);
    const ctx = makeContext(events, [snapshot]);
    expect(formAbandonment.evaluate(ctx)).toEqual([]);
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { formRef?: string }) {
      return {
        id: 'form-abandonment:/signup:f',
        ruleId: 'form-abandonment',
        category: 'abandonment' as const,
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

    it('outlines the form (red) + captions it with the shorten/move-fields prescription', () => {
      const form = { ...makeForm('signup-form', [{ name: 'email', required: true }, { name: 'pw', required: true }]), cssSelector: 'form#signup' };
      const out = formAbandonment.proposeAnnotations!(
        makeFinding({ formRef: 'signup-form' }),
        { snapshot: makeSnapshot(PATH, [], [], [form]), designTokens: null },
      );
      expect(out).toHaveLength(3);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'form#signup' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
      expect(out[1]).toMatchObject({ type: 'element-insert', position: 'before', selector: 'form#signup' });
      expect(out[2]).toMatchObject({ type: 'css-inject', selector: '.zybit-anno-abandon' });
    });

    it('returns [] when formRef present but the form has no cssSelector', () => {
      const form = makeForm('signup-form', [{ name: 'email', required: true }, { name: 'pw', required: true }]);
      expect(form.cssSelector).toBeNull();
      const out = formAbandonment.proposeAnnotations!(
        makeFinding({ formRef: 'signup-form' }),
        { snapshot: makeSnapshot(PATH, [], [], [form]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.formRef is absent', () => {
      const form = { ...makeForm('signup-form', [{ name: 'email', required: true }]), cssSelector: 'form#signup' };
      const out = formAbandonment.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot(PATH, [], [], [form]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

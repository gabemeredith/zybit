import { describe, it, expect } from 'vitest';
import { errorExposure } from '@/lib/phase2/rules/errorExposure';
import { makeContext, makeErrorEvent, makePageView, makeGoalConfig } from './fixtures';

const PATH = '/checkout';

function makeErrorContext(errorCount: number, pageSessionCount = 50) {
  const events: ReturnType<typeof makePageView | typeof makeErrorEvent>[] = [];
  // Add page sessions
  for (let i = 0; i < pageSessionCount; i++) {
    events.push(makePageView(PATH, `sess-${i}`));
  }
  // Add errors
  for (let i = 0; i < errorCount; i++) {
    events.push(
      makeErrorEvent(PATH, 'TypeError', 'Cannot read property of undefined', `sess-${i}`),
    );
  }
  return makeContext(events);
}

describe('errorExposure rule', () => {
  it('fewer than 5 errors of same type → returns []', () => {
    const ctx = makeErrorContext(3);
    expect(errorExposure.evaluate(ctx)).toEqual([]);
  });

  it('5+ errors of same type → returns finding', () => {
    const ctx = makeErrorContext(10);
    const findings = errorExposure.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeErrorContext(10);
    const [f] = errorExposure.evaluate(ctx);
    expect(f.ruleId).toBe('error-exposure');
    expect(f.category).toBe('error');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeErrorContext(10);
    const [f] = errorExposure.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with goalConfig', () => {
    const events = [
      ...Array.from({ length: 50 }, (_, i) => makePageView(PATH, `s-${i}`)),
      ...Array.from({ length: 10 }, (_, i) =>
        makeErrorEvent(PATH, 'TypeError', 'undefined is not a function', `s-${i}`),
      ),
    ];
    const config = makeGoalConfig('revenue');
    const ctx = makeContext(events, [], config);
    const [f] = errorExposure.evaluate(ctx);
    expect(f.impactEstimate).toBeDefined();
    expect(f.impactEstimate!.unit).toBe('conversions');
  });

  it('finding id includes ruleId', () => {
    const ctx = makeErrorContext(10);
    const [f] = errorExposure.evaluate(ctx);
    expect(f.id).toContain('error-exposure');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeErrorContext(10);
    const [f] = errorExposure.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('multiple distinct error types → multiple findings', () => {
    const events = [
      ...Array.from({ length: 50 }, (_, i) => makePageView(PATH, `s-${i}`)),
      ...Array.from({ length: 6 }, (_, i) =>
        makeErrorEvent(PATH, 'TypeError', 'Cannot read property', `s-${i}`),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeErrorEvent(PATH, 'ReferenceError', 'x is not defined', `s-${i + 6}`),
      ),
    ];
    const ctx = makeContext(events);
    const findings = errorExposure.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it('unhandled error → severity critical', () => {
    const events = [
      ...Array.from({ length: 50 }, (_, i) => makePageView(PATH, `s-${i}`)),
      ...Array.from({ length: 10 }, (_, i) =>
        makeErrorEvent(PATH, 'TypeError', 'null ref', `s-${i}`, { handled: false }),
      ),
    ];
    const ctx = makeContext(events);
    const [f] = errorExposure.evaluate(ctx);
    expect(f.severity).toBe('critical');
  });

  it('severity is valid', () => {
    const ctx = makeErrorContext(10);
    const [f] = errorExposure.evaluate(ctx);
    expect(['critical', 'warn', 'info']).toContain(f.severity);
  });
});

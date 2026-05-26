import { describe, expect, it } from 'vitest';
import { minimumSampleSizePerArm } from '@/lib/experiments/stats';
import type { CtaCandidate, FormCandidate } from '@/lib/phase2/snapshots/types';
import { pickSelectorForFinding } from '@/lib/phase2/snapshots/pickSelector';
import { sizeExperimentArms } from './syntheticExperiment';

function makeCta(overrides: Partial<CtaCandidate> = {}): CtaCandidate {
  return {
    ref: `cta-${Math.random().toString(36).slice(2, 8)}`,
    cssSelector: null,
    tag: 'a',
    text: 'Click me',
    href: '/x',
    ariaLabel: null,
    landmark: 'main',
    visualWeight: 0.5,
    visualWeightSignals: [],
    foldGuess: 'above',
    domDepth: 3,
    documentIndex: 0,
    disabled: false,
    ...overrides,
  };
}

function makeForm(overrides: Partial<FormCandidate> = {}): FormCandidate {
  const base: FormCandidate = {
    ref: `form-${Math.random().toString(36).slice(2, 8)}`,
    cssSelector: null,
    landmark: 'main',
    fieldCount: 3,
    inputs: [],
    documentIndex: 0,
    hasSubmitButton: true,
  };
  return { ...base, ...overrides };
}

describe('sizeExperimentArms', () => {
  it('always exceeds the sequential-guard sample floor', () => {
    for (const baseRate of [0.1, 0.25, 0.4, 0.5, 0.6, 0.8]) {
      const arms = sizeExperimentArms(baseRate);
      expect(arms).toBeGreaterThan(minimumSampleSizePerArm(baseRate));
    }
  });

  it('returns a positive integer', () => {
    const arms = sizeExperimentArms(0.5);
    expect(Number.isInteger(arms)).toBe(true);
    expect(arms).toBeGreaterThan(0);
  });

  it('clears the floor even when the observed control rate drifts by a few points', () => {
    // compute-outcomes recomputes the floor from the observed control rate,
    // which carries sampling noise. Our arm size (computed at the target
    // base rate) must still clear the floor across a realistic noise band.
    const target = 0.5;
    const arms = sizeExperimentArms(target);
    for (const observed of [0.45, 0.475, 0.5, 0.525, 0.55]) {
      expect(arms).toBeGreaterThan(minimumSampleSizePerArm(observed));
    }
  });
});

describe('pickSelectorForFinding', () => {
  it('prefers the CTA the finding references when it has a selector', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: '[data-testid="hero"]', visualWeight: 0.9 }),
      makeCta({ ref: 'b', cssSelector: '[data-testid="footer"]', visualWeight: 0.3 }),
    ];
    expect(pickSelectorForFinding(ctas, [], { ctaRef: 'b' })).toBe('[data-testid="footer"]');
  });

  it('falls back to the highest-visualWeight CTA when the referenced one has no selector', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: null, visualWeight: 0.9 }),
      makeCta({ ref: 'b', cssSelector: '[data-testid="hero"]', visualWeight: 0.8 }),
      makeCta({ ref: 'c', cssSelector: '[data-testid="footer"]', visualWeight: 0.3 }),
    ];
    expect(pickSelectorForFinding(ctas, [], { ctaRef: 'a' })).toBe('[data-testid="hero"]');
  });

  it('falls back when the finding has no ctaRef at all', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: null, visualWeight: 0.9 }),
      makeCta({ ref: 'b', cssSelector: '[data-testid="signup-cta"]', visualWeight: 0.7 }),
    ];
    expect(pickSelectorForFinding(ctas, [], null)).toBe('[data-testid="signup-cta"]');
  });

  it('returns null when no CTA on the page has a parser-emitted selector', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: null }),
      makeCta({ ref: 'b', cssSelector: null }),
    ];
    expect(pickSelectorForFinding(ctas, [], { ctaRef: 'a' })).toBeNull();
    expect(pickSelectorForFinding(ctas, [], null)).toBeNull();
  });

  it('returns null on an empty CTA + empty forms list', () => {
    expect(pickSelectorForFinding([], [], null)).toBeNull();
  });

  // Regression: form-abandonment findings stash `formRef`, not `ctaRef`.
  // Before the fix, the lookup fell through to the highest-weight CTA on
  // the page — silently swapping the form's submit context for an
  // unrelated hero CTA.
  it('resolves formRef against forms when ctaRef is absent', () => {
    const ctas = [makeCta({ ref: 'hero', cssSelector: '[data-testid="hero-cta"]', visualWeight: 0.9 })];
    const forms = [makeForm({ ref: 'signup', cssSelector: '[data-testid="signup-form"]' })];
    expect(pickSelectorForFinding(ctas, forms, { formRef: 'signup' })).toBe(
      '[data-testid="signup-form"]',
    );
  });

  it('falls back to the highest-weight CTA when formRef does not resolve to a stable form selector', () => {
    const ctas = [makeCta({ ref: 'hero', cssSelector: '[data-testid="hero-cta"]', visualWeight: 0.9 })];
    const forms = [makeForm({ ref: 'signup', cssSelector: null })];
    expect(pickSelectorForFinding(ctas, forms, { formRef: 'signup' })).toBe(
      '[data-testid="hero-cta"]',
    );
  });

  it('prefers ctaRef over formRef when both are present', () => {
    const ctas = [makeCta({ ref: 'a', cssSelector: '[data-testid="cta"]' })];
    const forms = [makeForm({ ref: 'f', cssSelector: '[data-testid="form"]' })];
    expect(pickSelectorForFinding(ctas, forms, { ctaRef: 'a', formRef: 'f' })).toBe(
      '[data-testid="cta"]',
    );
  });
});

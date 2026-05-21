import { describe, expect, it } from 'vitest';
import { minimumSampleSizePerArm } from '@/lib/experiments/stats';
import type { CtaCandidate } from '@/lib/phase2/snapshots/types';
import { pickSelectorForFinding, sizeExperimentArms } from './syntheticExperiment';

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
    expect(pickSelectorForFinding(ctas, 'b')).toBe('[data-testid="footer"]');
  });

  it('falls back to the highest-visualWeight CTA when the referenced one has no selector', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: null, visualWeight: 0.9 }),
      makeCta({ ref: 'b', cssSelector: '[data-testid="hero"]', visualWeight: 0.8 }),
      makeCta({ ref: 'c', cssSelector: '[data-testid="footer"]', visualWeight: 0.3 }),
    ];
    expect(pickSelectorForFinding(ctas, 'a')).toBe('[data-testid="hero"]');
  });

  it('falls back when the finding has no ctaRef at all', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: null, visualWeight: 0.9 }),
      makeCta({ ref: 'b', cssSelector: '[data-testid="signup-cta"]', visualWeight: 0.7 }),
    ];
    expect(pickSelectorForFinding(ctas, undefined)).toBe('[data-testid="signup-cta"]');
  });

  it('returns null when no CTA on the page has a parser-emitted selector', () => {
    const ctas = [
      makeCta({ ref: 'a', cssSelector: null }),
      makeCta({ ref: 'b', cssSelector: null }),
    ];
    expect(pickSelectorForFinding(ctas, 'a')).toBeNull();
    expect(pickSelectorForFinding(ctas, undefined)).toBeNull();
  });

  it('returns null on an empty CTA list', () => {
    expect(pickSelectorForFinding([], undefined)).toBeNull();
  });
});

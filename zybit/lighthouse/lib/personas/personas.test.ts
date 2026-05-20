/**
 * Invariants on the persona library — bias-control guarantees from
 * phase1.md §7. These tests fire if anyone accidentally narrows the
 * distribution by tuning numbers later.
 */

import { describe, expect, it } from 'vitest';
import { PERSONAS, personaById } from './index';

describe('persona library', () => {
  it('has exactly the five Phase 1 personas', () => {
    expect(PERSONAS.map((p) => p.id).sort()).toEqual(
      ['bot-ish', 'casual', 'churning', 'evaluator', 'power-user'].sort(),
    );
  });

  it('weights sum to ~1 (within ±0.02)', () => {
    const sum = PERSONAS.reduce((s, p) => s + p.weight, 0);
    expect(sum).toBeGreaterThan(0.98);
    expect(sum).toBeLessThan(1.02);
  });

  it('clickIntent spans ≥ 3× across personas (bias control)', () => {
    const intents = PERSONAS.map((p) => p.clickIntent);
    const lo = Math.min(...intents);
    const hi = Math.max(...intents);
    expect(hi / lo).toBeGreaterThanOrEqual(3);
  });

  it('formSubmitIntent spans ≥ 3× across personas (bias control)', () => {
    const intents = PERSONAS.map((p) => p.formSubmitIntent);
    const lo = Math.min(...intents);
    const hi = Math.max(...intents);
    expect(hi / lo).toBeGreaterThanOrEqual(3);
  });

  it('every persona has plausibly-shaped distributions', () => {
    for (const p of PERSONAS) {
      expect(p.pagesPerSession.mean).toBeGreaterThan(0);
      expect(p.pagesPerSession.stddev).toBeGreaterThanOrEqual(0);
      expect(p.dwellMsPerPage.mean).toBeGreaterThan(0);
      expect(p.dwellMsPerPage.stddev).toBeGreaterThanOrEqual(0);
      expect(p.scrollDepthPct.mean).toBeGreaterThanOrEqual(0);
      expect(p.scrollDepthPct.mean).toBeLessThanOrEqual(100);
      expect(p.clickIntent).toBeGreaterThanOrEqual(0);
      expect(p.clickIntent).toBeLessThanOrEqual(1);
      expect(p.formSubmitIntent).toBeGreaterThanOrEqual(0);
      expect(p.formSubmitIntent).toBeLessThanOrEqual(1);
      expect(p.bounceProbability).toBeGreaterThanOrEqual(0);
      expect(p.bounceProbability).toBeLessThanOrEqual(1);
      const [a, b] = p.diurnalWindowUtc;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(24);
      expect(a).toBeLessThanOrEqual(b);
      expect(p.preferredPaths.length).toBeGreaterThan(0);
    }
  });

  it('personaById throws for unknown ids', () => {
    expect(() => personaById('not-a-real-persona')).toThrow();
  });

  it('personaById returns the same reference as PERSONAS', () => {
    expect(personaById('casual')).toBe(PERSONAS.find((p) => p.id === 'casual'));
  });
});

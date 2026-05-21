import { describe, expect, it } from 'vitest';
import { minimumSampleSizePerArm } from '@/lib/experiments/stats';
import { sizeExperimentArms } from './syntheticExperiment';

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

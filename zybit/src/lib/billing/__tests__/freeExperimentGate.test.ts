import { describe, expect, it } from 'vitest';
import { checkFreeExperimentGate } from '../freeExperimentGate';

describe('checkFreeExperimentGate', () => {
  it('lets a paid org through (plan limits govern, not this gate)', () => {
    // Paid orgs fall through regardless of free-slot state.
    expect(
      checkFreeExperimentGate({ hasActiveSubscription: true, freeExperimentUsedAt: null }),
    ).toEqual({ allowed: true, reason: 'paid' });

    expect(
      checkFreeExperimentGate({
        hasActiveSubscription: true,
        freeExperimentUsedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toEqual({ allowed: true, reason: 'paid' });
  });

  it('allows an unpaid org that has not used its free experiment', () => {
    expect(
      checkFreeExperimentGate({ hasActiveSubscription: false, freeExperimentUsedAt: null }),
    ).toEqual({ allowed: true, reason: 'free-slot-available' });
  });

  it('blocks an unpaid org that already used its one free experiment', () => {
    expect(
      checkFreeExperimentGate({
        hasActiveSubscription: false,
        freeExperimentUsedAt: new Date('2026-05-29T12:00:00Z'),
      }),
    ).toEqual({ allowed: false, reason: 'free-slot-used' });
  });

  it('is inert for every existing org (null timestamp => allowed)', () => {
    // The migration backfills no timestamp, so every pre-existing unpaid org
    // keeps a null `freeExperimentUsedAt` and is never blocked by this gate.
    expect(
      checkFreeExperimentGate({ hasActiveSubscription: false, freeExperimentUsedAt: null }).allowed,
    ).toBe(true);
  });
});

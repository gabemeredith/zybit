import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PLAN_LIMITS,
  formatLimit,
  isValidPlanId,
  planIdFromStripePriceId,
  stripePriceIdForPlan,
} from '../plans';

describe('isValidPlanId', () => {
  it('accepts known tiers and rejects anything else', () => {
    expect(isValidPlanId('starter')).toBe(true);
    expect(isValidPlanId('enterprise')).toBe(true);
    expect(isValidPlanId('free')).toBe(false);
    expect(isValidPlanId('')).toBe(false);
    expect(isValidPlanId(null)).toBe(false);
    expect(isValidPlanId(42)).toBe(false);
  });
});

describe('plan limits monotonicity', () => {
  it('each tier is at least as permissive as the previous', () => {
    const order = ['starter', 'growth', 'scale', 'enterprise'] as const;
    for (let i = 1; i < order.length; i++) {
      const prev = PLAN_LIMITS[order[i - 1]];
      const cur = PLAN_LIMITS[order[i]];
      expect(cur.sites).toBeGreaterThanOrEqual(prev.sites);
      expect(cur.eventsPerMonth).toBeGreaterThanOrEqual(prev.eventsPerMonth);
      expect(cur.concurrentExperiments).toBeGreaterThanOrEqual(prev.concurrentExperiments);
    }
  });
});

describe('Stripe price <-> plan mapping (webhook hinge)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter_x';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth_x';
    process.env.STRIPE_PRICE_SCALE = 'price_scale_x';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('round-trips plan -> priceId -> plan', () => {
    const priceId = stripePriceIdForPlan('growth');
    expect(priceId).toBe('price_growth_x');
    expect(planIdFromStripePriceId(priceId!)).toBe('growth');
  });

  it('returns null for an unknown price id', () => {
    expect(planIdFromStripePriceId('price_unknown')).toBeNull();
  });

  it('returns null when the env price is unset', () => {
    delete process.env.STRIPE_PRICE_SCALE;
    expect(stripePriceIdForPlan('scale')).toBeNull();
  });
});

describe('formatLimit', () => {
  it('humanizes K / M and Infinity', () => {
    expect(formatLimit(Infinity)).toBe('Unlimited');
    expect(formatLimit(100_000)).toBe('100K');
    expect(formatLimit(2_000_000)).toBe('2M');
    expect(formatLimit(500)).toBe('500');
  });
});

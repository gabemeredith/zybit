import { describe, it, expect } from 'vitest';
import { computeImpactEstimate, windowDaysFromTimeWindow } from '@/lib/phase2/rules/impactEstimate';
import type { ImpactInput } from '@/lib/phase2/rules/impactEstimate';

describe('computeImpactEstimate', () => {
  const BASE: ImpactInput = {
    affectedRate: 0.5,
    windowVolume: 300,
    windowDays: 30,
    signalDescription: 'pageviews on /pricing',
  };

  // 1. revenue → conversions count, no dollar figures
  it('revenue: value=conversions count, unit=conversions, no $ in formatted', () => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType: 'revenue',
      goalConfig: { arpu: 47, baselineConversionRate: 0.03 },
    });
    // affectedMonthly = 0.5 * (300/30) * 30 = 150
    // convertedMonthly = 150 * 0.03 = 4.5 → value = 5
    expect(result.unit).toBe('conversions');
    expect(result.period).toBe('monthly');
    expect(result.formatted).not.toContain('$');
    expect(result.formatted).toContain('conversions/month');
    expect(result.value).toBe(Math.round(4.5));
  });

  // 2. revenue without ARPU → still conversions (no fallback to sessions needed)
  it('revenue without arpu → conversions', () => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType: 'revenue',
      goalConfig: {},
    });
    expect(result.unit).toBe('conversions');
    expect(result.formatted).toContain('conversions/month');
  });

  // 3. ecommerce → conversions count, no dollar figures
  it('ecommerce → unit=conversions, no $ in formatted', () => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType: 'ecommerce',
      goalConfig: { aov: 120, baselineConversionRate: 0.03 },
    });
    // affectedMonthly = 150, converted = 4.5 → value = 5
    expect(result.unit).toBe('conversions');
    expect(result.value).toBe(Math.round(4.5));
    expect(result.formatted).not.toContain('$');
    expect(result.formatted).toContain('conversions/month');
  });

  // 4. growth
  it('growth → unit=conversionLabel, formatted contains signups/month', () => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType: 'growth',
      goalConfig: { conversionLabel: 'signups', baselineConversionRate: 0.05 },
    });
    expect(result.unit).toBe('signups');
    expect(result.formatted).toContain('signups/month');
    expect(result.period).toBe('monthly');
    // affectedMonthly = 150, convertedMonthly = 150 * 0.05 = 7.5 → 8
    expect(result.value).toBe(Math.round(150 * 0.05));
  });

  // 5. custom
  it('custom → unit=customMetricLabel', () => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType: 'custom',
      goalConfig: {
        customMetricLabel: 'donations',
        customMetricValue: 10,
        baselineConversionRate: 0.02,
      },
    });
    expect(result.unit).toBe('donations');
    expect(result.formatted).toContain('donations/month');
  });

  // 6. engagement (default)
  it('engagement → unit=sessions, formatted ~X sessions/month', () => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType: 'engagement',
    });
    expect(result.unit).toBe('sessions');
    expect(result.formatted).toContain('sessions/month');
    expect(result.formatted).toMatch(/^~\d/);
  });

  // 7. no goalType → defaults to engagement
  it('no goalType defaults to engagement (sessions)', () => {
    const result = computeImpactEstimate({
      ...BASE,
    });
    expect(result.unit).toBe('sessions');
  });

  // 8. affectedRate=0 → value=0
  it('affectedRate=0 → value=0', () => {
    const result = computeImpactEstimate({ ...BASE, affectedRate: 0 });
    expect(result.value).toBe(0);
  });

  // 9. affectedRate=1 → uses full volume
  it('affectedRate=1 → uses full volume', () => {
    const full = computeImpactEstimate({ ...BASE, affectedRate: 1 });
    const half = computeImpactEstimate({ ...BASE, affectedRate: 0.5 });
    expect(full.value).toBe(half.value * 2);
  });

  // 10. affectedRate>1 → clamped to 1
  it('affectedRate>1 is clamped to 1', () => {
    const clamped = computeImpactEstimate({ ...BASE, affectedRate: 1.5 });
    const full = computeImpactEstimate({ ...BASE, affectedRate: 1 });
    expect(clamped.value).toBe(full.value);
  });

  // 11. windowDays=0 → doesn't divide by zero
  it('windowDays=0 does not throw and clamps denominator to 1', () => {
    expect(() =>
      computeImpactEstimate({ ...BASE, windowDays: 0 }),
    ).not.toThrow();
    const result = computeImpactEstimate({ ...BASE, windowDays: 0 });
    expect(Number.isFinite(result.value)).toBe(true);
  });

  // 12. windowVolume=0 → value=0
  it('windowVolume=0 → value=0', () => {
    const result = computeImpactEstimate({ ...BASE, windowVolume: 0 });
    expect(result.value).toBe(0);
  });

  // 13. revenue/ecommerce never emit currency symbols regardless of currencyCode config
  it.each(['revenue', 'ecommerce'] as const)('%s goal never contains $ in formatted', (goalType) => {
    const result = computeImpactEstimate({
      ...BASE,
      goalType,
      goalConfig: { arpu: 100, aov: 100, currencyCode: 'USD', baselineConversionRate: 0.03 },
    });
    expect(result.formatted).not.toContain('$');
    expect(result.formatted).not.toContain('£');
    expect(result.formatted).not.toContain('€');
  });

  // 14. large conversion count → k notation
  it('large conversion count formats as k notation', () => {
    const result = computeImpactEstimate({
      affectedRate: 1,
      windowVolume: 100_000,
      windowDays: 30,
      goalType: 'revenue',
      goalConfig: { baselineConversionRate: 0.1 },
      signalDescription: 'sessions',
    });
    // affectedMonthly = 100000, converted = 10000 → 10k conversions/month
    expect(result.formatted).toMatch(/^~\d+k conversions\/month$/);
  });

  // 15. period is always monthly
  it('period is always monthly', () => {
    const types: Array<typeof BASE['goalType'] | undefined> = [
      'revenue', 'ecommerce', 'growth', 'engagement', 'custom', undefined,
    ];
    for (const goalType of types) {
      const result = computeImpactEstimate({ ...BASE, goalType });
      expect(result.period).toBe('monthly');
    }
  });

  // 16. basis string contains signal description
  it('basis contains the signalDescription', () => {
    const result = computeImpactEstimate({
      ...BASE,
      signalDescription: 'sessions on /checkout',
    });
    expect(result.basis).toContain('sessions on /checkout');
  });
});

describe('windowDaysFromTimeWindow', () => {
  it('computes correct day count for known start/end', () => {
    const days = windowDaysFromTimeWindow({
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-31T00:00:00Z',
    });
    expect(days).toBe(30);
  });

  it('returns at least 1 for same-day window', () => {
    const days = windowDaysFromTimeWindow({
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-01T00:00:00Z',
    });
    expect(days).toBeGreaterThanOrEqual(1);
  });

  it('handles 7-day window', () => {
    const days = windowDaysFromTimeWindow({
      start: '2026-01-01T00:00:00Z',
      end: '2026-01-08T00:00:00Z',
    });
    expect(days).toBe(7);
  });
});

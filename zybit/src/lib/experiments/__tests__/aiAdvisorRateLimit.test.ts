import { describe, expect, it } from 'vitest';
import { AI_DAILY_LIMIT, todayUtcKey } from '../aiAdvisorRateLimit';

describe('todayUtcKey', () => {
  it('formats as YYYY-MM-DD in UTC', () => {
    expect(todayUtcKey(new Date('2026-05-22T14:30:00Z'))).toBe('2026-05-22');
  });

  it('uses the UTC day even when local timezone would roll over', () => {
    // Late evening UTC on May 21 = afternoon PDT — still May 21 in UTC.
    expect(todayUtcKey(new Date('2026-05-21T23:59:59Z'))).toBe('2026-05-21');
    // Just past midnight UTC on May 22 = evening PDT on May 21 — May 22 in UTC.
    expect(todayUtcKey(new Date('2026-05-22T00:00:01Z'))).toBe('2026-05-22');
  });
});

describe('AI_DAILY_LIMIT', () => {
  it('matches the sprint-3 spec (10/org/day)', () => {
    expect(AI_DAILY_LIMIT).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';
import { ga4GrainKey, mapGA4Event, mapGA4Events } from '../mapping';
import type { GA4EventRow } from '../types';

function row(overrides: Partial<GA4EventRow> = {}): GA4EventRow {
  return {
    eventName: 'page_view',
    sessionId: '',
    userId: null,
    timestamp: '2026-05-19T10:30:00.000Z',
    pagePath: '/pricing',
    dimensions: {
      date: '20260519',
      hour: '10',
      minute: '30',
      eventCount: '42',
      sessions: '12',
      ...overrides.dimensions,
    },
    ...overrides,
  };
}

describe('ga4GrainKey', () => {
  it('is deterministic and path/eventName-encoded', () => {
    const k1 = ga4GrainKey(row());
    const k2 = ga4GrainKey(row());
    expect(k1).toBe(k2);
    expect(k1).toBe('20260519|10|30|%2Fpricing|page_view');
  });

  it('differs when the grain differs', () => {
    expect(ga4GrainKey(row())).not.toBe(
      ga4GrainKey(row({ pagePath: '/home' })),
    );
  });
});

describe('mapGA4Event', () => {
  it('maps a known event with metrics and an idempotent dedupe id', () => {
    const { event } = mapGA4Event(row(), { siteId: 'site-1' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('page_view');
    expect(event!.source).toBe('ga4');
    expect(event!.siteId).toBe('site-1');
    expect(event!.metrics).toEqual({ eventCount: 42, sessions: 12 });
    expect(event!.sourceEventId).toBe(ga4GrainKey(row()));
    expect(event!.sessionId).toBe(`ga4:${ga4GrainKey(row())}`);
    expect(event!.path).toBe('/pricing');
  });

  it('maps purchase to checkout_complete', () => {
    const { event } = mapGA4Event(row({ eventName: 'purchase' }), { siteId: 's' });
    expect(event!.type).toBe('checkout_complete');
  });

  it('skips unknown event types', () => {
    const res = mapGA4Event(row({ eventName: 'custom_thing' }), { siteId: 's' });
    expect(res.event).toBeNull();
    expect(res.skippedReason).toBe('UNKNOWN_EVENT_TYPE');
  });

  it('skips invalid timestamps', () => {
    const res = mapGA4Event(row({ timestamp: 'not-a-date' }), { siteId: 's' });
    expect(res.event).toBeNull();
    expect(res.skippedReason).toBe('INVALID_TIMESTAMP');
  });
});

describe('mapGA4Events', () => {
  it('partitions mapped events and skipped rows by index', () => {
    const { events, skipped } = mapGA4Events(
      [row(), row({ eventName: 'unknownx' }), row({ eventName: 'add_to_cart' })],
      { siteId: 's' },
    );
    expect(events).toHaveLength(2);
    expect(skipped).toEqual([{ index: 1, reason: 'UNKNOWN_EVENT_TYPE' }]);
  });
});

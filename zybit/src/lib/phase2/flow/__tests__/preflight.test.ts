import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@/lib/phase2/types';
import {
  PREFLIGHT_MIN_SESSIONS,
  PREFLIGHT_MIN_ROUTES,
  computeFlowPreflight,
} from '../preflight';

let counter = 0;
function ev(
  sessionId: string,
  path: string,
  occurredAt = '2026-01-15T12:00:00Z',
): CanonicalEvent {
  counter += 1;
  return {
    id: `e-${counter}`,
    organizationId: 'org-1',
    siteId: 'site-1',
    sessionId,
    type: 'page_view',
    path,
    occurredAt,
    createdAt: occurredAt,
    source: 'api',
    schemaVersion: 2,
  };
}

function walk(sessionId: string, routes: string[]): CanonicalEvent[] {
  return routes.map((r, i) =>
    ev(sessionId, r, `2026-01-15T12:${String(i).padStart(2, '0')}:00Z`),
  );
}

function manySessions(count: number, routes: string[]): CanonicalEvent[] {
  const out: CanonicalEvent[] = [];
  for (let i = 0; i < count; i++) {
    out.push(...walk(`s-${i}`, routes));
  }
  return out;
}

const WINDOW = { start: '2026-01-15T00:00:00Z', end: '2026-01-16T00:00:00Z' };

function run(events: CanonicalEvent[]) {
  return computeFlowPreflight({
    events,
    windowStart: WINDOW.start,
    windowEnd: WINDOW.end,
  });
}

describe('computeFlowPreflight', () => {
  it('marks empty when no events arrived', () => {
    const r = run([]);
    expect(r.status).toBe('empty');
    expect(r.signals.totalEvents).toBe(0);
    expect(r.diagnostics.map((d) => d.code)).toContain('no-events');
  });

  it('marks ready with enough sessions, routes, and transitions', () => {
    const events = manySessions(PREFLIGHT_MIN_SESSIONS + 5, ['/', '/pricing', '/signup']);
    const r = run(events);
    expect(r.status).toBe('ready');
    expect(r.signals.distinctSessions).toBe(PREFLIGHT_MIN_SESSIONS + 5);
    expect(r.signals.distinctRoutes).toBeGreaterThanOrEqual(PREFLIGHT_MIN_ROUTES);
    expect(r.signals.totalTransitions).toBeGreaterThan(0);
    expect(r.diagnostics.map((d) => d.code)).toContain('ready');
  });

  it('marks thin when distinct routes < 3 even with many sessions', () => {
    const r = run(manySessions(PREFLIGHT_MIN_SESSIONS + 5, ['/']));
    expect(r.status).toBe('thin');
    expect(r.diagnostics.map((d) => d.code)).toContain('single-route');
    expect(r.diagnostics.map((d) => d.code)).toContain('no-transitions');
  });

  it('marks thin when sessions are below the audit threshold but transitions exist', () => {
    const r = run(manySessions(5, ['/', '/pricing', '/signup']));
    expect(r.status).toBe('thin');
    expect(r.diagnostics.map((d) => d.code)).toContain('low-sessions');
    expect(r.signals.totalTransitions).toBeGreaterThan(0);
  });

  it('flags session-id-missing as a blocker when most events lack a session id', () => {
    const events: CanonicalEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(ev('', '/'));
    events.push(...walk('s-1', ['/', '/pricing']));
    const r = run(events);
    expect(r.status).toBe('empty');
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain('session-id-missing');
    expect(r.diagnostics.find((d) => d.code === 'session-id-missing')?.severity).toBe('block');
  });

  it('flags path-missing as a blocker when most events lack a path', () => {
    const events: CanonicalEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(ev(`s-${i}`, ''));
    events.push(...walk('s-real', ['/', '/pricing']));
    const r = run(events);
    expect(r.status).toBe('empty');
    expect(r.diagnostics.map((d) => d.code)).toContain('path-missing');
  });

  it('counts a single event with the same session/route as one arrival, zero transitions', () => {
    const events = manySessions(60, ['/', '/']); // collapses to one arrival each
    const r = run(events);
    expect(r.signals.distinctSessions).toBe(60);
    expect(r.signals.totalTransitions).toBe(0);
    expect(r.status).toBe('thin');
    expect(r.diagnostics.map((d) => d.code)).toContain('no-transitions');
  });

  it('normalizes ids when counting distinct routes (`/orders/1`, `/orders/2` → one route)', () => {
    const events = manySessions(60, ['/', '/orders/1', '/orders/2']);
    const r = run(events);
    expect(r.signals.distinctRoutes).toBe(2);
    expect(r.status).toBe('thin');
    expect(r.diagnostics.map((d) => d.code)).toContain('few-routes');
  });

  it('does not double-report low-sessions when status is already empty', () => {
    const r = run([]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['no-events']);
  });
});

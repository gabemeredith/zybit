import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@/lib/phase2/types';
import { deriveFlowGraph } from '../deriveFlowGraph';

let counter = 0;
function ev(sessionId: string, path: string, occurredAt: string): CanonicalEvent {
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

/** Builds a session as an ordered walk of routes, one minute apart. */
function walk(sessionId: string, routes: string[]): CanonicalEvent[] {
  return routes.map((r, i) =>
    ev(sessionId, r, `2026-01-15T12:${String(i).padStart(2, '0')}:00Z`),
  );
}

const WINDOW = { start: '2026-01-15T00:00:00Z', end: '2026-01-16T00:00:00Z' };

function derive(events: CanonicalEvent[]) {
  return deriveFlowGraph({
    siteId: 'site-1',
    windowStart: WINDOW.start,
    windowEnd: WINDOW.end,
    events,
    generatedAt: '2026-01-16T00:00:00Z',
  });
}

describe('deriveFlowGraph', () => {
  it('returns an empty graph for no events', () => {
    const g = derive([]);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.sessionCount).toBe(0);
  });

  it('builds nodes and edges from a single linear session', () => {
    const g = derive(walk('s1', ['/', '/pricing', '/signup']));
    expect(g.sessionCount).toBe(1);
    expect(g.nodes.map((n) => n.route).sort()).toEqual(['/', '/pricing', '/signup']);

    const edge = g.edges.find((e) => e.from === '/' && e.to === '/pricing');
    expect(edge?.transitions).toBe(1);
    expect(edge?.share).toBe(1);
  });

  it('counts entries on the first arrival and exits on the last', () => {
    const g = derive(walk('s1', ['/', '/pricing', '/signup']));
    const home = g.nodes.find((n) => n.route === '/')!;
    const signup = g.nodes.find((n) => n.route === '/signup')!;
    expect(home.entries).toBe(1);
    expect(home.exits).toBe(0);
    expect(signup.entries).toBe(0);
    expect(signup.exits).toBe(1);
    expect(signup.exitRate).toBe(1);
  });

  it('collapses consecutive same-route events into one arrival', () => {
    const g = derive(walk('s1', ['/pricing', '/pricing', '/pricing']));
    const pricing = g.nodes.find((n) => n.route === '/pricing')!;
    expect(pricing.visits).toBe(1);
    expect(g.edges).toEqual([]);
  });

  it('normalizes dynamic id segments so they share a node', () => {
    const g = derive([
      ...walk('s1', ['/orders/101']),
      ...walk('s2', ['/orders/202']),
    ]);
    const node = g.nodes.find((n) => n.route === '/orders/:id')!;
    expect(node.sessions).toBe(2);
    expect(node.visits).toBe(2);
  });

  it('aggregates transitions and computes outbound share across sessions', () => {
    // Two sessions go / -> /pricing, one goes / -> /docs.
    const g = derive([
      ...walk('s1', ['/', '/pricing']),
      ...walk('s2', ['/', '/pricing']),
      ...walk('s3', ['/', '/docs']),
    ]);
    const toPricing = g.edges.find((e) => e.from === '/' && e.to === '/pricing')!;
    const toDocs = g.edges.find((e) => e.from === '/' && e.to === '/docs')!;
    expect(toPricing.transitions).toBe(2);
    expect(toDocs.transitions).toBe(1);
    expect(toPricing.share).toBeCloseTo(2 / 3, 5);
    expect(toDocs.share).toBeCloseTo(1 / 3, 5);
  });

  it('computes exitRate as the share of reaching sessions that ended on a route', () => {
    // 3 sessions reach /checkout; 2 exit there, 1 continues to /done.
    const g = derive([
      ...walk('s1', ['/cart', '/checkout']),
      ...walk('s2', ['/cart', '/checkout']),
      ...walk('s3', ['/cart', '/checkout', '/done']),
    ]);
    const checkout = g.nodes.find((n) => n.route === '/checkout')!;
    expect(checkout.sessions).toBe(3);
    expect(checkout.exits).toBe(2);
    expect(checkout.exitRate).toBeCloseTo(2 / 3, 5);
  });

  it('is deterministic — identical events yield an identical graph', () => {
    const events = [...walk('s1', ['/', '/pricing']), ...walk('s2', ['/', '/docs'])];
    expect(JSON.stringify(derive(events))).toBe(JSON.stringify(derive(events)));
  });
});

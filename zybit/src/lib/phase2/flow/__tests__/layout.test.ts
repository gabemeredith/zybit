import { describe, expect, it } from 'vitest';
import type { FlowGraph } from '../types';
import { layoutFlowGraph, FLOW_LAYOUT_DIMS } from '../layout';

const { NODE_W, NODE_H } = FLOW_LAYOUT_DIMS;
const PAD = 24;
const COL_GAP = 74;
const ROW_GAP = 18;

function graph(
  nodes: Array<{ route: string; visits?: number; sessions?: number; entries?: number; exits?: number; exitRate?: number }>,
  edges: Array<{ from: string; to: string; transitions: number; share?: number }>,
): FlowGraph {
  return {
    siteId: 'test',
    windowStart: '2026-01-01T00:00:00Z',
    windowEnd: '2026-01-08T00:00:00Z',
    sessionCount: 100,
    generatedAt: '2026-01-08T00:00:00Z',
    nodes: nodes.map((n) => ({
      route: n.route,
      visits: n.visits ?? 100,
      sessions: n.sessions ?? 100,
      entries: n.entries ?? 0,
      exits: n.exits ?? 0,
      exitRate: n.exitRate ?? 0,
    })),
    edges: edges.map((e) => ({ ...e, share: e.share ?? 1 })),
  };
}

describe('layoutFlowGraph', () => {
  it('returns an empty layout for an empty graph', () => {
    const g = graph([], []);
    const layout = layoutFlowGraph(g);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it('places a single node at the padding origin', () => {
    const g = graph([{ route: '/' }], []);
    const layout = layoutFlowGraph(g);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].x).toBe(PAD);
    expect(layout.nodes[0].y).toBe(PAD);
    expect(layout.nodes[0].depth).toBe(0);
  });

  it('assigns consecutive depths in a linear chain', () => {
    const g = graph(
      [{ route: '/' }, { route: '/step' }, { route: '/done' }],
      [
        { from: '/', to: '/step', transitions: 80 },
        { from: '/step', to: '/done', transitions: 60 },
      ],
    );
    const layout = layoutFlowGraph(g);
    const byRoute = new Map(layout.nodes.map((n) => [n.route, n]));
    expect(byRoute.get('/')!.depth).toBe(0);
    expect(byRoute.get('/step')!.depth).toBe(1);
    expect(byRoute.get('/done')!.depth).toBe(2);
  });

  it('stacks multiple nodes in the same column vertically', () => {
    // '/' has no inbound edge so it's depth 0.
    // '/a' and '/b' are both reached from '/' so they're depth 1.
    const g = graph(
      [
        { route: '/', visits: 200, sessions: 200 },
        { route: '/a', visits: 80, sessions: 80 },
        { route: '/b', visits: 120, sessions: 120 },
      ],
      [
        { from: '/', to: '/a', transitions: 80 },
        { from: '/', to: '/b', transitions: 120 },
      ],
    );
    const layout = layoutFlowGraph(g);
    const depth1 = layout.nodes.filter((n) => n.depth === 1).sort((a, b) => a.y - b.y);
    expect(depth1).toHaveLength(2);
    // Sorted by visits desc → /b (120) first, /a (80) second
    expect(depth1[0].route).toBe('/b');
    expect(depth1[1].route).toBe('/a');
    // y positions differ by exactly NODE_H + ROW_GAP
    expect(depth1[1].y - depth1[0].y).toBe(NODE_H + ROW_GAP);
  });

  it('x position matches the column formula', () => {
    const g = graph(
      [{ route: '/' }, { route: '/next' }],
      [{ from: '/', to: '/next', transitions: 50 }],
    );
    const layout = layoutFlowGraph(g);
    const byRoute = new Map(layout.nodes.map((n) => [n.route, n]));
    expect(byRoute.get('/')!.x).toBe(PAD);
    expect(byRoute.get('/next')!.x).toBe(PAD + NODE_W + COL_GAP);
  });

  it('generates SVG bezier path strings for edges', () => {
    const g = graph(
      [{ route: '/' }, { route: '/next' }],
      [{ from: '/', to: '/next', transitions: 50 }],
    );
    const layout = layoutFlowGraph(g);
    expect(layout.edges).toHaveLength(1);
    const { path } = layout.edges[0];
    // Must start with M and contain C for the cubic bezier
    expect(path).toMatch(/^M /);
    expect(path).toContain(' C ');
  });

  it('scales edge weight proportionally to transitions', () => {
    const g = graph(
      [{ route: '/' }, { route: '/a' }, { route: '/b' }],
      [
        { from: '/', to: '/a', transitions: 100 },
        { from: '/', to: '/b', transitions: 10 },
      ],
    );
    const layout = layoutFlowGraph(g);
    const heavy = layout.edges.find((e) => e.to === '/a')!;
    const light = layout.edges.find((e) => e.to === '/b')!;
    expect(heavy.weight).toBeGreaterThan(light.weight);
  });

  it('handles a cyclic graph without hanging', () => {
    const g = graph(
      [{ route: '/a' }, { route: '/b' }],
      [
        { from: '/a', to: '/b', transitions: 50 },
        { from: '/b', to: '/a', transitions: 50 },
      ],
    );
    // Should complete without throwing
    const layout = layoutFlowGraph(g);
    expect(layout.nodes).toHaveLength(2);
  });

  it('computes width and height from node count', () => {
    const g = graph(
      [{ route: '/' }, { route: '/next' }],
      [{ from: '/', to: '/next', transitions: 50 }],
    );
    const layout = layoutFlowGraph(g);
    // 2 columns, max 1 row
    const expectedWidth = PAD * 2 + 2 * NODE_W + 1 * COL_GAP;
    const expectedHeight = PAD * 2 + 1 * NODE_H;
    expect(layout.width).toBe(expectedWidth);
    expect(layout.height).toBe(expectedHeight);
  });
});

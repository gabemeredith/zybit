import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowGraph, FlowNode } from '@/lib/phase2/flow/types';
import { flowInterStepDropoff } from '../flowInterStepDropoff';
import type { AuditRuleContext } from '../types';
import { makeContext, makeCta, makeSnapshot } from './fixtures';

function node(route: string, sessions: number, exits: number): FlowNode {
  return {
    route,
    visits: sessions,
    sessions,
    entries: 0,
    exits,
    exitRate: sessions > 0 ? exits / sessions : 0,
  };
}

function edge(from: string, to: string, transitions: number): FlowEdge {
  return { from, to, transitions, share: 1 };
}

function graph(opts: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  sessionCount: number;
}): FlowGraph {
  return {
    siteId: 'site-test',
    windowStart: '2026-01-01T00:00:00Z',
    windowEnd: '2026-01-08T00:00:00Z',
    sessionCount: opts.sessionCount,
    generatedAt: '2026-01-08T00:00:00Z',
    nodes: opts.nodes,
    edges: opts.edges,
  };
}

function ctx(flowGraph?: FlowGraph): AuditRuleContext {
  return { ...makeContext([]), flowGraph };
}

describe('flowInterStepDropoff', () => {
  it('emits nothing when there is no flow graph', () => {
    expect(flowInterStepDropoff.evaluate(ctx())).toEqual([]);
  });

  it('emits nothing when the graph is below the session floor', () => {
    const g = graph({
      nodes: [node('/', 40, 0), node('/checkout', 40, 30)],
      edges: [edge('/', '/checkout', 40)],
      sessionCount: 40,
    });
    expect(flowInterStepDropoff.evaluate(ctx(g))).toEqual([]);
  });

  it('flags a mid-flow chokepoint with high exit rate', () => {
    const g = graph({
      nodes: [node('/', 200, 10), node('/checkout', 120, 90)],
      edges: [edge('/', '/checkout', 150)],
      sessionCount: 200,
    });
    const out = flowInterStepDropoff.evaluate(ctx(g));
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe('flow-inter-step-dropoff');
    expect(out[0].category).toBe('flow');
    expect(out[0].pathRef).toBe('/checkout');
    expect(out[0].snapshotDiagram?.type).toBe('flow-funnel');
  });

  it('excludes a pure entry page even when its exit rate is high', () => {
    // /landing has no inbound transitions — high bounce there is not an
    // inter-step problem.
    const g = graph({
      nodes: [node('/landing', 300, 250), node('/pricing', 60, 10)],
      edges: [edge('/landing', '/pricing', 50)],
      sessionCount: 300,
    });
    const out = flowInterStepDropoff.evaluate(ctx(g));
    expect(out).toEqual([]);
  });

  it('excludes a chokepoint reached by too few sessions', () => {
    const g = graph({
      nodes: [node('/', 200, 10), node('/rare', 20, 18)],
      edges: [edge('/', '/rare', 25)],
      sessionCount: 200,
    });
    expect(flowInterStepDropoff.evaluate(ctx(g))).toEqual([]);
  });

  it('picks the step that loses the most users when several qualify', () => {
    const g = graph({
      nodes: [
        node('/', 400, 10),
        node('/step-a', 100, 70), // 70 lost
        node('/step-b', 150, 120), // 120 lost — biggest
      ],
      edges: [
        edge('/', '/step-a', 100),
        edge('/', '/step-b', 150),
      ],
      sessionCount: 400,
    });
    const out = flowInterStepDropoff.evaluate(ctx(g));
    expect(out).toHaveLength(1);
    expect(out[0].pathRef).toBe('/step-b');
  });

  it('marks a severe chokepoint critical and a moderate one a warning', () => {
    const critical = flowInterStepDropoff.evaluate(
      ctx(
        graph({
          nodes: [node('/', 200, 5), node('/checkout', 120, 100)],
          edges: [edge('/', '/checkout', 150)],
          sessionCount: 200,
        }),
      ),
    );
    expect(critical[0].severity).toBe('critical');

    const warning = flowInterStepDropoff.evaluate(
      ctx(
        graph({
          nodes: [node('/', 200, 5), node('/checkout', 120, 72)],
          edges: [edge('/', '/checkout', 150)],
          sessionCount: 200,
        }),
      ),
    );
    expect(warning[0].severity).toBe('warn');
  });

  it('names the top inbound path in the evidence', () => {
    const g = graph({
      nodes: [node('/cart', 200, 10), node('/checkout', 120, 90)],
      edges: [edge('/cart', '/checkout', 150)],
      sessionCount: 200,
    });
    const out = flowInterStepDropoff.evaluate(ctx(g));
    const inbound = out[0].evidence.find((e) => e.label === 'Top inbound path');
    expect(inbound?.value).toBe('/cart → /checkout');
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string }) {
      return {
        id: 'flow-inter-step-dropoff:/checkout',
        ruleId: 'flow-inter-step-dropoff',
        category: 'flow' as const,
        severity: 'warn' as const,
        confidence: 0.6,
        priorityScore: 0.6,
        pathRef: '/checkout',
        title: 't',
        summary: 's',
        recommendation: [],
        evidence: [],
        refs,
      };
    }

    it('returns one red outline mod when the chokepoint primary CTA has a selector', () => {
      const cta = { ...makeCta('Place order', 0.9, 'above', 'order-cta'), cssSelector: 'button.order' };
      const out = flowInterStepDropoff.proposeAnnotations!(
        makeFinding({ ctaRef: 'order-cta' }),
        { snapshot: makeSnapshot('/checkout', [cta]), designTokens: null },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'button.order' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
    });

    it('returns [] when ctaRef present but the CTA has no cssSelector', () => {
      const cta = makeCta('Place order', 0.9, 'above', 'order-cta');
      const out = flowInterStepDropoff.proposeAnnotations!(
        makeFinding({ ctaRef: 'order-cta' }),
        { snapshot: makeSnapshot('/checkout', [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when refs.ctaRef is absent (no chokepoint snapshot at finding time)', () => {
      const cta = { ...makeCta('Place order', 0.9, 'above', 'order-cta'), cssSelector: 'button.order' };
      const out = flowInterStepDropoff.proposeAnnotations!(
        makeFinding({}),
        { snapshot: makeSnapshot('/checkout', [cta]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });
});

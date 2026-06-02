/**
 * Deterministic layered layout for the flow graph view (PRD Milestone 1,
 * scope item 3). Pure function — given a FlowGraph it returns positioned
 * nodes and SVG edge paths. No layout library: nodes are bucketed into depth
 * columns via longest-path relaxation (capped to break cycles) and stacked
 * within each column by traffic.
 */

import type { FlowEdge, FlowGraph, FlowNode } from './types';

export interface PositionedNode extends FlowNode {
  depth: number;
  x: number;
  y: number;
}

export interface PositionedEdge {
  from: string;
  to: string;
  transitions: number;
  share: number;
  /** SVG cubic-bezier path `d` attribute. */
  path: string;
  /** Stroke width in px, scaled by transition volume. */
  weight: number;
}

export interface FlowLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

const NODE_W = 190;
const NODE_H = 62;
const COL_GAP = 74;
const ROW_GAP = 18;
const PAD = 24;
const MAX_DEPTH = 8;

export const FLOW_LAYOUT_DIMS = { NODE_W, NODE_H } as const;

export function layoutFlowGraph(graph: FlowGraph): FlowLayout {
  const nodes = graph.nodes;
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const routes = new Set(nodes.map((n) => n.route));
  const edges: FlowEdge[] = graph.edges.filter(
    (e) => routes.has(e.from) && routes.has(e.to),
  );

  const inboundCount = new Map<string, number>();
  for (const e of edges) {
    inboundCount.set(e.to, (inboundCount.get(e.to) ?? 0) + 1);
  }

  // Depth = longest path from a source, capped so a cycle cannot run away.
  const depth = new Map<string, number>();
  const sources = nodes
    .filter((n) => (inboundCount.get(n.route) ?? 0) === 0)
    .map((n) => n.route);
  if (sources.length === 0) {
    // Fully cyclic graph — seed the highest-entry node as the single root.
    const root = [...nodes].sort(
      (a, b) =>
        b.entries - a.entries ||
        b.visits - a.visits ||
        a.route.localeCompare(b.route),
    )[0];
    depth.set(root.route, 0);
  } else {
    for (const r of sources) depth.set(r, 0);
  }

  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false;
    for (const e of edges) {
      const df = depth.get(e.from);
      if (df === undefined) continue;
      const target = Math.min(df + 1, MAX_DEPTH);
      const dt = depth.get(e.to);
      if (dt === undefined || target > dt) {
        depth.set(e.to, target);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Isolated or cycle-only nodes never reached from a source → column 0.
  for (const n of nodes) {
    if (!depth.has(n.route)) depth.set(n.route, 0);
  }

  const columns = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.route) ?? 0;
    const col = columns.get(d) ?? [];
    col.push(n);
    columns.set(d, col);
  }
  const maxDepth = Math.max(...columns.keys());
  let maxRows = 0;

  const positioned: PositionedNode[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const col = (columns.get(d) ?? []).sort(
      (a, b) =>
        b.visits - a.visits ||
        b.exitRate - a.exitRate ||
        a.route.localeCompare(b.route),
    );
    maxRows = Math.max(maxRows, col.length);
    col.forEach((n, i) => {
      positioned.push({
        ...n,
        depth: d,
        x: PAD + d * (NODE_W + COL_GAP),
        y: PAD + i * (NODE_H + ROW_GAP),
      });
    });
  }

  const posByRoute = new Map(positioned.map((p) => [p.route, p]));
  const maxTransitions = Math.max(1, ...edges.map((e) => e.transitions));

  const positionedEdges: PositionedEdge[] = edges.map((e) => {
    const from = posByRoute.get(e.from) as PositionedNode;
    const to = posByRoute.get(e.to) as PositionedNode;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const dx = Math.max((x2 - x1) / 2, 26);
    return {
      from: e.from,
      to: e.to,
      transitions: e.transitions,
      share: e.share,
      path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      weight: 1 + (e.transitions / maxTransitions) * 6,
    };
  });

  return {
    nodes: positioned,
    edges: positionedEdges,
    width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP,
    height: PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

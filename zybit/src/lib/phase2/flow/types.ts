/**
 * Flow graph contracts — the derived map of how real users move through a
 * product. Nodes are normalized routes; edges are observed session-level
 * transitions between them. Pure data shapes; the derivation lives in
 * `deriveFlowGraph.ts` and is a deterministic pure function over canonical
 * events (PRD Milestone 1, scope items 1–2).
 */

export type ISODateString = string;

export interface FlowNode {
  /** Normalized route, e.g. `/`, `/pricing`, `/orders/:id`. */
  route: string;
  /** Total session arrivals at this route (consecutive same-route events collapsed). */
  visits: number;
  /** Distinct sessions that touched this route at least once. */
  sessions: number;
  /** Sessions whose first arrival in the window is this route. */
  entries: number;
  /** Sessions whose last arrival in the window is this route — they left the product here. */
  exits: number;
  /** `exits / sessions`, 0..1 — share of sessions reaching this route that ended here. */
  exitRate: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Count of consecutive `from`→`to` arrivals across all sessions. */
  transitions: number;
  /** `transitions` as a share of all outbound transitions from `from`, 0..1. */
  share: number;
}

export interface FlowGraph {
  siteId: string;
  windowStart: ISODateString;
  windowEnd: ISODateString;
  /** Distinct sessions that contributed at least one route arrival. */
  sessionCount: number;
  generatedAt: ISODateString;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

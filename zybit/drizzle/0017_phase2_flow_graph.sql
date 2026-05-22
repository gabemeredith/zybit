-- PRD Milestone 1: persisted flow-graph advisory.
-- One row per site holding the derived route-transition graph: nodes are
-- normalized routes, edges are observed session transitions with per-edge
-- drop-off. Upserted by the insights pipeline; read by /app/flow.
-- Derivation is deterministic (see src/lib/phase2/flow/deriveFlowGraph.ts) —
-- this table is a render cache of the most recent computed graph, not a
-- source of truth.
CREATE TABLE IF NOT EXISTS "phase2_flow_graph" (
  "site_id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "session_count" integer NOT NULL DEFAULT 0,
  "graph" jsonb NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "phase2_flow_graph_org_idx"
  ON "phase2_flow_graph" ("organization_id");

/**
 * Flow-graph repository — read/upsert access to `phase2_flow_graph`.
 *
 * The graph is a deterministic derivation of canonical events (see
 * `deriveFlowGraph.ts`); this table is a cache of the most recent computed
 * graph per site so `/app/flow` can render without re-aggregating every
 * event on each page load. One row per site, upserted by the insights
 * pipeline.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase2FlowGraph } from '@/lib/db/schema';
import type { FlowGraph } from './types';

export interface FlowGraphRepository {
  get(organizationId: string, siteId: string): Promise<FlowGraph | null>;
  upsert(graph: FlowGraph, organizationId: string): Promise<void>;
}

export function createFlowGraphRepository(): FlowGraphRepository {
  return {
    async get(organizationId, siteId) {
      const db = getDb();
      const rows = await db
        .select({ graph: phase2FlowGraph.graph })
        .from(phase2FlowGraph)
        .where(
          and(
            eq(phase2FlowGraph.organizationId, organizationId),
            eq(phase2FlowGraph.siteId, siteId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? (row.graph as unknown as FlowGraph) : null;
    },

    async upsert(graph, organizationId) {
      const db = getDb();
      const now = new Date();
      const values = {
        siteId: graph.siteId,
        organizationId,
        windowStart: new Date(graph.windowStart),
        windowEnd: new Date(graph.windowEnd),
        sessionCount: graph.sessionCount,
        graph: graph as unknown as Record<string, unknown>,
        generatedAt: new Date(graph.generatedAt),
        updatedAt: now,
      };
      await db
        .insert(phase2FlowGraph)
        .values(values)
        .onConflictDoUpdate({
          target: phase2FlowGraph.siteId,
          set: {
            organizationId: values.organizationId,
            windowStart: values.windowStart,
            windowEnd: values.windowEnd,
            sessionCount: values.sessionCount,
            graph: values.graph,
            generatedAt: values.generatedAt,
            updatedAt: now,
          },
        });
    },
  };
}

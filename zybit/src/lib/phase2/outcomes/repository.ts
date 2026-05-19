/**
 * Outcomes repository — read-only access to zybit_experiment_outcomes for the
 * Learn re-ranker. Writers live in `src/lib/experiments/computeOutcomes.ts`;
 * this module is read-only by design.
 */

import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { zybitExperimentOutcomes } from '@/lib/db/schema';

/**
 * Slim row shape carrying just the fields the Learn re-ranker needs.
 * Keeps unit tests honest — they don't need to mock columns the math ignores.
 */
export interface ExperimentOutcomeRow {
  id: string;
  ruleId: string | null;
  pathRef: string | null;
  modificationType: string | null;
  result: 'positive' | 'negative' | 'inconclusive';
  liftPct: number | null;
  confidence: number | null;
  guardrailBreached: string | null;
  concludedAt: Date;
}

export interface OutcomesRepository {
  listForSite(siteId: string, limit?: number): Promise<ExperimentOutcomeRow[]>;
  listByIds(siteId: string, ids: string[]): Promise<ExperimentOutcomeRow[]>;
}

export function createOutcomesRepository(): OutcomesRepository {
  return {
    async listForSite(siteId, limit = 200) {
      const db = getDb();
      const rows = await db
        .select({
          id: zybitExperimentOutcomes.id,
          ruleId: zybitExperimentOutcomes.ruleId,
          pathRef: zybitExperimentOutcomes.pathRef,
          modificationType: zybitExperimentOutcomes.modificationType,
          result: zybitExperimentOutcomes.result,
          liftPct: zybitExperimentOutcomes.liftPct,
          confidence: zybitExperimentOutcomes.confidence,
          guardrailBreached: zybitExperimentOutcomes.guardrailBreached,
          concludedAt: zybitExperimentOutcomes.concludedAt,
        })
        .from(zybitExperimentOutcomes)
        .where(eq(zybitExperimentOutcomes.siteId, siteId))
        .orderBy(desc(zybitExperimentOutcomes.concludedAt))
        .limit(limit);

      return rows.map((r) => ({
        ...r,
        result: r.result as ExperimentOutcomeRow['result'],
      }));
    },

    async listByIds(siteId, ids) {
      if (ids.length === 0) return [];
      const all = await this.listForSite(siteId, 1000);
      const set = new Set(ids);
      return all.filter((r) => set.has(r.id));
    },
  };
}

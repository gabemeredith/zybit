/**
 * Synthetic experiment generator — Lighthouse Phase 2.
 *
 * Closes the loop for the PM view: after Identify/Propose persist a top
 * finding, this creates a real `forge_experiments` row, emits synthetic
 * assignment + conversion events (variant arm at a higher rate), and runs
 * Zybit's own `processExperiment` to write the outcome. The result lights
 * up DEPLOYED → RESULT → LEARNED on /app/loop.
 *
 * Imports Zybit's experiment libs directly (sizing, outcome computation) —
 * no statistics duplicated.
 *
 * Sizing note: `processExperiment` only classifies a result as
 * positive/negative (vs inconclusive) when the sequential guard's
 * `readyToStop` is true, which requires `participants >= minimumSampleSizePerArm`.
 * That floor is minimised near a 0.5 base rate, so we use a high synthetic
 * base rate and size each arm above the floor to guarantee a conclusive,
 * PM-legible result.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase2PageSnapshots, zybitExperiments, zybitFindings } from '@/lib/db/schema';
import { processExperiment } from '@/lib/experiments/computeOutcomes';
import { minimumSampleSizePerArm } from '@/lib/experiments/stats';
import type { VariantModification } from '@/lib/experiments/types';
import type { CtaCandidate, PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { seededRng } from '../generators/rng';
import { DirectEventSink } from '../sinks/direct';

const DAY_MS = 86_400_000;

export interface SyntheticExperimentParams {
  organizationId: string;
  siteId: string;
  slug: string;
  /** Conversion event type counted as the primary metric (e.g. 'cta_click'). */
  primaryMetric: string;
  /** Control-arm conversion rate (0..1). Default 0.5 — minimises the sample floor. */
  baseRate?: number;
  /** Relative lift applied to the variant arm. Default 0.15 (+15%). */
  relativeLift?: number;
  /** How long ago the experiment started, in days. Default 15 (> duration → concludes). */
  startedDaysAgo?: number;
  /** Planned duration in days. Default 14. */
  durationDays?: number;
}

export interface SyntheticExperimentResult {
  experimentId: string | null;
  findingId: string | null;
  /** processExperiment action, or 'no-finding' when nothing to test. */
  action: 'stopped' | 'updated' | 'skipped' | 'no-finding';
  result?: string;
  liftPct?: number;
  confidence?: number;
  participants: number;
  conversionEvents: number;
}

/**
 * Per-arm participant count, sized above the sequential guard's sample floor
 * so `processExperiment` can reach a conclusive (non-inconclusive) result.
 * `minimumSampleSizePerArm` is the floor `isReadyToStop` checks against.
 */
export function sizeExperimentArms(baseRate: number): number {
  return Math.ceil(minimumSampleSizePerArm(baseRate) * 1.3) + 100;
}

/**
 * Pick a browser-runnable CSS selector for the synthetic experiment, sourced
 * from the parser's per-CTA `cssSelector`. Tries the finding's referenced
 * CTA first; falls back to the highest-visual-weight CTA on the same page
 * that the parser was able to emit a selector for. Returns `null` when
 * nothing usable exists — the caller bails rather than stamp a hardcoded
 * convention that won't match the live page (Lighthouse's previous bug).
 */
export function pickSelectorForFinding(
  ctas: CtaCandidate[],
  findingCtaRef: string | undefined,
): string | null {
  if (findingCtaRef) {
    const matched = ctas.find((c) => c.ref === findingCtaRef);
    if (matched?.cssSelector) return matched.cssSelector;
  }
  const candidates = ctas
    .filter((c) => c.cssSelector !== null)
    .sort((a, b) => b.visualWeight - a.visualWeight);
  return candidates[0]?.cssSelector ?? null;
}

/** Deterministic, valid variant modification using the picked selector. */
function modificationFor(selector: string): VariantModification[] {
  return [
    {
      type: 'text-replace',
      selector,
      text: 'Get started — free',
    },
  ];
}

export async function generateSyntheticExperiment(
  params: SyntheticExperimentParams,
): Promise<SyntheticExperimentResult> {
  const db = getDb();
  const { organizationId, siteId, slug, primaryMetric } = params;
  const baseRate = params.baseRate ?? 0.5;
  const relativeLift = params.relativeLift ?? 0.15;
  const startedDaysAgo = params.startedDaysAgo ?? 15;
  const durationDays = params.durationDays ?? 14;

  // 1) Pick the highest-priority persisted finding to test.
  const [finding] = await db
    .select({
      id: zybitFindings.id,
      pathRef: zybitFindings.pathRef,
      title: zybitFindings.title,
      refs: zybitFindings.refs,
    })
    .from(zybitFindings)
    .where(and(eq(zybitFindings.organizationId, organizationId), eq(zybitFindings.siteId, siteId)))
    .orderBy(desc(zybitFindings.priorityScore))
    .limit(1);

  const noFinding = {
    experimentId: null,
    findingId: null,
    action: 'no-finding' as const,
    participants: 0,
    conversionEvents: 0,
  };

  if (!finding) return noFinding;
  // Site-wide findings (null pathRef) have no specific element to target.
  if (!finding.pathRef) return noFinding;

  // 1b) Load the snapshot for the finding's path and pick a real selector.
  //     Bail when no CTA on the page has a parser-emitted selector — better
  //     than stamping a hardcoded convention that won't match the page.
  const [snapshotRow] = await db
    .select({ data: phase2PageSnapshots.data })
    .from(phase2PageSnapshots)
    .where(
      and(
        eq(phase2PageSnapshots.organizationId, organizationId),
        eq(phase2PageSnapshots.siteId, siteId),
        eq(phase2PageSnapshots.pathRef, finding.pathRef),
      ),
    )
    .limit(1);
  if (!snapshotRow) return noFinding;
  const snapshotData = snapshotRow.data as unknown as PageSnapshotData;
  const findingRefs = (finding.refs ?? {}) as { ctaRef?: string };
  const selector = pickSelectorForFinding(snapshotData.ctas, findingRefs.ctaRef);
  if (!selector) return noFinding;

  // 2) Size each arm above the sequential-guard sample floor.
  const visitorsPerArm = sizeExperimentArms(baseRate);

  // 3) Create the running experiment, dated in the past so the duration is
  //    already expired and processExperiment concludes on this pass.
  const experimentId = randomUUID();
  const startedAt = new Date(Date.now() - startedDaysAgo * DAY_MS);
  const targetPath = finding.pathRef ?? '/';

  const [experiment] = await db
    .insert(zybitExperiments)
    .values({
      id: experimentId,
      organizationId,
      siteId,
      findingId: finding.id,
      hypothesis: `Addressing "${finding.title}" lifts ${primaryMetric}`,
      primaryMetric,
      primaryMetricSource: 'posthog',
      audienceControlPct: 50,
      audienceVariantPct: 50,
      durationDays,
      status: 'running',
      targetPath,
      modifications: modificationFor(selector),
      notes: JSON.stringify({ name: `Synthetic: ${finding.title}`, source: 'lighthouse' }),
      startedAt,
      createdAt: startedAt,
      updatedAt: startedAt,
    })
    .returning();

  // 4) Emit assignment + conversion events with historical timestamps inside
  //    [startedAt, endAt]. Equal arms guarantee both clear the sample floor.
  const sink = new DirectEventSink({ organizationId });
  const assignedAt = new Date(startedAt.getTime() + 12 * 3_600_000).toISOString();
  const rng = seededRng(`${experimentId}|conversions`);
  let conversionEvents = 0;

  for (const bucket of ['control', 'variant'] as const) {
    const rate = bucket === 'control' ? baseRate : baseRate * (1 + relativeLift);
    for (let i = 0; i < visitorsPerArm; i++) {
      const visitorId = `lh_exp_${slug}_${bucket}_${i}`;
      await sink.emit({
        siteId,
        sessionId: visitorId,
        type: 'experiment_assignment',
        path: targetPath,
        source: 'api',
        properties: { experimentId, bucket },
        sourceEventId: `${experimentId}|assign|${bucket}|${i}`,
        occurredAt: assignedAt,
      });
      if (rng.next() < rate) {
        // 1–2 days after assignment, comfortably before endAt (start + duration).
        const convAt = new Date(
          startedAt.getTime() + DAY_MS + Math.floor(rng.next() * DAY_MS),
        ).toISOString();
        await sink.emit({
          siteId,
          sessionId: visitorId,
          type: primaryMetric,
          path: targetPath,
          source: 'api',
          sourceEventId: `${experimentId}|conv|${bucket}|${i}`,
          occurredAt: convAt,
        });
        conversionEvents++;
      }
    }
  }
  await sink.flush();

  // 5) Run Zybit's outcome computation — writes the outcome row + concludes.
  const outcome = await processExperiment(db, experiment);

  return {
    experimentId,
    findingId: finding.id,
    action: outcome.action,
    result: outcome.result,
    liftPct: outcome.liftPct,
    confidence: outcome.confidence,
    participants: visitorsPerArm * 2,
    conversionEvents,
  };
}

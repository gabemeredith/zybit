/**
 * Compute-outcomes: automatic experiment result computation.
 *
 * For each running experiment:
 *   1. Query assignment events logged by the proxy (type = 'experiment_assignment').
 *   2. Join to conversion events (type = primaryMetric) by visitorId.
 *   3. Compute per-bucket conversion rates.
 *   4. Run chi-squared significance test.
 *   5. Apply sequential testing guard (confidence + min sample + min days).
 *   6. If guard passes: auto-stop, write outcome row, notify PM.
 *   7. Evaluate guardrail metrics; auto-stop and alert if breached.
 *
 * KNOWN LIMITATION — visitor matching accuracy:
 *   Assignment events store `session_id = visitorId` (the Zybit proxy cookie UUID).
 *   Conversion events from PostHog pull-sync use PostHog's own session IDs, which
 *   differ from the Zybit cookie. This means conversions from PostHog-tracked visitors
 *   will NOT be matched unless the PostHog bridge script is in place.
 *
 *   TODO (Priority 4 / FORGE-102): inject a small script tag via the proxy that does
 *   `posthog.register({'zybit_vid': readCookie('_zybit_vid')})` so PostHog events
 *   carry the Zybit visitor ID as a property, enabling cross-provider joining.
 *
 *   Until the bridge exists, this function accurately counts conversions for:
 *   - Direct Zybit API events (source = 'api')
 *   - Segment webhook events where the sessionId happens to match
 *   PostHog-sourced conversions will be undercounted. Document this in the UI.
 */

// randomUUID is on the Web Crypto global (available in Node 18+ and edge runtimes).
const randomUUID = () => globalThis.crypto.randomUUID();
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/lib/db/schema';
import { zybitExperiments, zybitFindings, zybitExperimentOutcomes, phase1Sites, appUsers } from '@/lib/db/schema';
import { sendExperimentConcludedEmail } from '@/lib/email/experimentConcludedEmail';
import {
  chiSquaredTwoProportions,
  guardrailOneSidedPValue,
  minimumSampleSizePerArm,
  isReadyToStop,
  classifyResult,
  type ExperimentResult,
} from './stats';

type DB = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BucketCounts {
  participants: number;
  conversions: number;
}

interface ExperimentCounts {
  control: BucketCounts;
  variant: BucketCounts;
}

export interface OutcomeComputationResult {
  experimentId: string;
  action: 'stopped' | 'updated' | 'skipped';
  reason: string;
  result?: ExperimentResult;
  confidence?: number;
  liftPct?: number;
  guardrailBreached?: string;
}

// ---------------------------------------------------------------------------
// Visitor matching query
// ---------------------------------------------------------------------------

/**
 * Count unique assigned visitors and unique converters per bucket.
 *
 * Join strategy: assignment events store session_id = visitorId (Zybit cookie).
 * Conversion events are matched where their session_id equals an assigned visitorId.
 * See the module-level comment for the PostHog bridge limitation.
 */
async function queryBucketCounts(
  db: DB,
  siteId: string,
  experimentId: string,
  primaryMetric: string,
  startedAt: Date,
  endAt: Date,
): Promise<ExperimentCounts> {
  const result = await db.execute<{
    bucket: string;
    participants: string;
    conversions: string;
  }>(sql`
    WITH assignments AS (
      SELECT DISTINCT ON (session_id)
        session_id                         AS visitor_id,
        (properties->>'bucket')            AS bucket,
        occurred_at                        AS assigned_at
      FROM phase1_events
      WHERE type = 'experiment_assignment'
        AND site_id = ${siteId}
        AND (properties->>'experimentId') = ${experimentId}
        AND occurred_at >= ${startedAt}
        AND occurred_at <= ${endAt}
      ORDER BY session_id, occurred_at ASC
    ),
    converters AS (
      SELECT DISTINCT e.session_id
      FROM phase1_events e
      INNER JOIN assignments a ON a.visitor_id = e.session_id
      WHERE e.type = ${primaryMetric}
        AND e.site_id = ${siteId}
        AND e.occurred_at >= a.assigned_at
        AND e.occurred_at <= ${endAt}
    )
    SELECT
      a.bucket,
      COUNT(*)::text          AS participants,
      COUNT(c.session_id)::text AS conversions
    FROM assignments a
    LEFT JOIN converters c ON c.session_id = a.visitor_id
    GROUP BY a.bucket
  `);

  // neon-http returns a result object ({ rows, rowCount, ... }); guard in case
  // a future driver returns the row array directly.
  const rows = Array.isArray(result) ? result : result.rows;

  const counts: ExperimentCounts = {
    control: { participants: 0, conversions: 0 },
    variant: { participants: 0, conversions: 0 },
  };

  for (const row of rows) {
    const bucket = row.bucket === 'control' ? 'control' : 'variant';
    counts[bucket] = {
      participants: parseInt(row.participants, 10),
      conversions: parseInt(row.conversions, 10),
    };
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Guardrail check
// ---------------------------------------------------------------------------

/**
 * For each guardrail metric (event type), check if the variant bucket shows
 * a statistically significant decrease vs the control bucket (one-sided, p < 0.20
 * = 80% confidence). Returns the first guardrail metric that breached, or null.
 */
async function checkGuardrails(
  db: DB,
  siteId: string,
  experimentId: string,
  guardrails: string[],
  startedAt: Date,
  endAt: Date,
): Promise<string | null> {
  for (const metric of guardrails) {
    const counts = await queryBucketCounts(db, siteId, experimentId, metric, startedAt, endAt);
    const p = guardrailOneSidedPValue(
      counts.control.conversions,
      counts.control.participants,
      counts.variant.conversions,
      counts.variant.participants,
    );
    // p < 0.20 → 80% confidence that variant decreased this metric
    if (p !== null && p < 0.20) return metric;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Write outcome row and update experiment status
// ---------------------------------------------------------------------------

async function concludeExperiment(
  db: DB,
  experiment: typeof zybitExperiments.$inferSelect,
  counts: ExperimentCounts,
  result: ExperimentResult,
  confidence: number,
  liftPct: number,
  guardrailBreached: string | null,
  concludedAt: Date,
): Promise<void> {
  const newStatus = guardrailBreached ? 'stopped' : 'completed';

  // Load finding context for the outcome row
  let ruleId: string | null = null;
  let pathRef: string | null = null;
  let modificationType: string | null = null;

  if (experiment.findingId) {
    const findings = await db
      .select({ ruleId: zybitFindings.ruleId, pathRef: zybitFindings.pathRef })
      .from(zybitFindings)
      .where(eq(zybitFindings.id, experiment.findingId))
      .limit(1);
    ruleId = findings[0]?.ruleId ?? null;
    pathRef = findings[0]?.pathRef ?? null;
  }

  const mods = experiment.modifications;
  if (Array.isArray(mods) && mods.length > 0) {
    modificationType = (mods[0] as { type: string }).type ?? null;
  }

  // Sequential writes: the app runs on the neon-http driver, which has no
  // interactive transaction support. Insert the outcome first (the durable
  // record), then flip experiment status — if the second write fails the
  // outcome row still exists and the next cron pass reconciles status.
  await db.insert(zybitExperimentOutcomes).values({
    id: randomUUID(),
    organizationId: experiment.organizationId,
    siteId: experiment.siteId,
    experimentId: experiment.id,
    findingId: experiment.findingId ?? null,
    ruleId,
    pathRef: pathRef ?? experiment.targetPath,
    modificationType,
    result,
    liftPct,
    confidence,
    controlConversions: counts.control.conversions,
    controlParticipants: counts.control.participants,
    variantConversions: counts.variant.conversions,
    variantParticipants: counts.variant.participants,
    guardrailBreached,
    concludedAt,
  });

  await db
    .update(zybitExperiments)
    .set({
      status: newStatus,
      resultControlRate:
        counts.control.participants > 0
          ? counts.control.conversions / counts.control.participants
          : null,
      resultVariantRate:
        counts.variant.participants > 0
          ? counts.variant.conversions / counts.variant.participants
          : null,
      resultConfidence: confidence,
      resultParticipants: counts.control.participants + counts.variant.participants,
      completedAt: concludedAt,
      updatedAt: new Date(),
    })
    .where(eq(zybitExperiments.id, experiment.id));
}

// ---------------------------------------------------------------------------
// PM notification (Zybit-084) — best-effort, never blocks the cron
// ---------------------------------------------------------------------------

async function notifyConcluded(
  db: DB,
  experiment: typeof zybitExperiments.$inferSelect,
  counts: ExperimentCounts,
  result: ExperimentResult,
  confidence: number,
  liftPct: number,
  guardrailBreached: string | null,
): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) return;

    const sites = await db
      .select({ domain: phase1Sites.domain })
      .from(phase1Sites)
      .where(eq(phase1Sites.id, experiment.siteId))
      .limit(1);
    const domain = sites[0]?.domain ?? experiment.siteId;

    const recipients = await db
      .select({ email: appUsers.email })
      .from(appUsers)
      .where(eq(appUsers.organizationId, experiment.organizationId));

    const approved = recipients.map((r) => r.email).filter((e): e is string => Boolean(e));
    if (approved.length === 0) return;

    const controlRate =
      counts.control.participants > 0
        ? counts.control.conversions / counts.control.participants
        : null;
    const variantRate =
      counts.variant.participants > 0
        ? counts.variant.conversions / counts.variant.participants
        : null;

    for (const to of approved) {
      await sendExperimentConcludedEmail({
        to,
        hypothesis: experiment.hypothesis,
        domain,
        result,
        controlRate,
        variantRate,
        liftPct,
        confidence,
        guardrailBreached,
      });
    }
  } catch (err) {
    console.error('[compute-outcomes] PM notification failed (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// Process a single experiment
// ---------------------------------------------------------------------------

export async function processExperiment(
  db: DB,
  experiment: typeof zybitExperiments.$inferSelect,
): Promise<OutcomeComputationResult> {
  const now = new Date();

  const startedAt = experiment.startedAt ?? experiment.createdAt;
  const durationMs = (experiment.durationDays ?? 14) * 24 * 60 * 60 * 1000;
  const endAt = new Date(Math.min(startedAt.getTime() + durationMs, now.getTime()));
  const elapsedDays = (now.getTime() - startedAt.getTime()) / (24 * 60 * 60 * 1000);
  const durationExpired = elapsedDays >= (experiment.durationDays ?? 14);

  // Step 1: Query primary metric counts
  const counts = await queryBucketCounts(
    db,
    experiment.siteId,
    experiment.id,
    experiment.primaryMetric,
    startedAt,
    endAt,
  );

  const totalParticipants = counts.control.participants + counts.variant.participants;

  if (totalParticipants === 0) {
    return {
      experimentId: experiment.id,
      action: 'skipped',
      reason: 'No assignment events found. Proxy may not be routing traffic yet.',
    };
  }

  // Step 2: Statistical test
  const testResult = chiSquaredTwoProportions(
    counts.control.conversions,
    counts.control.participants,
    counts.variant.conversions,
    counts.variant.participants,
  );

  const confidence = testResult?.confidence ?? 0;
  const liftPct = testResult?.liftPct ?? 0;

  // Step 3: Minimum sample size based on observed control rate
  const baseRate =
    counts.control.participants > 0
      ? counts.control.conversions / counts.control.participants
      : 0.05; // default if no conversions yet
  const minPerArm = minimumSampleSizePerArm(baseRate);
  const minTotal = minPerArm * 2;

  // Step 4: Guardrail check (before significance — guardrail breach should stop immediately)
  const guardrails = experiment.guardrails as string[] | null;
  let guardrailBreached: string | null = null;

  if (guardrails && guardrails.length > 0) {
    guardrailBreached = await checkGuardrails(
      db,
      experiment.siteId,
      experiment.id,
      guardrails,
      startedAt,
      endAt,
    );
  }

  if (guardrailBreached) {
    const concludedResult = classifyResult(testResult, false, 0.95);
    await concludeExperiment(
      db, experiment, counts, concludedResult, confidence, liftPct, guardrailBreached, now,
    );
    await notifyConcluded(db, experiment, counts, concludedResult, confidence, liftPct, guardrailBreached);
    return {
      experimentId: experiment.id,
      action: 'stopped',
      reason: `Guardrail breached: ${guardrailBreached}`,
      result: concludedResult,
      confidence,
      liftPct,
      guardrailBreached,
    };
  }

  // Step 5: Sequential testing guard — OBF boundary keyed to elapsed day / total duration.
  const readyToStop = isReadyToStop({
    confidence,
    participants: Math.min(counts.control.participants, counts.variant.participants),
    elapsedDays,
    minimumParticipants: minPerArm,
    durationDays: experiment.durationDays ?? 14,
  });

  if (readyToStop || durationExpired) {
    const concludedResult = classifyResult(testResult, readyToStop, 0.95);
    await concludeExperiment(
      db, experiment, counts, concludedResult, confidence, liftPct, null, now,
    );
    await notifyConcluded(db, experiment, counts, concludedResult, confidence, liftPct, null);
    return {
      experimentId: experiment.id,
      action: 'stopped',
      reason: readyToStop ? 'Significance reached with sufficient sample and elapsed time.' : 'Duration elapsed.',
      result: concludedResult,
      confidence,
      liftPct,
    };
  }

  // Step 6: Not ready to stop — update live result fields only (no status change)
  await db
    .update(zybitExperiments)
    .set({
      resultControlRate:
        counts.control.participants > 0
          ? counts.control.conversions / counts.control.participants
          : null,
      resultVariantRate:
        counts.variant.participants > 0
          ? counts.variant.conversions / counts.variant.participants
          : null,
      resultConfidence: confidence,
      resultParticipants: totalParticipants,
      updatedAt: new Date(),
    })
    .where(eq(zybitExperiments.id, experiment.id));

  return {
    experimentId: experiment.id,
    action: 'updated',
    reason: `Live: ${totalParticipants} participants, confidence ${(confidence * 100).toFixed(1)}% (need ${(0.95 * 100).toFixed(0)}% + ${minTotal} participants + 7 days).`,
    confidence,
    liftPct,
  };
}

// ---------------------------------------------------------------------------
// Process all running experiments (called by the cron)
// ---------------------------------------------------------------------------

export interface ComputeOutcomesSummary {
  processed: number;
  stopped: number;
  updated: number;
  skipped: number;
  errors: number;
  results: OutcomeComputationResult[];
}

export async function computeAllOutcomes(db: DB): Promise<ComputeOutcomesSummary> {
  const running = await db
    .select()
    .from(zybitExperiments)
    .where(eq(zybitExperiments.status, 'running'));

  const summary: ComputeOutcomesSummary = {
    processed: running.length,
    stopped: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  for (const experiment of running) {
    try {
      const result = await processExperiment(db, experiment);
      summary.results.push(result);
      if (result.action === 'stopped') summary.stopped++;
      else if (result.action === 'updated') summary.updated++;
      else summary.skipped++;
    } catch (err) {
      summary.errors++;
      summary.results.push({
        experimentId: experiment.id,
        action: 'skipped',
        reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return summary;
}

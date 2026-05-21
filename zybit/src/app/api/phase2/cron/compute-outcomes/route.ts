/**
 * FORGE-086 — Compute-outcomes cron
 *
 * Runs hourly (configured in vercel.json).
 *
 * For each running experiment:
 *   1. Query assignment events + conversion events, compute per-bucket rates.
 *   2. Run chi-squared significance test with sequential testing guard.
 *   3. Evaluate guardrail metrics.
 *   4. If ready to stop (or duration expired, or guardrail breached):
 *      - Insert row into zybit_experiment_outcomes
 *      - Update experiment status → 'completed' or 'stopped'
 *      - Update result fields on the experiment record
 *   5. Otherwise: update live result fields (confidence, participants) without status change.
 *
 * Sequential testing guard prevents false positives from early stopping:
 *   - confidence >= 0.95 AND
 *   - participants >= minimum sample size (power analysis from base rate) AND
 *   - elapsed days >= 7
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { logger, cronitorPing, withCronAlert } from '@/lib/observability';
import { computeAllOutcomes } from '@/lib/experiments/computeOutcomes';
import { unauthorized } from '@/app/api/phase1/_shared';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONITOR_KEY = 'compute-outcomes';

function assertCronAuth(request: Request): NextResponse | null {
  const secret = process.env.FORGE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CRON_DISABLED',
          message: 'Set FORGE_CRON_SECRET to enable compute-outcomes cron.',
        },
      },
      { status: 503 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return unauthorized('Invalid cron authorization.', 'CRON_UNAUTHORIZED');
  }
  return null;
}

async function runHandler(request: Request): Promise<Response> {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  await cronitorPing(MONITOR_KEY, 'run');

  const db = getDb();
  const startedAt = Date.now();

  try {
    const summary = await computeAllOutcomes(db);

    const elapsed = Date.now() - startedAt;

    logger.info('compute-outcomes cron complete', {
      service: 'compute-outcomes',
      processed: summary.processed,
      stopped: summary.stopped,
      updated: summary.updated,
      skipped: summary.skipped,
      errors: summary.errors,
      elapsedMs: elapsed,
    });

    if (summary.errors > 0) {
      await cronitorPing(
        MONITOR_KEY,
        'fail',
        `${summary.errors} experiments errored. ${summary.stopped} stopped, ${summary.updated} updated.`,
      );
    } else {
      await cronitorPing(
        MONITOR_KEY,
        'complete',
        `${summary.processed} processed: ${summary.stopped} stopped, ${summary.updated} updated.`,
      );
    }

    return NextResponse.json({ success: true, data: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('compute-outcomes cron failed', { service: 'compute-outcomes', error: message });
    await cronitorPing(MONITOR_KEY, 'fail', message);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}

export const POST = withCronAlert('compute-outcomes', runHandler);

/**
 * Zybit-023 — Snapshot refresh cron — runs daily at 03:00 UTC (vercel.json).
 *
 * Scheduled re-fetch of every live page snapshot to detect HTML drift:
 *   1. For each site with a phase2 config, list its page snapshots.
 *   2. Reduce to the latest snapshot per pathRef.
 *   3. Re-fetch each via the stored URL, compare contentHash, upsert.
 *   4. Count drift (content changed) so staleness surfaces in the cockpit.
 *
 * Distinct from `refresh-captures`, which re-runs headless Playwright
 * captures (visual artifacts). This is the lighter HTML/contentHash path
 * built on `runSnapshot` + `upsertPageSnapshot`.
 *
 * A global per-run path cap keeps the job inside maxDuration on large
 * deployments; sites are processed in bounded-concurrency batches.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { phase2SiteConfigs } from '@/lib/db/schema';
import { unauthorized, mapRouteError } from '@/app/api/phase1/_shared';
import { createPhase1Repository } from '@/lib/phase1';
import { normalizePathRef, runSnapshot, SnapshotError } from '@/lib/phase2/snapshots';
import { didDrift, latestSnapshotPerPath } from '@/lib/phase2/snapshots/refresh';
import { logger, cronitorPing } from '@/lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PATHS_PER_SITE = 25;
const MAX_TOTAL_PATHS_PER_RUN = 60; // ~3s per HTTP fetch worst-case ≈ 180s; fits in 300s
const CRON_CONCURRENCY = 4;
const MONITOR_KEY = 'refresh-snapshots';

function assertCronAuth(request: Request): NextResponse | null {
  const secret = process.env.FORGE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: { code: 'CRON_DISABLED', message: 'Set FORGE_CRON_SECRET to enable cron.' } },
      { status: 503 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return unauthorized('Invalid cron authorization.', 'CRON_UNAUTHORIZED');
  }
  return null;
}

interface SiteResult {
  siteId: string;
  refreshed: number;
  drifted: number;
  failed: number;
  error?: string;
}

async function refreshSiteSnapshots(
  organizationId: string,
  siteId: string,
  maxPaths: number,
): Promise<Omit<SiteResult, 'siteId'>> {
  const repository = createPhase1Repository();

  const snapshots = await repository.listPageSnapshots({
    organizationId,
    siteId,
    limit: MAX_PATHS_PER_SITE,
  });
  if (snapshots.length === 0) return { refreshed: 0, drifted: 0, failed: 0 };

  // contentHash lives on the snapshot's parsed `data`, not as a top-level field.
  const refreshable = snapshots.map((s) => ({
    pathRef: s.pathRef,
    url: s.url,
    contentHash: s.data.contentHash,
    fetchedAt: s.fetchedAt,
  }));
  const targets = latestSnapshotPerPath(refreshable).slice(0, maxPaths);

  let refreshed = 0;
  let drifted = 0;
  let failed = 0;

  for (const snapshot of targets) {
    try {
      const fetched = await runSnapshot(snapshot.url, { respectRobots: true });
      const pathRef = normalizePathRef(fetched.finalUrl);
      if (didDrift(snapshot.contentHash, fetched.data.contentHash)) drifted++;
      await repository.upsertPageSnapshot({
        organizationId,
        siteId,
        pathRef,
        url: fetched.finalUrl,
        data: fetched.data,
        fetchedAt: new Date(fetched.data.parsedAt),
      });
      refreshed++;
    } catch (err) {
      failed++;
      logger.warn('snapshot.refresh.path_failed', {
        service: 'snapshot-cron',
        siteId,
        pathRef: snapshot.pathRef,
        code: err instanceof SnapshotError ? err.code : 'UNKNOWN',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { refreshed, drifted, failed };
}

async function runHandler(request: Request) {
  await cronitorPing(MONITOR_KEY, 'run');
  logger.info('snapshot.refresh.started', { service: 'snapshot-cron' });

  try {
    const authErr = assertCronAuth(request);
    if (authErr) {
      await cronitorPing(MONITOR_KEY, 'fail', 'auth failed');
      return authErr;
    }

    const repository = createPhase1Repository();
    if (repository.driver !== 'postgres') {
      await cronitorPing(MONITOR_KEY, 'complete', 'skipped — not postgres');
      return NextResponse.json({
        success: true,
        data: { skipped: true, reason: 'Postgres driver required for scheduled refresh.' },
      });
    }

    const db = getDb();
    const configs = await db
      .select({ siteId: phase2SiteConfigs.siteId, organizationId: phase2SiteConfigs.organizationId })
      .from(phase2SiteConfigs);

    if (configs.length === 0) {
      await cronitorPing(MONITOR_KEY, 'complete', 'no sites');
      return NextResponse.json({ success: true, data: { sites: 0, results: [] } });
    }

    const results: SiteResult[] = [];
    let globalRemaining = MAX_TOTAL_PATHS_PER_RUN;

    for (let i = 0; i < configs.length && globalRemaining > 0; i += CRON_CONCURRENCY) {
      const chunk = configs.slice(i, i + CRON_CONCURRENCY);
      const pathsPerSite = Math.max(1, Math.floor(globalRemaining / chunk.length));

      const settled = await Promise.allSettled(
        chunk.map(async (cfg) => {
          const outcome = await refreshSiteSnapshots(cfg.organizationId, cfg.siteId, pathsPerSite);
          return { siteId: cfg.siteId, ...outcome };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          globalRemaining -= outcome.value.refreshed;
        } else {
          const err = outcome.reason;
          results.push({
            siteId: 'unknown',
            refreshed: 0,
            drifted: 0,
            failed: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const totalDrifted = results.reduce((s, r) => s + r.drifted, 0);
    logger.info('snapshot.refresh.done', {
      service: 'snapshot-cron',
      sites: configs.length,
      totalDrifted,
    });
    await cronitorPing(MONITOR_KEY, 'complete');

    return NextResponse.json({ success: true, data: { sites: configs.length, results } });
  } catch (error) {
    await cronitorPing(MONITOR_KEY, 'fail', error instanceof Error ? error.message : 'unknown');
    return mapRouteError(error);
  }
}

export const GET = runHandler;
export const POST = runHandler;

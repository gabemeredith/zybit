/**
 * Nightly capture refresh cron — runs at 02:00 UTC (configured in vercel.json).
 *
 * For each site that has a phase2 config:
 *   1. Fetch the most recent page snapshots to get the set of known URLs.
 *   2. Skip paths that have a capture fresher than 23 hours (already warm).
 *   3. Re-capture stale paths up to MAX_PATHS_PER_SITE, respecting budget.
 *
 * Concurrency model:
 *   - Sites are resolved in parallel, then processed in batches of CRON_CONCURRENCY.
 *   - A global cap of MAX_TOTAL_PATHS_PER_RUN prevents timeout on large deployments.
 *   - Each batch of sites gets an equal share of the remaining path budget.
 *
 * This keeps the headless artifact corpus fresh so audit rules always have
 * real measurements to work with, without burning budget on pages that were
 * recently captured on-demand.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { phase2SiteConfigs } from '@/lib/db/schema';
import { unauthorized, mapRouteError } from '@/app/api/phase1/_shared';
import { createPhase1Repository } from '@/lib/phase1';
import { capturePageAllBreakpoints, checkBudget, isCaptureV2Enabled, recordCaptureSpend } from '@/lib/phase2/capture';
import { createCaptureRepository } from '@/lib/phase2/capture/repository';
import { logger, cronitorPing, withCronAlert } from '@/lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PATHS_PER_SITE = 10;
const MAX_TOTAL_PATHS_PER_RUN = 15; // ~15s per path worst-case = ~225s; fits in 300s
const CRON_CONCURRENCY = 3;
const STALE_HOURS = 23;
const MONITOR_KEY = 'refresh-captures';

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
  captured: number;
  skipped: number;
  costUsd: number;
  error?: string;
}

async function refreshSite(
  siteId: string,
  organizationId: string,
  siteUrl: string,
  maxPaths: number,
): Promise<Omit<SiteResult, 'siteId'>> {
  const repository = createPhase1Repository();
  const captureRepo = createCaptureRepository();

  const snapshots = await repository.listPageSnapshots({
    organizationId,
    siteId,
    limit: MAX_PATHS_PER_SITE,
  });
  if (snapshots.length === 0) return { captured: 0, skipped: 0, costUsd: 0 };

  const recentCaptures = await captureRepo.listRecentPageCaptures({
    organizationId,
    siteId,
    sinceHours: STALE_HOURS,
    limit: 200,
  });
  const warmPaths = new Set(recentCaptures.map(c => c.pathRef));

  const stalePaths = snapshots
    .filter(s => !warmPaths.has(s.pathRef))
    .slice(0, maxPaths);

  if (stalePaths.length === 0) return { captured: 0, skipped: snapshots.length, costUsd: 0 };

  const budget = await checkBudget(siteId);
  if (budget.isExceeded) {
    logger.warn('capture.refresh.budget_exceeded', { service: 'capture-cron', siteId });
    return { captured: 0, skipped: stalePaths.length, costUsd: 0 };
  }

  const runId = randomUUID();
  const runStartedAt = new Date();

  await captureRepo.upsertCaptureRun({
    id: runId,
    organizationId,
    siteId,
    status: 'running',
    totalPaths: stalePaths.length,
    startedAt: runStartedAt,
  });

  let captured = 0;
  let totalCost = 0;

  for (const snapshot of stalePaths) {
    const currentBudget = await checkBudget(siteId);
    if (currentBudget.isExceeded) break;

    try {
      const url = siteUrl.replace(/\/$/, '') + snapshot.pathRef;
      const summary = await capturePageAllBreakpoints({
        siteId,
        organizationId,
        url,
        pathRef: snapshot.pathRef,
        runId,
      });

      for (const capture of summary.captures) {
        await captureRepo.insertPageCapture({
          id: randomUUID(),
          organizationId,
          siteId,
          runId,
          pathRef: capture.pathRef,
          capture,
        });
      }

      if (summary.totalCostUsd > 0) {
        await recordCaptureSpend(siteId, organizationId, summary.totalCostUsd);
      }

      totalCost += summary.totalCostUsd;
      if (summary.captures.length > 0) captured++;
    } catch (err) {
      logger.warn('capture.refresh.path_failed', {
        service: 'capture-cron',
        siteId,
        pathRef: snapshot.pathRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const finalStatus: 'completed' | 'partial' | 'failed' =
    captured === 0 ? 'failed' : captured < stalePaths.length ? 'partial' : 'completed';
  await captureRepo.upsertCaptureRun({
    id: runId,
    organizationId,
    siteId,
    status: finalStatus,
    totalPaths: stalePaths.length,
    completedPaths: captured,
    failedPaths: stalePaths.length - captured,
    totalCostUsd: totalCost,
    startedAt: runStartedAt,
    completedAt: new Date(),
  });

  return { captured, skipped: snapshots.length - stalePaths.length, costUsd: totalCost };
}

async function runHandler(request: Request) {
  await cronitorPing(MONITOR_KEY, 'run');
  logger.info('capture.refresh.started', { service: 'capture-cron' });

  try {
    const authErr = assertCronAuth(request);
    if (authErr) {
      await cronitorPing(MONITOR_KEY, 'fail', 'auth failed');
      return authErr;
    }

    const flagEnabled = await isCaptureV2Enabled();
    if (!flagEnabled) {
      await cronitorPing(MONITOR_KEY, 'complete', 'feature disabled');
      return NextResponse.json({ success: true, data: { skipped: true, reason: 'capture_v2_enabled flag is off' } });
    }

    const db = getDb();
    const configs = await db
      .select({ siteId: phase2SiteConfigs.siteId, organizationId: phase2SiteConfigs.organizationId })
      .from(phase2SiteConfigs);

    if (configs.length === 0) {
      await cronitorPing(MONITOR_KEY, 'complete', 'no sites');
      return NextResponse.json({ success: true, data: { sites: 0 } });
    }

    // Resolve all site URLs in parallel before capture starts
    const repository = createPhase1Repository();
    interface SiteWithUrl { siteId: string; organizationId: string; siteUrl: string }

    const [sitesWithUrls, noUrlResults] = await (async () => {
      const withUrl: SiteWithUrl[] = [];
      const noUrl: SiteResult[] = [];
      await Promise.all(
        configs.map(async (cfg) => {
          const integrations = await repository.listIntegrations({
            organizationId: cfg.organizationId,
            siteId: cfg.siteId,
          });
          const url =
            (integrations[0]?.config?.['siteUrl'] as string | undefined) ??
            process.env.CAPTURE_SITE_URL_OVERRIDE;
          if (!url) {
            noUrl.push({ siteId: cfg.siteId, captured: 0, skipped: 0, costUsd: 0, error: 'no_site_url' });
          } else {
            withUrl.push({ siteId: cfg.siteId, organizationId: cfg.organizationId, siteUrl: url });
          }
        }),
      );
      return [withUrl, noUrl] as const;
    })();

    const results: SiteResult[] = [...noUrlResults];
    let globalRemaining = MAX_TOTAL_PATHS_PER_RUN;

    // Process sites in parallel batches; stop when the global cap is consumed
    for (let i = 0; i < sitesWithUrls.length && globalRemaining > 0; i += CRON_CONCURRENCY) {
      const chunk = sitesWithUrls.slice(i, i + CRON_CONCURRENCY);
      const pathsPerSite = Math.max(1, Math.floor(globalRemaining / chunk.length));

      const settled = await Promise.allSettled(
        chunk.map(async (site) => {
          const outcome = await refreshSite(
            site.siteId,
            site.organizationId,
            site.siteUrl,
            pathsPerSite,
          );
          return { siteId: site.siteId, ...outcome };
        }),
      );

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          globalRemaining -= outcome.value.captured;
        } else {
          // Surface unexpected rejection without aborting the whole run
          const err = outcome.reason;
          results.push({
            siteId: 'unknown',
            captured: 0,
            skipped: 0,
            costUsd: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const totalCaptured = results.reduce((s, r) => s + r.captured, 0);
    logger.info('capture.refresh.done', { service: 'capture-cron', sites: configs.length, totalCaptured });
    await cronitorPing(MONITOR_KEY, 'complete');

    return NextResponse.json({ success: true, data: { sites: configs.length, results } });
  } catch (error) {
    await cronitorPing(MONITOR_KEY, 'fail', error instanceof Error ? error.message : 'unknown');
    return mapRouteError(error);
  }
}

export const GET = withCronAlert('refresh-captures', runHandler);
export const POST = withCronAlert('refresh-captures', runHandler);

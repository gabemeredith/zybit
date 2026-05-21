/**
 * FORGE-020 — PostHog pull-sync cron + volume-triggered insights
 *
 * Runs every 30 minutes (configured in vercel.json).
 *
 * For each active PostHog integration:
 *   1. Pull new events from PostHog into phase1_events.
 *   2. If new-session volume since the last run crosses the per-site
 *      threshold, re-run the Phase 2 insights pipeline and upsert findings.
 *
 * The session-threshold logic lives in `jobs/insightsTrigger.ts` and is
 * shared verbatim with the GA4 cron.
 */

import { NextResponse } from 'next/server';
import { createPhase1Repository } from '@/lib/phase1';
import { mapRouteError, unauthorized } from '@/app/api/phase1/_shared';
import { runPostHogPullSyncJob } from '@/lib/phase2/jobs/runPostHogPullSyncJob';
import { maybeRunInsightsForSite } from '@/lib/phase2/jobs/insightsTrigger';
import { logger, cronitorPing, trackSyncResult, withCronAlert } from '@/lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 300;

function assertCronAuth(request: Request): NextResponse | null {
  const secret = process.env.FORGE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CRON_DISABLED',
          message: 'Set FORGE_CRON_SECRET to enable scheduled PostHog sync.',
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

async function runHandler(request: Request) {
  const cronService = 'cron-sync' as const;
  const monitorKey = 'sync-posthog';

  await cronitorPing(monitorKey, 'run');
  logger.info('started', { service: cronService });

  try {
    const authErr = assertCronAuth(request);
    if (authErr) {
      await cronitorPing(monitorKey, 'fail', 'auth failed');
      return authErr;
    }

    const repository = createPhase1Repository();
    if (repository.driver !== 'postgres') {
      await cronitorPing(monitorKey, 'complete', 'skipped — not postgres');
      return NextResponse.json({
        success: true,
        data: {
          skipped: true,
          reason: 'Postgres driver required for scheduled multi-tenant sync.',
        },
      });
    }

    const allIntegrations = await repository.listIntegrationsByProvider({
      provider: 'posthog',
      limit: 50,
    });

    // Zybit-154 circuit breaker: a 'disconnected' integration has tripped the
    // consecutive-failure threshold (errorBudget.ts). Skip it — retrying every
    // 30 minutes forever burns provider quota and never self-heals. A PM must
    // hit the resume route to clear the breaker.
    const integrations = allIntegrations.filter((i) => i.status !== 'disconnected');
    const pausedCount = allIntegrations.length - integrations.length;

    type IntegrationResult = {
      id: string;
      siteId: string;
      organizationId: string;
      syncOk: boolean;
      syncInserted?: number;
      insightsTriggered: boolean;
      insightsSynced?: number;
      sessionDelta?: number;
      code?: string;
      message?: string;
    };

    async function processIntegration(
      integration: (typeof integrations)[number],
    ): Promise<IntegrationResult> {
      const { siteId, organizationId } = integration;

      const syncOutcome = await runPostHogPullSyncJob({
        repository,
        integration,
        maxEvents: 5000,
      });

      if (!syncOutcome.ok) {
        await trackSyncResult(integration.id, false, syncOutcome.code);
        logger.warn('sync failed for integration', {
          service: cronService,
          integrationId: integration.id,
          siteId,
          organizationId,
          code: syncOutcome.code,
        });
        return {
          id: integration.id,
          siteId,
          organizationId,
          syncOk: false,
          insightsTriggered: false,
          code: syncOutcome.code,
          message: syncOutcome.message,
        };
      }

      const insights = await maybeRunInsightsForSite({ organizationId, siteId });

      return {
        id: integration.id,
        siteId,
        organizationId,
        syncOk: true,
        syncInserted: syncOutcome.report.inserted,
        insightsTriggered: insights.insightsTriggered,
        insightsSynced: insights.insightsSynced,
        sessionDelta: insights.sessionDelta,
      };
    }

    const CONCURRENCY = 5;
    const results: IntegrationResult[] = [];
    for (let i = 0; i < integrations.length; i += CONCURRENCY) {
      const chunk = integrations.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(processIntegration));
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
        } else {
          results.push({
            id: 'unknown',
            siteId: 'unknown',
            organizationId: 'unknown',
            syncOk: false,
            insightsTriggered: false,
            code: 'INTERNAL_ERROR',
            message:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          });
        }
      }
    }

    return NextResponse.json({ success: true, data: { synced: results.length, pausedCount, results } });
  } catch (error) {
    return mapRouteError(error);
  }
}

export const GET = withCronAlert('sync-posthog', runHandler);
export const POST = withCronAlert('sync-posthog', runHandler);

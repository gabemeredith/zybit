/**
 * GET /api/phase2/sites/:siteId/flow-preflight?days=7
 *
 * Answers PRD §5's one hard dependency: does this customer's already-ingested
 * analytics carry enough signal to render an informative flow graph? Pulls the
 * windowed canonical events from `phase1_events`, runs `computeFlowPreflight`,
 * and returns a PM-readable readiness verdict.
 *
 * Read-only. Used by the post-connect verification step in onboarding and by
 * the empty-state on /app/flow when the graph is sparse.
 */

import { createPhase1Repository } from '@/lib/phase1';
import {
  badRequest,
  mapRouteError,
  success,
} from '@/app/api/phase1/_shared';
import {
  assertApiKeyHasAnyScope,
  resolveZybitActor,
} from '@/lib/auth/actor';
import { assertSiteInOrganization } from '@/lib/auth/tenantScope';
import { computeFlowPreflight } from '@/lib/phase2/flow';
import type { TimeWindow } from '@/lib/phase2/types';

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

const DEFAULT_WINDOW_DAYS = 7;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 30;
/** Hard cap on rows read so a chatty PostHog account does not stall the route. */
const EVENT_LIMIT = 20_000;

function parseDays(raw: string | null): number {
  if (!raw) return DEFAULT_WINDOW_DAYS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(n, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS);
}

function buildWindow(days: number): TimeWindow {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { siteId } = await context.params;
    if (!siteId) {
      return badRequest('`siteId` is required.');
    }

    const actorResult = await resolveZybitActor(request, { allowQueryFallback: true });
    if (!actorResult.ok) {
      return actorResult.response;
    }
    const scopeErr = assertApiKeyHasAnyScope(actorResult.actor, [
      'integrations:manage',
      'insights:run',
    ]);
    if (scopeErr) return scopeErr;

    const url = new URL(request.url);
    const days = parseDays(url.searchParams.get('days'));
    const window = buildWindow(days);

    const repository = createPhase1Repository();
    const siteGate = await assertSiteInOrganization({
      repository,
      organizationId: actorResult.actor.organizationId,
      siteId,
    });
    if (!siteGate.ok) return siteGate.response;

    const events = await repository.listEventsInWindow({
      organizationId: actorResult.actor.organizationId,
      siteId,
      window,
      limit: EVENT_LIMIT,
    });

    const report = computeFlowPreflight({
      events,
      windowStart: window.start,
      windowEnd: window.end,
    });

    return success({ siteId, windowDays: days, report });
  } catch (error) {
    return mapRouteError(error);
  }
}

export const runtime = 'nodejs';

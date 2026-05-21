/**
 * POST /api/phase2/integrations/:id/resume
 *
 * Clears a tripped circuit breaker (Zybit-154). When an integration fails
 * enough consecutive syncs it is marked 'disconnected' (errorBudget.ts) and
 * the sync crons skip it so it stops retrying every 30 minutes forever.
 *
 * This route resets it to 'active' with consecutiveFailures = 0. The next
 * scheduled cron run resumes syncing.
 */

import {
  badRequest,
  mapRouteError,
  parseJsonObject,
  success,
} from '@/app/api/phase1/_shared';
import { resolveZybitActor, assertApiKeyHasScope } from '@/lib/auth/actor';
import { assertIntegrationScopedToOrganization } from '@/lib/auth/tenantScope';
import { createPhase1Repository } from '@/lib/phase1';
import { trackSyncResult } from '@/lib/observability';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return badRequest('`id` is required.');
    }

    const parsed = await parseJsonObject(request).catch(() => null);
    const body = parsed && parsed.ok ? parsed.value : {};

    const actorResult = await resolveZybitActor(request, {
      bodyOrganizationId: body.organizationId,
      allowQueryFallback: false,
    });
    if (!actorResult.ok) {
      return actorResult.response;
    }
    const scopeErr = assertApiKeyHasScope(actorResult.actor, 'integrations:manage');
    if (scopeErr) return scopeErr;

    const repository = createPhase1Repository();
    const integrationRow = await repository.getIntegration({
      organizationId: actorResult.actor.organizationId,
      id,
    });
    const scoped = assertIntegrationScopedToOrganization(
      integrationRow,
      actorResult.actor.organizationId,
    );
    if (!scoped.ok) {
      return scoped.response;
    }

    // Reuse the sync-success path: resets consecutiveFailures = 0,
    // status = 'active', lastErrorCode = null. The next scheduled cron run
    // picks the integration back up.
    await trackSyncResult(scoped.integration.id, true);

    return success({ id: scoped.integration.id, status: 'active', resumed: true });
  } catch (error) {
    return mapRouteError(error);
  }
}

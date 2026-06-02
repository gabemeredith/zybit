/**
 * GET /api/billing/usage
 *
 * Returns current-month usage counters for the authenticated org.
 */

import { resolveZybitActor } from '@/lib/auth/actor';
import { getUsage } from '@/lib/billing/usage';
import { checkPlanLimit } from '@/lib/billing/checkPlanLimit';
import { mapRouteError, success } from '@/app/api/phase1/_shared';

export async function GET(request: Request) {
  try {
    const actorResult = await resolveZybitActor(request, { allowQueryFallback: true });
    if (!actorResult.ok) return actorResult.response;

    const orgId = actorResult.actor.organizationId;
    const [usage, sites, events, experiments] = await Promise.all([
      getUsage(orgId),
      checkPlanLimit(orgId, 'sites'),
      checkPlanLimit(orgId, 'events'),
      checkPlanLimit(orgId, 'experiments'),
    ]);

    // Events are soft-capped: over-limit is surfaced here (and in settings)
    // but ingestion is never dropped — dropping a paying customer's data
    // would also corrupt the experiment-outcome join.
    return success({
      ...usage,
      plan: events.plan,
      limits: {
        sites: { current: sites.current, limit: sites.limit, overLimit: !sites.allowed },
        events: { current: events.current, limit: events.limit, overLimit: !events.allowed },
        experiments: {
          current: experiments.current,
          limit: experiments.limit,
          overLimit: !experiments.allowed,
        },
      },
    });
  } catch (error) {
    return mapRouteError(error);
  }
}

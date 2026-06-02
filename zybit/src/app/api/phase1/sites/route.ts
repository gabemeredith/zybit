import { randomUUID } from 'crypto';
import { createPhase1Repository } from '@/lib/phase1';
import {
  badRequest,
  mapRouteError,
  parseJsonObject,
  parseOptionalString,
  parsePositiveInt,
  parseString,
  planLimitExceeded,
  success,
} from '../_shared';
import { assertApiKeyHasAnyScope, assertApiKeyHasScope, resolveZybitActor } from '@/lib/auth/actor';
import { checkPlanLimit } from '@/lib/billing/checkPlanLimit';

export async function POST(request: Request) {
  try {
    const parsed = await parseJsonObject(request);
    if (!parsed.ok) {
      return badRequest(parsed.message);
    }
    const body = parsed.value;

    const name = parseString(body.name);
    if (!name) {
      return badRequest('`name` is required and must be a non-empty string.');
    }

    const domain = parseString(body.domain);
    if (!domain) {
      return badRequest('`domain` is required and must be a non-empty string.');
    }

    const analyticsProvider = parseOptionalString(body.analyticsProvider);
    const actorResult = await resolveZybitActor(request, {
      bodyOrganizationId: body.organizationId,
      allowQueryFallback: false,
    });
    if (!actorResult.ok) {
      return actorResult.response;
    }
    const scopeErr = assertApiKeyHasScope(actorResult.actor, 'integrations:manage');
    if (scopeErr) return scopeErr;

    const limit = await checkPlanLimit(actorResult.actor.organizationId, 'sites');
    if (!limit.allowed) {
      return planLimitExceeded('sites', limit);
    }

    const repository = createPhase1Repository();
    const site = {
      id: randomUUID(),
      organizationId: actorResult.actor.organizationId,
      name,
      domain: domain.toLowerCase(),
      createdAt: new Date().toISOString(),
      ...(analyticsProvider ? { analyticsProvider } : {}),
    };

    const created = await repository.createSite(site);
    return success(created, 201);
  } catch (error) {
    return mapRouteError(error);
  }
}

export async function GET(request: Request) {
  try {
    const actorResult = await resolveZybitActor(request, { allowQueryFallback: true });
    if (!actorResult.ok) {
      return actorResult.response;
    }
    const scopeErr = assertApiKeyHasAnyScope(actorResult.actor, [
      'integrations:manage',
      'insights:run',
      'events:write',
    ]);
    if (scopeErr) return scopeErr;

    const repository = createPhase1Repository();
    const url = new URL(request.url);
    const limit = parsePositiveInt(url.searchParams.get('limit'), 50, 200);
    const sites = await repository.listSites({ organizationId: actorResult.actor.organizationId, limit });
    return success(sites);
  } catch (error) {
    return mapRouteError(error);
  }
}

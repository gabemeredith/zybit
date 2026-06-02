/**
 * FORGE-067/068 — Dashboard: Experiments API
 *
 * GET  /api/dashboard/experiments?siteId=...&status=running
 * POST /api/dashboard/experiments  → create experiment (optionally from a finding)
 */

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { badRequest, freeExperimentUsed, mapRouteError, parseJsonObject, parseString, planLimitExceeded, success } from '@/app/api/phase1/_shared';
import { checkPlanLimit } from '@/lib/billing/checkPlanLimit';
import { loadFreeExperimentGate, claimFreeExperimentSlot } from '@/lib/billing/freeExperimentGate';
import { resolveZybitActor } from '@/lib/auth/actor';
import { getDb } from '@/lib/db/client';
import { zybitExperiments, zybitFindings } from '@/lib/db/schema';
import { assertSiteInOrganization } from '@/lib/auth/tenantScope';
import { createPhase1Repository } from '@/lib/phase1';
import { DEMO_ORG_ID } from '@/lib/demo/constants';
import type { VariantModification } from '@/lib/experiments/types';
import { validateModifications } from '@/lib/experiments/types';

const VALID_STATUSES = ['draft', 'running', 'completed', 'stopped'] as const;

export async function GET(request: Request) {
  try {
    const actorResult = await resolveZybitActor(request, { allowQueryFallback: true });
    if (!actorResult.ok) return actorResult.response;

    const url = new URL(request.url);
    const siteId = parseString(url.searchParams.get('siteId'));
    if (!siteId) return badRequest('`siteId` query param is required.');

    const statusParam = url.searchParams.get('status');
    const statusFilter =
      statusParam && VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])
        ? statusParam
        : null;

    const repository = createPhase1Repository();
    const siteGate = await assertSiteInOrganization({
      repository,
      organizationId: actorResult.actor.organizationId,
      siteId,
    });
    if (!siteGate.ok) return siteGate.response;

    const db = getDb();
    const conditions = [eq(zybitExperiments.siteId, siteId)];
    if (statusFilter) conditions.push(eq(zybitExperiments.status, statusFilter));

    const rows = await db
      .select()
      .from(zybitExperiments)
      .where(and(...conditions))
      .orderBy(desc(zybitExperiments.createdAt))
      .limit(50);

    return success(rows);
  } catch (error) {
    return mapRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = await parseJsonObject(request);
    if (!parsed.ok) return badRequest(parsed.message);
    const body = parsed.value;

    const siteId = parseString(body.siteId);
    if (!siteId) return badRequest('`siteId` is required.');

    const hypothesis = parseString(body.hypothesis);
    if (!hypothesis) return badRequest('`hypothesis` is required.');

    const primaryMetric = parseString(body.primaryMetric);
    if (!primaryMetric) return badRequest('`primaryMetric` is required.');

    const actorResult = await resolveZybitActor(request, {
      bodyOrganizationId: body.organizationId,
      allowQueryFallback: false,
    });
    if (!actorResult.ok) return actorResult.response;

    const repository = createPhase1Repository();
    const siteGate = await assertSiteInOrganization({
      repository,
      organizationId: actorResult.actor.organizationId,
      siteId,
    });
    if (!siteGate.ok) return siteGate.response;

    // Optional: link to a finding and mark it approved
    const findingId = parseString(body.findingId) ?? null;
    const db = getDb();

    if (findingId) {
      await db
        .update(zybitFindings)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(
          and(
            eq(zybitFindings.id, findingId),
            eq(zybitFindings.organizationId, actorResult.actor.organizationId)
          )
        );
    }

    const durationDays = typeof body.durationDays === 'number'
      ? Math.min(Math.max(1, Math.floor(body.durationDays)), 365)
      : 14;

    const controlPct = typeof body.audienceControlPct === 'number'
      ? Math.min(Math.max(1, body.audienceControlPct), 99)
      : 50;

    // Validate modifications array if provided
    let modifications: VariantModification[] | null = null;
    if (body.modifications !== undefined) {
      const errorMsg = validateModifications(body.modifications);
      if (errorMsg) return badRequest(errorMsg);
      modifications = body.modifications as VariantModification[];
    }

    const targetPath = parseString(body.targetPath) ?? null;

    const now = new Date();
    const startNow = body.startImmediately === true;

    // Gating only applies to experiments that start running immediately;
    // drafts don't consume a slot.
    if (startNow) {
      const orgId = actorResult.actor.organizationId;

      // Free-experiment gate (§6): an unpaid org gets exactly one experiment,
      // then must upgrade. Checked + claimed before the insert so two
      // concurrent launches can't both consume the single free slot. The demo
      // org is exempt — it stages several experiments by design.
      if (orgId !== DEMO_ORG_ID) {
        const gate = await loadFreeExperimentGate(orgId);
        if (!gate.allowed) return freeExperimentUsed();
        if (gate.reason === 'free-slot-available' && !(await claimFreeExperimentSlot(orgId, now))) {
          return freeExperimentUsed();
        }
      }

      const limit = await checkPlanLimit(orgId, 'experiments');
      if (!limit.allowed) {
        return planLimitExceeded('concurrent experiments', limit);
      }
    }

    const [experiment] = await db
      .insert(zybitExperiments)
      .values({
        id: randomUUID(),
        organizationId: actorResult.actor.organizationId,
        siteId,
        findingId,
        hypothesis,
        primaryMetric,
        primaryMetricSource: parseString(body.primaryMetricSource) ?? 'posthog',
        audienceControlPct: controlPct,
        audienceVariantPct: 100 - controlPct,
        durationDays,
        status: startNow ? 'running' : 'draft',
        externalUrl: parseString(body.externalUrl) ?? null,
        externalProvider: parseString(body.externalProvider) ?? null,
        externalId: parseString(body.externalId) ?? null,
        guardrails: Array.isArray(body.guardrails) ? body.guardrails.map(String) : null,
        notes: parseString(body.notes) ?? null,
        modifications,
        targetPath,
        startedAt: startNow ? now : null,
      })
      .returning();

    return success(experiment, 201);
  } catch (error) {
    return mapRouteError(error);
  }
}

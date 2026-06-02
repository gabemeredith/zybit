/**
 * FORGE-067/069 — Dashboard: Single experiment CRUD
 *
 * GET   /api/dashboard/experiments/[id]
 * PATCH /api/dashboard/experiments/[id]  → update status, results, external link
 */

import { and, eq } from 'drizzle-orm';
import { badRequest, forbidden, mapRouteError, parseJsonObject, parseString, success } from '@/app/api/phase1/_shared';
import { resolveZybitActor } from '@/lib/auth/actor';
import { getDb } from '@/lib/db/client';
import { zybitExperiments, zybitFindings } from '@/lib/db/schema';
import type { VariantModification } from '@/lib/experiments/types';
import { validateModifications } from '@/lib/experiments/types';
import { disableExperimentAtEdge } from '@/lib/experiments/proxy/edgeKillSwitch';

const VALID_STATUSES = ['draft', 'running', 'completed', 'stopped'] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actorResult = await resolveZybitActor(request, { allowQueryFallback: true });
    if (!actorResult.ok) return actorResult.response;

    const db = getDb();
    const rows = await db
      .select()
      .from(zybitExperiments)
      .where(
        and(
          eq(zybitExperiments.id, id),
          eq(zybitExperiments.organizationId, actorResult.actor.organizationId)
        )
      )
      .limit(1);

    if (rows.length === 0) return forbidden('Experiment not found.', 'NOT_FOUND');

    // Optionally join the source finding
    const exp = rows[0];
    let finding = null;
    if (exp.findingId) {
      const fr = await db
        .select()
        .from(zybitFindings)
        .where(eq(zybitFindings.id, exp.findingId))
        .limit(1);
      finding = fr[0] ?? null;
    }

    return success({ ...exp, finding });
  } catch (error) {
    return mapRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = await parseJsonObject(request);
    if (!parsed.ok) return badRequest(parsed.message);
    const body = parsed.value;

    const actorResult = await resolveZybitActor(request, {
      bodyOrganizationId: body.organizationId,
      allowQueryFallback: false,
    });
    if (!actorResult.ok) return actorResult.response;

    const db = getDb();
    const existing = await db
      .select()
      .from(zybitExperiments)
      .where(
        and(
          eq(zybitExperiments.id, id),
          eq(zybitExperiments.organizationId, actorResult.actor.organizationId)
        )
      )
      .limit(1);

    if (existing.length === 0) return forbidden('Experiment not found.', 'NOT_FOUND');

    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };

    if (body.status !== undefined) {
      const s = parseString(body.status);
      if (!s || !VALID_STATUSES.includes(s as (typeof VALID_STATUSES)[number])) {
        return badRequest(`\`status\` must be one of: ${VALID_STATUSES.join(', ')}.`);
      }
      update.status = s;
      if (s === 'running' && !existing[0].startedAt) update.startedAt = now;
      if (s === 'completed' || s === 'stopped') update.completedAt = now;
    }

    if (body.hypothesis !== undefined) update.hypothesis = parseString(body.hypothesis) ?? existing[0].hypothesis;
    if (body.externalUrl !== undefined) update.externalUrl = parseString(body.externalUrl) ?? null;
    if (body.externalProvider !== undefined) update.externalProvider = parseString(body.externalProvider) ?? null;
    if (body.externalId !== undefined) update.externalId = parseString(body.externalId) ?? null;
    if (body.notes !== undefined) update.notes = parseString(body.notes) ?? null;

    // Modifications + target path
    if (body.modifications !== undefined) {
      if (body.modifications === null) {
        update.modifications = null;
      } else {
        const errorMsg = validateModifications(body.modifications);
        if (errorMsg) return badRequest(errorMsg);
        update.modifications = body.modifications as VariantModification[];
      }
    }
    if (body.targetPath !== undefined) update.targetPath = parseString(body.targetPath) ?? null;

    // Results update
    if (typeof body.resultControlRate === 'number') update.resultControlRate = body.resultControlRate;
    if (typeof body.resultVariantRate === 'number') update.resultVariantRate = body.resultVariantRate;
    if (typeof body.resultConfidence === 'number') update.resultConfidence = body.resultConfidence;
    if (typeof body.resultParticipants === 'number') update.resultParticipants = Math.floor(body.resultParticipants);

    await db.update(zybitExperiments).set(update as Partial<typeof zybitExperiments.$inferInsert>).where(eq(zybitExperiments.id, id));

    // Fail closed at the edge the moment an experiment stops (Zybit-116).
    if (update.status === 'stopped' || update.status === 'completed') {
      await disableExperimentAtEdge(id);
    }

    const updated = await db
      .select()
      .from(zybitExperiments)
      .where(eq(zybitExperiments.id, id))
      .limit(1);

    // If experiment completed, mark the linked finding as measured
    if (
      (update.status === 'completed') &&
      updated[0]?.findingId
    ) {
      await db
        .update(zybitFindings)
        .set({ status: 'measured', updatedAt: now })
        .where(
          and(
            eq(zybitFindings.id, updated[0].findingId),
            eq(zybitFindings.organizationId, actorResult.actor.organizationId)
          )
        );
    }

    return success(updated[0]);
  } catch (error) {
    return mapRouteError(error);
  }
}

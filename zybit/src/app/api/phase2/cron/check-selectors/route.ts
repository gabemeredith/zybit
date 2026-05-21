/**
 * Zybit-133 — Selector staleness cron — runs daily (vercel.json).
 *
 * For each running experiment with variant modifications, re-checks the
 * targeted CSS selectors against the latest page snapshot for the experiment's
 * target path. If a selector no longer matches (likely a customer redesign),
 * the variant is silently a no-op, so we email the PM to review it.
 *
 * Pure matching lives in `findStaleSelectors`; this route is the DB + email
 * orchestration. Best-effort email — a send failure never fails the cron.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { zybitExperiments, phase1Sites, appUsers } from '@/lib/db/schema';
import { unauthorized, mapRouteError } from '@/app/api/phase1/_shared';
import { createPhase1Repository } from '@/lib/phase1';
import { findStaleSelectors } from '@/lib/experiments/selectorStaleness';
import { sendSelectorStaleEmail } from '@/lib/email/selectorStaleEmail';
import { logger, cronitorPing } from '@/lib/observability';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { VariantModification } from '@/lib/experiments/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONITOR_KEY = 'check-selectors';

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

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  await cronitorPing(MONITOR_KEY, 'run');

  try {
    const db = getDb();
    const repository = createPhase1Repository();

    const experiments = await db
      .select({
        id: zybitExperiments.id,
        organizationId: zybitExperiments.organizationId,
        siteId: zybitExperiments.siteId,
        targetPath: zybitExperiments.targetPath,
        modifications: zybitExperiments.modifications,
        hypothesis: zybitExperiments.hypothesis,
      })
      .from(zybitExperiments)
      .where(eq(zybitExperiments.status, 'running'));

    let checked = 0;
    let stale = 0;
    let emailed = 0;

    for (const exp of experiments) {
      const mods = (exp.modifications ?? []) as VariantModification[];
      if (mods.length === 0 || !exp.targetPath) continue;
      checked++;

      const snapshot = await repository.getPageSnapshot({
        organizationId: exp.organizationId,
        siteId: exp.siteId,
        pathRef: exp.targetPath,
      });
      if (!snapshot) continue;

      const staleSelectors = findStaleSelectors(mods, snapshot.data as PageSnapshotData);
      if (staleSelectors.length === 0) continue;
      stale++;

      const [site] = await db
        .select({ domain: phase1Sites.domain })
        .from(phase1Sites)
        .where(eq(phase1Sites.id, exp.siteId))
        .limit(1);
      const domain = site?.domain ?? exp.siteId;

      const recipients = await db
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.organizationId, exp.organizationId));

      for (const r of recipients) {
        if (!r.email) continue;
        const res = await sendSelectorStaleEmail({
          to: r.email,
          domain,
          hypothesis: exp.hypothesis,
          pathRef: exp.targetPath,
          staleSelectors,
        });
        if (res.success) emailed++;
      }
    }

    logger.info('check-selectors.done', { service: 'snapshot-cron', checked, stale, emailed });
    await cronitorPing(MONITOR_KEY, 'complete');
    return NextResponse.json({ success: true, data: { checked, stale, emailed } });
  } catch (error) {
    await cronitorPing(MONITOR_KEY, 'fail');
    return mapRouteError(error);
  }
}

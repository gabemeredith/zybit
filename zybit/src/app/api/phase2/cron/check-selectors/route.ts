/**
 * Zybit-133 — Selector staleness cron — runs daily (vercel.json).
 *
 * For each running experiment with variant modifications, re-checks the
 * targeted CSS selectors against the latest page snapshot for the experiment's
 * target path. If a selector no longer matches (likely a customer redesign),
 * the variant is silently a no-op, so we notify the PM.
 *
 * Pure matching lives in `findStaleSelectors`; this route is the DB + email
 * orchestration. Best-effort email — a send failure never fails the cron.
 *
 * Shape (incorporates PR #57 review feedback):
 *   1. One query loads every running experiment + its site domain (JOIN).
 *   2. Page snapshots for unique (siteId, pathRef) pairs are prefetched in
 *      parallel chunks of CRON_CONCURRENCY — same pattern as refresh-snapshots.
 *   3. Recipients are loaded in a single IN query over the orgs that have at
 *      least one running experiment with modifications.
 *   4. Stale experiments are accumulated per recipient, then one digest email
 *      per recipient is sent in parallel via Promise.allSettled.
 */

import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { zybitExperiments, phase1Sites, appUsers } from '@/lib/db/schema';
import { unauthorized, mapRouteError } from '@/app/api/phase1/_shared';
import { createPhase1Repository } from '@/lib/phase1';
import { findStaleSelectors, type StaleSelector } from '@/lib/experiments/selectorStaleness';
import {
  sendSelectorStaleEmail,
  type StaleExperimentNotice,
} from '@/lib/email/selectorStaleEmail';
import { logger, cronitorPing } from '@/lib/observability';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { VariantModification } from '@/lib/experiments/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONITOR_KEY = 'check-selectors';
const CRON_CONCURRENCY = 4;

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

function snapshotKey(siteId: string, pathRef: string): string {
  return `${siteId}|${pathRef}`;
}

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  await cronitorPing(MONITOR_KEY, 'run');

  try {
    const db = getDb();
    const repository = createPhase1Repository();

    // One query: running experiments joined with their site domain.
    const experiments = await db
      .select({
        id: zybitExperiments.id,
        organizationId: zybitExperiments.organizationId,
        siteId: zybitExperiments.siteId,
        targetPath: zybitExperiments.targetPath,
        modifications: zybitExperiments.modifications,
        hypothesis: zybitExperiments.hypothesis,
        domain: phase1Sites.domain,
      })
      .from(zybitExperiments)
      .leftJoin(phase1Sites, eq(phase1Sites.id, zybitExperiments.siteId))
      .where(eq(zybitExperiments.status, 'running'));

    // Filter to experiments that actually have modifications + a target path.
    const candidates = experiments.filter((exp) => {
      const mods = (exp.modifications ?? []) as VariantModification[];
      return mods.length > 0 && !!exp.targetPath;
    });

    if (candidates.length === 0) {
      logger.info('check-selectors.done', { service: 'snapshot-cron', checked: 0, stale: 0, emailed: 0 });
      await cronitorPing(MONITOR_KEY, 'complete');
      return NextResponse.json({ success: true, data: { checked: 0, stale: 0, emailed: 0 } });
    }

    // Prefetch snapshots in parallel chunks for unique (siteId, pathRef) pairs.
    const snapshotKeys = new Map<
      string,
      { organizationId: string; siteId: string; pathRef: string }
    >();
    for (const exp of candidates) {
      const key = snapshotKey(exp.siteId, exp.targetPath!);
      if (!snapshotKeys.has(key)) {
        snapshotKeys.set(key, {
          organizationId: exp.organizationId,
          siteId: exp.siteId,
          pathRef: exp.targetPath!,
        });
      }
    }

    const snapshots = new Map<string, Awaited<ReturnType<typeof repository.getPageSnapshot>>>();
    const snapshotEntries = [...snapshotKeys.entries()];
    for (let i = 0; i < snapshotEntries.length; i += CRON_CONCURRENCY) {
      const chunk = snapshotEntries.slice(i, i + CRON_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(([, args]) => repository.getPageSnapshot(args)),
      );
      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        if (result.status === 'fulfilled') {
          snapshots.set(chunk[j][0], result.value);
        }
      }
    }

    // Find stale experiments using the prefetched snapshots.
    type StaleHit = {
      experiment: (typeof candidates)[number];
      staleSelectors: StaleSelector[];
    };
    const staleHits: StaleHit[] = [];
    let checked = 0;
    for (const exp of candidates) {
      checked++;
      const snapshot = snapshots.get(snapshotKey(exp.siteId, exp.targetPath!));
      if (!snapshot) continue;
      const mods = (exp.modifications ?? []) as VariantModification[];
      const staleSelectors = findStaleSelectors(mods, snapshot.data as PageSnapshotData);
      if (staleSelectors.length === 0) continue;
      staleHits.push({ experiment: exp, staleSelectors });
    }

    if (staleHits.length === 0) {
      logger.info('check-selectors.done', { service: 'snapshot-cron', checked, stale: 0, emailed: 0 });
      await cronitorPing(MONITOR_KEY, 'complete');
      return NextResponse.json({ success: true, data: { checked, stale: 0, emailed: 0 } });
    }

    // One IN query for every recipient of every affected org.
    const affectedOrgIds = [...new Set(staleHits.map((h) => h.experiment.organizationId))];
    const recipientRows = await db
      .select({ email: appUsers.email, organizationId: appUsers.organizationId })
      .from(appUsers)
      .where(inArray(appUsers.organizationId, affectedOrgIds));
    const recipientsByOrg = new Map<string, string[]>();
    for (const r of recipientRows) {
      if (!r.email) continue;
      const list = recipientsByOrg.get(r.organizationId) ?? [];
      list.push(r.email);
      recipientsByOrg.set(r.organizationId, list);
    }

    // Build per-recipient digests.
    const notices = new Map<string, StaleExperimentNotice[]>();
    for (const hit of staleHits) {
      const recipients = recipientsByOrg.get(hit.experiment.organizationId) ?? [];
      if (recipients.length === 0) continue;
      const notice: StaleExperimentNotice = {
        domain: hit.experiment.domain ?? hit.experiment.siteId,
        hypothesis: hit.experiment.hypothesis,
        pathRef: hit.experiment.targetPath!,
        staleSelectors: hit.staleSelectors,
      };
      for (const email of recipients) {
        const list = notices.get(email) ?? [];
        list.push(notice);
        notices.set(email, list);
      }
    }

    // Send one digest per recipient in parallel.
    const settledSends = await Promise.allSettled(
      [...notices.entries()].map(([to, experiments]) =>
        sendSelectorStaleEmail({ to, experiments }),
      ),
    );
    let emailed = 0;
    for (const r of settledSends) {
      if (r.status === 'fulfilled' && r.value.success) emailed++;
    }

    logger.info('check-selectors.done', {
      service: 'snapshot-cron',
      checked,
      stale: staleHits.length,
      emailed,
    });
    await cronitorPing(MONITOR_KEY, 'complete');
    return NextResponse.json({ success: true, data: { checked, stale: staleHits.length, emailed } });
  } catch (error) {
    await cronitorPing(MONITOR_KEY, 'fail');
    return mapRouteError(error);
  }
}

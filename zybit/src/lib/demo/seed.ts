/**
 * /demo seed orchestrator.
 *
 * Runs the real `/audit` pipeline against commitmint.app — same code path
 * a public-audit submission triggers, so we get real Browserless captures,
 * brand-DNA, vision pass + copy critique, all 23 rules, persisted
 * findings, and the before/after fix-preview pair. On top of that we
 * overlay a 14-day PostHog-shaped event stream so the cockpit's "this
 * week" stats look like live analytics, pre-seed three experiments
 * (draft / running / completed) keyed to the top findings, and connect
 * the proxy slug so deploys at `commitmint.zybit.run` route through the
 * real proxy handler.
 *
 * Idempotent. The expensive Browserless + Firecrawl + Gemini work runs
 * only when findings don't already exist for the demo site. Subsequent
 * calls just refresh the overlay + experiment rows.
 */

import { randomUUID } from 'node:crypto';
import { and, count, eq, like, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  phase1Events,
  phase1Sites,
  phase2Integrations,
  zybitExperiments,
  zybitFindings,
} from '@/lib/db/schema';
import type { VariantModification } from '@/lib/experiments/types';
import { runUrlAudit } from '../../../lighthouse/lib/runner/runUrlAudit';
import { DirectEventSink } from '../../../lighthouse/lib/sinks/direct';
import {
  DEMO_COMPLETED_RESULT,
  DEMO_ORG_ID,
  DEMO_PROXY_SLUG,
  DEMO_SITE_ID,
  DEMO_TARGET_URL,
} from './constants';
import { buildPostHogOverlay } from './posthogOverlay';

export type SeedStage =
  | 'idle'
  | 'audit-running'
  | 'overlaying-events'
  | 'wiring-proxy'
  | 'creating-experiments'
  | 'done'
  | 'failed';

export interface SeedStatus {
  stage: SeedStage;
  findingCount: number;
  experimentCount: number;
  proxyWired: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

interface RuntimeStatus {
  stage: SeedStage;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const STATUS: RuntimeStatus = {
  stage: 'idle',
  startedAt: null,
  finishedAt: null,
  error: null,
};

let inFlight: Promise<void> | null = null;

export function getSeedRuntimeStatus(): RuntimeStatus {
  return { ...STATUS };
}

export async function readSeedStatus(): Promise<SeedStatus> {
  const db = getDb();

  const findingRows = await db
    .select({ n: count() })
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, DEMO_SITE_ID));
  const findingCount = Number(findingRows[0]?.n ?? 0);

  const experimentRows = await db
    .select({ n: count() })
    .from(zybitExperiments)
    .where(eq(zybitExperiments.siteId, DEMO_SITE_ID));
  const experimentCount = Number(experimentRows[0]?.n ?? 0);

  const siteRows = await db
    .select({ proxySlug: phase1Sites.proxySlug })
    .from(phase1Sites)
    .where(eq(phase1Sites.id, DEMO_SITE_ID))
    .limit(1);
  const proxyWired = siteRows[0]?.proxySlug === DEMO_PROXY_SLUG;

  const fullySeeded =
    findingCount > 0 && experimentCount >= 3 && proxyWired;

  return {
    stage: fullySeeded ? 'done' : STATUS.stage,
    findingCount,
    experimentCount,
    proxyWired,
    startedAt: STATUS.startedAt,
    finishedAt: fullySeeded ? STATUS.finishedAt ?? new Date().toISOString() : STATUS.finishedAt,
    error: STATUS.error,
  };
}

/**
 * Run the seed. Safe to call concurrently — a second call returns the
 * same in-flight promise. Returns when the full seed is durable.
 */
export async function seedDemo(opts: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    STATUS.stage = 'audit-running';
    STATUS.startedAt = new Date().toISOString();
    STATUS.error = null;
    STATUS.finishedAt = null;
    try {
      const db = getDb();
      const existing = await db
        .select({ n: count() })
        .from(zybitFindings)
        .where(eq(zybitFindings.siteId, DEMO_SITE_ID));
      const hasFindings = Number(existing[0]?.n ?? 0) > 0;

      if (!hasFindings || opts.force) {
        STATUS.stage = 'audit-running';
        await runUrlAudit({
          url: DEMO_TARGET_URL,
          maxPages: 12,
          mode: 'in-app',
          visionPagesLimit: 3,
        });
      }

      STATUS.stage = 'overlaying-events';
      await wipeOverlayEvents(DEMO_SITE_ID);
      const pages = await readDemoPages();
      const runningExperimentId = `demo_exp_running_${DEMO_SITE_ID}`;
      const overlay = buildPostHogOverlay({
        siteId: DEMO_SITE_ID,
        pages,
        now: Date.now(),
        runningExperimentId,
      });
      const sink = new DirectEventSink({
        organizationId: DEMO_ORG_ID,
        defaultSource: 'posthog',
      });
      for (const ev of overlay) await sink.emit(ev);
      await sink.flush();

      STATUS.stage = 'wiring-proxy';
      await db
        .update(phase1Sites)
        .set({ proxySlug: DEMO_PROXY_SLUG })
        .where(eq(phase1Sites.id, DEMO_SITE_ID));

      await db
        .insert(phase2Integrations)
        .values({
          id: `demo_integration_${DEMO_SITE_ID}_posthog`,
          organizationId: DEMO_ORG_ID,
          siteId: DEMO_SITE_ID,
          provider: 'posthog',
          status: 'connected',
          config: { host: 'https://app.posthog.com', projectId: 'demo-commitmint' },
          secretRef: 'POSTHOG_API_KEY__DEMO',
          lastSyncedAt: new Date(),
          consecutiveFailures: 0,
        })
        .onConflictDoUpdate({
          target: [phase2Integrations.siteId, phase2Integrations.provider],
          set: {
            status: 'connected',
            lastSyncedAt: new Date(),
            lastErrorCode: null,
            consecutiveFailures: 0,
          },
        });

      STATUS.stage = 'creating-experiments';
      await provisionDemoExperiments({ runningExperimentId });

      STATUS.stage = 'done';
      STATUS.finishedAt = new Date().toISOString();
    } catch (err) {
      STATUS.stage = 'failed';
      STATUS.error = err instanceof Error ? err.message : String(err);
      STATUS.finishedAt = new Date().toISOString();
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function wipeOverlayEvents(siteId: string): Promise<void> {
  const db = getDb();
  // Drop only the overlay's own source_event_id prefix — keep the
  // audit's grounded layer alive so rules stay tuned to captured page structure.
  await db
    .delete(phase1Events)
    .where(
      and(
        eq(phase1Events.siteId, siteId),
        like(phase1Events.sourceEventId, 'overlay_%'),
      ),
    );
}

async function readDemoPages(): Promise<{ pathRef: string; trafficShare: number }[]> {
  const db = getDb();
  const rows = await db
    .execute<{ path_ref: string }>(
      sql`SELECT path_ref FROM phase2_page_snapshots WHERE site_id = ${DEMO_SITE_ID}`,
    )
    .catch(() => ({ rows: [] as { path_ref: string }[] }));
  const paths = (rows.rows ?? []).map((r) => r.path_ref);
  if (paths.length === 0) {
    return [
      { pathRef: '/', trafficShare: 0.45 },
      { pathRef: '/pricing', trafficShare: 0.2 },
      { pathRef: '/signup', trafficShare: 0.15 },
      { pathRef: '/docs', trafficShare: 0.1 },
      { pathRef: '/blog', trafficShare: 0.1 },
    ];
  }
  return paths.map((pathRef, i) => ({
    pathRef,
    trafficShare:
      pathRef === '/' ? 0.45 :
      pathRef === '/pricing' ? 0.2 :
      pathRef === '/signup' ? 0.15 :
      Math.max(0.05, 0.3 / (i + 1)),
  }));
}

async function provisionDemoExperiments(args: {
  runningExperimentId: string;
}): Promise<void> {
  const db = getDb();

  const topFindings = await db
    .select({
      id: zybitFindings.id,
      title: zybitFindings.title,
      pathRef: zybitFindings.pathRef,
      prescription: zybitFindings.prescription,
      fixModifications: zybitFindings.fixModifications,
    })
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, DEMO_SITE_ID))
    .limit(5);

  if (topFindings.length === 0) return;

  const [primary, secondary, tertiary] = [topFindings[0], topFindings[1] ?? topFindings[0], topFindings[2] ?? topFindings[0]];

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);

  const seedRows = [
    {
      id: `demo_exp_draft_${DEMO_SITE_ID}`,
      status: 'draft' as const,
      finding: primary,
      hypothesis: prescriptionHypothesis(primary, 'Variant proposes the AI-recommended change. Expecting +5–10% lift on primary CTA conversion.'),
      modifications: extractMods(primary.fixModifications),
      startedAt: null,
      completedAt: null,
      results: null,
      notes: JSON.stringify({ name: shortExperimentName(primary, 'Sharpen primary CTA copy') }),
    },
    {
      id: args.runningExperimentId,
      status: 'running' as const,
      finding: secondary,
      hypothesis: prescriptionHypothesis(secondary, 'Variant addresses the friction surfaced by the audit. Tracking sign-up conversion vs control.'),
      modifications: extractMods(secondary.fixModifications),
      startedAt: new Date(now.getTime() - 6 * 86_400_000),
      completedAt: null,
      results: null,
      notes: JSON.stringify({ name: shortExperimentName(secondary, 'Above-the-fold hierarchy fix') }),
    },
    {
      id: `demo_exp_completed_${DEMO_SITE_ID}`,
      status: 'completed' as const,
      finding: tertiary,
      hypothesis: prescriptionHypothesis(tertiary, 'Variant replaced the generic CTA copy with action-verb framing.'),
      modifications: extractMods(tertiary.fixModifications),
      startedAt: fourteenDaysAgo,
      completedAt: new Date(now.getTime() - 2 * 86_400_000),
      results: DEMO_COMPLETED_RESULT,
      notes: JSON.stringify({ name: shortExperimentName(tertiary, 'CTA verb alignment') }),
    },
  ];

  for (const row of seedRows) {
    const primaryMetric = 'signup';
    await db
      .insert(zybitExperiments)
      .values({
        id: row.id,
        organizationId: DEMO_ORG_ID,
        siteId: DEMO_SITE_ID,
        findingId: row.finding.id,
        hypothesis: row.hypothesis,
        primaryMetric,
        primaryMetricSource: 'posthog',
        audienceControlPct: 50,
        audienceVariantPct: 50,
        durationDays: 14,
        status: row.status,
        modifications: row.modifications,
        targetPath: row.finding.pathRef ?? '/',
        guardrails: ['bounce_rate', 'revenue_per_visitor'],
        notes: row.notes,
        ...(row.results
          ? {
              resultControlRate: row.results.controlRate,
              resultVariantRate: row.results.variantRate,
              resultConfidence: row.results.confidence,
              resultParticipants: row.results.participants,
            }
          : {}),
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      })
      .onConflictDoUpdate({
        target: zybitExperiments.id,
        set: {
          status: row.status,
          modifications: row.modifications,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          ...(row.results
            ? {
                resultControlRate: row.results.controlRate,
                resultVariantRate: row.results.variantRate,
                resultConfidence: row.results.confidence,
                resultParticipants: row.results.participants,
              }
            : {}),
          updatedAt: new Date(),
        },
      });
  }

  await db
    .insert(phase1Events)
    .values(
      ['control', 'variant'].flatMap((bucket) =>
        Array.from({ length: 30 }, (_, i) => ({
          id: randomUUID(),
          organizationId: DEMO_ORG_ID,
          siteId: DEMO_SITE_ID,
          sessionId: `demo_assign_${bucket}_${i}`,
          type: 'experiment_assignment',
          path: secondary.pathRef ?? '/',
          source: 'posthog' as const,
          sourceEventId: `demo_as_${args.runningExperimentId}_${bucket}_${i}`,
          occurredAt: new Date(now.getTime() - (i + 1) * 3_600_000),
          properties: { experimentId: args.runningExperimentId, bucket },
        })),
      ),
    )
    .onConflictDoNothing();
}

function prescriptionHypothesis(
  finding: { prescription: unknown } | undefined,
  fallback: string,
): string {
  if (!finding) return fallback;
  const p = finding.prescription as { whyItWorks?: string; whatToChange?: string } | null;
  if (!p) return fallback;
  if (p.whyItWorks && p.whatToChange) {
    return `${p.whatToChange.trim()} — ${p.whyItWorks.trim()}`;
  }
  return p.whyItWorks ?? p.whatToChange ?? fallback;
}

function shortExperimentName(
  finding: { title: string } | undefined,
  fallback: string,
): string {
  if (!finding) return fallback;
  return finding.title.length > 60 ? finding.title.slice(0, 57) + '…' : finding.title;
}

function extractMods(raw: unknown): VariantModification[] {
  return Array.isArray(raw) ? (raw as VariantModification[]) : [];
}

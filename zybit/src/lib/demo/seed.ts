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
import { and, count, eq, like, ne, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  phase1Events,
  phase1Sites,
  phase2Integrations,
  zybitExperiments,
  zybitFindings,
} from '@/lib/db/schema';
import type { VariantModification } from '@/lib/experiments/types';
import { formatCount, pct } from '@/lib/phase2/rules/helpers';
import { renderBeforeAfter } from '@/lib/audit/fixPreview/renderBeforeAfter';
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

/**
 * Seed status + in-flight guard are anchored on `globalThis` because Next
 * compiles the `/demo` page and the `/api/demo/*` routes into separate
 * module graphs — a plain module-level singleton gives each its own copy,
 * so the page's `failed`/progress state would never reach the status
 * endpoint the client polls. `globalThis` shares one copy per process.
 * (Across cold serverless instances state still diverges; the durable
 * `done` signal in `readSeedStatus` is DB-derived and stays correct there.)
 */
interface DemoSeedState {
  status: RuntimeStatus;
  inFlight: Promise<void> | null;
}

const seedState: DemoSeedState = ((
  globalThis as typeof globalThis & { __zybitDemoSeed?: DemoSeedState }
).__zybitDemoSeed ??= {
  status: { stage: 'idle', startedAt: null, finishedAt: null, error: null },
  inFlight: null,
});

const STATUS = seedState.status;

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

  // The curated demo stages a completed + a draft experiment (return-visit
  // thrash is left un-experimented for the live launch), so 2 is fully seeded.
  const fullySeeded =
    findingCount > 0 && experimentCount >= 2 && proxyWired;

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
  if (seedState.inFlight) return seedState.inFlight;
  seedState.inFlight = (async () => {
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
      // `proxy_slug` is globally unique. Release it from any other row
      // (e.g. a stale demo site from an earlier id scheme) before claiming
      // it for the current demo site, so re-runs don't hit the unique index.
      await db
        .update(phase1Sites)
        .set({ proxySlug: null })
        .where(
          and(
            eq(phase1Sites.proxySlug, DEMO_PROXY_SLUG),
            ne(phase1Sites.id, DEMO_SITE_ID),
          ),
        );
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
      await tuneDemoFlowDropoff();
      await curateDemoThrashFinding();

      STATUS.stage = 'done';
      STATUS.finishedAt = new Date().toISOString();
    } catch (err) {
      STATUS.stage = 'failed';
      STATUS.error = err instanceof Error ? err.message : String(err);
      STATUS.finishedAt = new Date().toISOString();
      throw err;
    } finally {
      seedState.inFlight = null;
    }
  })();
  return seedState.inFlight;
}

/**
 * Fast reset of the curated demo layer, run on every `/demo` entry so each
 * presentation starts from the same clean state. Re-provisions the three demo
 * experiments (wiping any the presenter created) and re-applies the sign-up
 * drop-off tune. Deliberately does NOT re-run the audit or re-insert the 14-day
 * overlay — those are deterministic and the presenter can't mutate them, so
 * skipping keeps the reset sub-second. Assumes the first-run seed already ran
 * (findings + overlay + proxy in place); callers gate on `findingCount > 0`.
 */
export async function resetDemoCuratedState(): Promise<void> {
  const runningExperimentId = `demo_exp_running_${DEMO_SITE_ID}`;
  await provisionDemoExperiments({ runningExperimentId });
  await tuneDemoFlowDropoff();
  await curateDemoThrashFinding();
  await refreshDemoIntegration();
}

/**
 * Keep the demo's PostHog integration reading healthy. `lastSyncedAt` is only
 * stamped by the full seed, so without this every reset would leave it ageing
 * — and the cockpit flags "Degraded — sync stale" once it crosses the 2h
 * staleness window. Bump it to now (and clear any failure state) on every
 * reset so the demo always shows a live, connected pipeline.
 */
async function refreshDemoIntegration(): Promise<void> {
  const db = getDb();
  await db
    .update(phase2Integrations)
    .set({
      status: 'connected',
      lastSyncedAt: new Date(),
      lastErrorCode: null,
      consecutiveFailures: 0,
    })
    .where(
      and(
        eq(phase2Integrations.siteId, DEMO_SITE_ID),
        eq(phase2Integrations.provider, 'posthog'),
      ),
    );
}

/**
 * Curate the return-visit thrash finding for the demo: pin it as the open
 * critical #1 (top of the backlog, which orders by `priorityScore desc`) and
 * rewrite its copy in plain language with "homepage" instead of a bare "/".
 * It's intentionally left un-experimented — it's the finding the presenter
 * launches live during the demo, so its status must be `open` (an earlier
 * completed-experiment association had flipped it to `shipped`).
 */
async function curateDemoThrashFinding(): Promise<void> {
  const db = getDb();
  await db
    .update(zybitFindings)
    .set({
      status: 'open',
      severity: 'critical',
      priorityScore: 1,
      summary:
        '853 sessions came back to the homepage 3+ times without moving ' +
        'forward. 61% get stuck in a loop — the page doesn’t surface what ' +
        'they’re looking for.',
      recommendation: [
        'Visitors loop back because they leave, don’t find what they ' +
          'expected, and return. Add a “Quick answer” section or anchor ' +
          'links at the top of the homepage that point to what they keep ' +
          'coming back for.',
      ],
      prescription: {
        whatToChange:
          'Add a “Quick answer” section at the top of the homepage that ' +
          'surfaces the destinations returning visitors keep looking for, so ' +
          'they find the answer on the first visit.',
        whyItWorks:
          '853 sessions hit the homepage 3+ times without progressing — 61% ' +
          'of all sessions. They keep returning because they haven’t found ' +
          'what they need. Surfacing the answer up front breaks the loop.',
        experimentVariantDescription:
          'Variant B adds a top-of-page quick-answer section to the homepage, ' +
          'pointing visitors to what they keep returning for. Primary metric: ' +
          'funnel progression from the homepage.',
      },
      // Pre-stage a ready-to-launch brief so the presenter can launch the
      // experiment live in one click. The `zybit-insert` class pairs with the
      // companion css-inject styling at launch (see `briefToModifications`) so
      // the variant renders as a polished card, not raw markup.
      experimentBrief: {
        experimentName: 'Add a quick-answer section to the homepage',
        selector: 'h1:nth-of-type(1)',
        changeType: 'insert',
        newValue:
          '<section class="zybit-insert zybit-quick-answer">\n' +
          '  <h2>Looking for something specific?</h2>\n' +
          '  <p>Most visitors who keep coming back are trying to:</p>\n' +
          '  <ul>\n' +
          '    <li><a href="#how-it-works">See how staking on goals works</a></li>\n' +
          '    <li><a href="#pricing">Check pricing &amp; fees</a></li>\n' +
          '    <li><a href="#signup">Start your first commitment</a></li>\n' +
          '  </ul>\n' +
          '</section>',
        variantDescription:
          'Variant B adds a top-of-page quick-answer section to the homepage, ' +
          'pointing returning visitors to the destinations they keep coming ' +
          'back for.',
        primaryMetric: 'conversion rate on the homepage',
        hypothesis:
          'Returning visitors loop because they can’t find what they came ' +
          'for. Surfacing the top destinations at the top of the homepage ' +
          'lets them progress on the first visit instead of bouncing and ' +
          'coming back.',
        insertPosition: 'before',
        createdAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(zybitFindings.siteId, DEMO_SITE_ID),
        eq(zybitFindings.ruleId, 'return-visit-thrash'),
      ),
    );

  await ensureDemoThrashFixPreview();
}

/**
 * The brand-matched variant for the demo thrash finding: a clean "quick links"
 * pill nav inserted below the hero subhead. The copy/brand colour came from the
 * audit's Gemini vision advisor; the placement (below the subhead, not pinned to
 * the top) and the clean pill styling are curated deterministically so the demo
 * is reproducible and pixel-stable rather than re-rolled by the model each run.
 * Companion css-inject rules carry the styling (the insert sanitizer strips
 * inline styles); they're hidden from the experiment-detail change list.
 */
const DEMO_THRASH_INSERT_HTML =
  '<div id="zb-quicknav">' +
  '<span class="zb-qn-label">Looking for how it works?</span>' +
  '<nav class="zb-qn-links">' +
  '<a href="#how-it-works">Set a goal</a>' +
  '<a href="#how-it-works">Stake capital</a>' +
  '<a href="#signup">Verify &amp; earn</a>' +
  '</nav></div>';

const DEMO_THRASH_FIX_MODS: VariantModification[] = [
  { type: 'element-insert', selector: 'p.max-w-xl', position: 'after', html: DEMO_THRASH_INSERT_HTML },
  { type: 'css-inject', selector: '#zb-quicknav', css: 'display:flex;flex-direction:column;align-items:center;gap:12px;margin:8px auto 28px' },
  { type: 'css-inject', selector: '#zb-quicknav .zb-qn-label', css: 'font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.45)' },
  { type: 'css-inject', selector: '#zb-quicknav .zb-qn-links', css: 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center' },
  { type: 'css-inject', selector: '#zb-quicknav .zb-qn-links a', css: 'display:inline-block;padding:9px 18px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.92);font-size:13px;font-weight:500;text-decoration:none' },
];

/**
 * Cache the curated variant + its before/after screenshots on the thrash
 * finding so the launch path reuses them and the experiment preview is instant.
 * Re-renders only when the stored variant is stale (mods changed or no
 * screenshot yet). Fail-soft — on a render error the launch falls back to the
 * theme-adaptive scaffold card.
 */
async function ensureDemoThrashFixPreview(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: zybitFindings.id,
      fixModifications: zybitFindings.fixModifications,
      screenshotAfterUrl: zybitFindings.screenshotAfterUrl,
    })
    .from(zybitFindings)
    .where(
      and(
        eq(zybitFindings.siteId, DEMO_SITE_ID),
        eq(zybitFindings.ruleId, 'return-visit-thrash'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return;

  const currentInsert = Array.isArray(row.fixModifications)
    ? (row.fixModifications as VariantModification[]).find((m) => m.type === 'element-insert')
    : null;
  const upToDate =
    currentInsert?.type === 'element-insert' &&
    currentInsert.html === DEMO_THRASH_INSERT_HTML &&
    !!row.screenshotAfterUrl;
  if (upToDate) return;

  await db
    .update(zybitFindings)
    .set({ fixModifications: DEMO_THRASH_FIX_MODS, fixPreviewTier: 1, updatedAt: new Date() })
    .where(eq(zybitFindings.id, row.id));

  try {
    const res = await renderBeforeAfter({
      findingId: row.id,
      originUrl: `${DEMO_TARGET_URL}/`,
      modifications: DEMO_THRASH_FIX_MODS,
      enforceSsrfGuard: true,
    });
    if (res) {
      await db
        .update(zybitFindings)
        .set({ screenshotBeforeUrl: res.beforeUrl, screenshotAfterUrl: res.afterUrl, updatedAt: new Date() })
        .where(eq(zybitFindings.id, row.id));
    }
  } catch (err) {
    console.error('[demo] thrash fix-preview render failed (non-fatal)', err);
  }
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
      ruleId: zybitFindings.ruleId,
      title: zybitFindings.title,
      pathRef: zybitFindings.pathRef,
      prescription: zybitFindings.prescription,
      fixModifications: zybitFindings.fixModifications,
    })
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, DEMO_SITE_ID))
    .limit(5);

  if (topFindings.length === 0) return;

  // Wipe any prior experiments for the demo site before re-provisioning — the
  // curated trio from earlier seeds plus any the presenter created while
  // clicking around the cockpit — so each seed yields exactly these three.
  await db.delete(zybitExperiments).where(eq(zybitExperiments.siteId, DEMO_SITE_ID));

  // Curate the demo narrative by rule rather than raw DB order:
  //   - completed ("shipped") = the sign-up drop-off win,
  //   - draft = the canonical-URL fix queued up.
  // Return-visit thrash is deliberately left OUT of the experiments — it's the
  // critical #1 finding (see `curateDemoThrashFinding`) the presenter
  // launches live during the demo, so it must stay un-experimented on reset.
  const byRule = (ruleId: string) => topFindings.find((f) => f.ruleId === ruleId);
  const nonThrash = topFindings.filter((f) => f.ruleId !== 'return-visit-thrash');
  const completed = byRule('flow-inter-step-dropoff') ?? nonThrash[0];
  if (!completed) return;
  const draft =
    byRule('missing-canonical-url') ?? nonThrash.find((f) => f.id !== completed.id);

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);

  const seedRows = [
    {
      id: `demo_exp_completed_${DEMO_SITE_ID}`,
      status: 'completed' as const,
      finding: completed,
      hypothesis: prescriptionHypothesis(completed, 'Variant addressed the sign-up drop-off the audit surfaced.'),
      modifications: extractMods(completed.fixModifications),
      startedAt: fourteenDaysAgo,
      completedAt: new Date(now.getTime() - 2 * 86_400_000),
      results: DEMO_COMPLETED_RESULT,
      notes: JSON.stringify({ name: shortExperimentName(completed, 'Sign-up drop-off fix') }),
    },
    ...(draft
      ? [
          {
            id: `demo_exp_draft_${DEMO_SITE_ID}`,
            status: 'draft' as const,
            finding: draft,
            hypothesis: prescriptionHypothesis(draft, 'Variant proposes the AI-recommended change.'),
            modifications: extractMods(draft.fixModifications),
            startedAt: null,
            completedAt: null,
            results: null as typeof DEMO_COMPLETED_RESULT | null,
            notes: JSON.stringify({ name: shortExperimentName(draft, 'Queued fix') }),
          },
        ]
      : []),
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
          // Re-map the curated fields too, so changing which finding fills a
          // slot takes effect on re-seed instead of sticking to the first run.
          findingId: row.finding.id,
          hypothesis: row.hypothesis,
          targetPath: row.finding.pathRef ?? '/',
          notes: row.notes,
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
          path: completed.pathRef ?? '/',
          source: 'posthog' as const,
          sourceEventId: `demo_as_${args.runningExperimentId}_${bucket}_${i}`,
          occurredAt: new Date(now.getTime() - (i + 1) * 3_600_000),
          properties: { experimentId: args.runningExperimentId, bucket },
        })),
      ),
    )
    .onConflictDoNothing();
}

/**
 * The grounded synthetic layer makes the last-crawled page a terminal node, so
 * `flow-inter-step-dropoff` lands on `/signup` at a 100% exit rate — every
 * arriving session "leaves" because nothing in the layer comes after it. That
 * reads as obviously fake on the demo. Rewrite that one finding to a realistic
 * exit rate (96 of 120 leave, 24 continue) by reconstructing the rule's own
 * copy with the new numbers. Demo-scoped: only touches the `lighthouse_site_*`
 * demo site, never the public `/audit` funnel. Idempotent — recomputes from the
 * stored "Sessions reaching the step" count, which this patch leaves untouched.
 */
const DEMO_FLOW_EXIT_RATE = 0.8;

interface FindingEvidence {
  label: string;
  value: string | number;
  context?: string;
}

async function tuneDemoFlowDropoff(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: zybitFindings.id,
      pathRef: zybitFindings.pathRef,
      severity: zybitFindings.severity,
      evidence: zybitFindings.evidence,
      prescription: zybitFindings.prescription,
    })
    .from(zybitFindings)
    .where(
      and(
        eq(zybitFindings.siteId, DEMO_SITE_ID),
        eq(zybitFindings.ruleId, 'flow-inter-step-dropoff'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.pathRef) return;

  const evidence = (row.evidence as FindingEvidence[] | null) ?? [];
  const reachedEv = evidence.find((e) => e.label === 'Sessions reaching the step');
  const inboundEv = evidence.find((e) => e.label === 'Top inbound path');
  const sessions = Number(reachedEv?.value ?? 0);
  if (!Number.isFinite(sessions) || sessions <= 0) return;

  const route = row.pathRef;
  const predecessor =
    typeof inboundEv?.value === 'string' ? inboundEv.value.split('→')[0].trim() : null;
  const exits = Math.round(sessions * DEMO_FLOW_EXIT_RATE);
  const continued = sessions - exits;
  const exitPct = pct(exits / sessions);

  const summary =
    `${formatCount(exits)} of ${formatCount(sessions)} sessions that reach ${route} ` +
    `(${exitPct}%) leave the product there instead of continuing` +
    `${predecessor ? `, most arriving from ${predecessor}` : ''}. ` +
    `This is the single step in the flow losing the most users.`;

  const recommendation = [
    `${route} is a mid-flow step — users navigate to it${
      predecessor ? ` (most from ${predecessor})` : ''
    } rather than landing on it cold — yet ${exitPct}% of the sessions that ` +
      `reach it end there. That is drop-off the page-level audit cannot see, ` +
      `because the problem is the transition, not the page in isolation.`,
    `Look at what this step asks of the user relative to the steps that retain ` +
      `them: a form, a decision, a price, a dead end with no obvious next action. ` +
      `Only ${formatCount(continued)} of the arriving sessions continued anywhere ` +
      `in the product. Reducing the friction here compounds across every flow ` +
      `that routes through it.`,
  ];

  const existingPrescription =
    (row.prescription as {
      whyItMatters?: string;
      whyItWorks?: string;
      experimentVariantDescription?: string;
    } | null) ?? {};
  const prescription = {
    whyItWorks: existingPrescription.whyItWorks ?? '',
    experimentVariantDescription: existingPrescription.experimentVariantDescription ?? '',
    ...(existingPrescription.whyItMatters
      ? { whyItMatters: existingPrescription.whyItMatters }
      : {}),
    whatToChange:
      `Reduce drop-off at ${route} — the mid-flow step ${exitPct}% of ` +
      `arriving sessions abandon. Give it one unambiguous next action and ` +
      `remove anything that competes with it.`,
  };

  const nextEvidence: FindingEvidence[] = evidence.map((e) => {
    if (e.label === 'Sessions that left here') return { ...e, value: exits };
    if (e.label === 'Continued past the step') return { ...e, value: continued };
    if (e.label === 'Exit rate') return { ...e, value: `${exitPct}%` };
    return e;
  });

  const snapshotDiagram = {
    type: 'flow-funnel' as const,
    pathRef: route,
    funnelSteps: [
      ...(predecessor && inboundEv
        ? [{ label: `Arrived from ${predecessor}`, value: sessions }]
        : []),
      { label: `Reached ${route}`, value: sessions, isFlagged: true },
      { label: 'Continued in the product', value: continued },
    ],
    proposedFix:
      `Give ${route} one clear next action so the ${exitPct}% who ` +
      `abandon it continue through the flow instead.`,
  };

  await db
    .update(zybitFindings)
    .set({
      summary,
      recommendation,
      prescription,
      evidence: nextEvidence,
      snapshotDiagram,
      severity: exits / sessions >= 0.75 ? 'critical' : 'warn',
      updatedAt: new Date(),
    })
    .where(eq(zybitFindings.id, row.id));
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

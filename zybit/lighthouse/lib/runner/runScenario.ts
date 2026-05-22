/**
 * Scenario runner — orchestrates one full generation pass.
 *
 *   provision org/site/config
 *      → emit N persona-weighted sessions into the sink
 *      → take snapshots of every visited path
 *      → run Zybit's Phase 2 insights pipeline
 *      → read back counts + samples for the inspector
 *
 * Imports Zybit's pipeline (runPhase2InsightsPipeline, runSnapshot,
 * createPhase1Repository) and DB schema directly — no code duplicated.
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import {
  phase1Events,
  phase2PageSnapshots,
  zybitExperimentOutcomes,
  zybitExperiments,
  zybitFindings,
} from '@/lib/db/schema';
import { createPhase1Repository } from '@/lib/phase1';
import { upsertFindings } from '@/lib/phase2/jobs/insightsTrigger';
import { runPhase2InsightsPipeline } from '@/lib/phase2/runInsightsPipeline';
import { createFlowGraphRepository } from '@/lib/phase2/flow';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import { CALIBRATED_RULE_IDS } from '@/lib/phase2/rules/ruleCalibration';
import {
  runSnapshot,
  SnapshotError,
} from '@/lib/phase2/snapshots';
import { generateSyntheticExperiment } from './syntheticExperiment';
import { runSession } from '../generators/sessionDriver';
import { seededRng } from '../generators/rng';
import { weightedSample } from '../generators/distributions';
import { personaById } from '../personas';
import { provisionLighthouseSite } from '../seeder/orgSite';
import { DirectEventSink } from '../sinks/direct';
import { PostHogEventSink } from '../sinks/posthog';
import type { EventSink } from '../sinks/types';
import type { EventSinkMode, GenerateProgressEvent, GenerateResult, Scenario } from '../types';

export interface RunScenarioOpts {
  scenario: Scenario;
  sessions: number;
  mode: EventSinkMode;
  /** Override the manifest baseUrl (e.g. tunneled URL from Step 10). */
  baseUrl?: string;
  onProgress?: (event: GenerateProgressEvent) => void;
}

function now(): string {
  return new Date().toISOString();
}

function progress(
  cb: ((e: GenerateProgressEvent) => void) | undefined,
  step: GenerateProgressEvent['step'],
  message: string,
): void {
  cb?.({ step, message, at: now() });
}

function buildPersonaMix(scenario: Scenario): Array<{ item: string; weight: number }> {
  return scenario.personaMix.map((m) => ({
    item: m.personaId,
    weight: m.weight,
  }));
}

function urlForPath(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}

export async function runScenario(opts: RunScenarioOpts): Promise<GenerateResult> {
  const startedAt = now();
  const runId = `lh_run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const { scenario, sessions, onProgress } = opts;
  const baseUrl = opts.baseUrl ?? scenario.siteManifest.baseUrl;

  // 0) Reset prior data for this site so re-runs start clean.
  //
  // The event sink dedupes on (siteId, source, sourceEventId) and the
  // simulator generates deterministic ids, so without a reset a re-run
  // inserts 0 events and the audit window (now()) sees 0 in-window
  // events even though the table has stale rows from yesterday. We also
  // clear experiments + outcomes so the PM-view timeline ("/app/loop")
  // shows raw before-state, not stale DEPLOYED entries from prior runs.
  // Org/site/user rows are intentionally preserved — they're needed for
  // the impersonation handoff in Step 3.
  //
  // Every delete is scoped to a single `lighthouse_site_<slug>` siteId,
  // so this can never touch real customer data even on a shared DB.
  const preExistingSiteId = `lighthouse_site_${scenario.siteManifest.slug}`;
  {
    const db = getDb();
    await Promise.all([
      db.delete(phase1Events).where(eq(phase1Events.siteId, preExistingSiteId)),
      db.delete(phase2PageSnapshots).where(eq(phase2PageSnapshots.siteId, preExistingSiteId)),
      db.delete(zybitFindings).where(eq(zybitFindings.siteId, preExistingSiteId)),
      db
        .delete(zybitExperimentOutcomes)
        .where(eq(zybitExperimentOutcomes.siteId, preExistingSiteId)),
      db.delete(zybitExperiments).where(eq(zybitExperiments.siteId, preExistingSiteId)),
    ]);
  }

  // 1) Provision
  progress(onProgress, 'provisioning', 'creating lighthouse_* org/site/config');
  const { organizationId, siteId } = await provisionLighthouseSite({
    slug: scenario.siteManifest.slug,
    displayName: scenario.siteManifest.displayName,
    domain:
      scenario.siteManifest.localHostname ??
      new URL(baseUrl).host,
    config: {
      ctas: scenario.siteManifest.primaryCtaSelector
        ? [
            {
              pageRef: '/',
              ctaId: 'primary',
              label: 'Primary CTA',
              visualWeight: 0.8,
              match: { kind: 'event-type', type: 'cta_click' },
            },
          ]
        : [],
    },
  });

  // 2) Sessions
  progress(onProgress, 'sessions', `running ${sessions} sessions`);
  const sink: EventSink =
    opts.mode === 'posthog'
      ? new PostHogEventSink()
      : new DirectEventSink({ organizationId });
  const personaMix = buildPersonaMix(scenario);
  const visitedPaths = new Set<string>();
  const sessionStart = new Date();

  for (let i = 0; i < sessions; i++) {
    const rng = seededRng(`${scenario.id}|${i}`);
    const personaId = weightedSample(personaMix, rng);
    const persona = personaById(personaId);
    const sessionId = `lh_sess_${scenario.siteManifest.slug}_${i}`;
    const distinctId = `lh_visitor_${scenario.siteManifest.slug}_${i % 200}`;
    const result = await runSession({
      persona,
      rng,
      siteId,
      paths: scenario.siteManifest.primaryFunnelPaths,
      transitionWeights: scenario.siteManifest.transitionWeights,
      exitHazard: scenario.siteManifest.exitHazard,
      primaryCta: scenario.siteManifest.primaryCtaSelector
        ? { ctaId: 'primary', selector: scenario.siteManifest.primaryCtaSelector }
        : undefined,
      sink,
      sessionId,
      distinctId,
      sourceEventPrefix: `${scenario.id}|${i}`,
    });
    visitedPaths.add(result.finalPath);
    for (const p of scenario.siteManifest.primaryFunnelPaths) visitedPaths.add(p);
  }
  const { written } = await sink.flush();
  const sessionEnd = new Date();

  // 3) Snapshots
  progress(onProgress, 'snapshots', `snapshotting ${visitedPaths.size} unique paths`);
  const repository = createPhase1Repository();
  let snapshotsTaken = 0;
  const snapshotErrors: { path: string; code: string; message: string }[] = [];
  for (const path of visitedPaths) {
    const fullUrl = urlForPath(baseUrl, path);
    try {
      const r = await runSnapshot(fullUrl, { respectRobots: false });
      // Use the logical path (from events/findings) as pathRef, not the fake-site
      // URL path — so selector-validate and suggestions can match snapshot to finding.
      const logicalPath = path.startsWith('/') ? path.replace(/\/$/, '') || '/' : `/${path}`;
      await repository.upsertPageSnapshot({
        organizationId,
        siteId,
        pathRef: logicalPath,
        url: r.finalUrl,
        data: r.data,
        fetchedAt: new Date(),
      });
      snapshotsTaken++;
    } catch (err) {
      if (err instanceof SnapshotError) {
        snapshotErrors.push({ path, code: err.code, message: err.message });
      } else {
        snapshotErrors.push({
          path,
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 4) Insights
  progress(onProgress, 'insights', 'running Phase 2 insights pipeline');
  const padMs = 60_000;
  const insights = await runPhase2InsightsPipeline({
    organizationId,
    siteId,
    window: {
      start: new Date(sessionStart.getTime() - padMs).toISOString(),
      end: new Date(sessionEnd.getTime() + padMs).toISOString(),
    },
    maxFindings: 50,
  });
  // `auditReport` is typed as optional on the pipeline result for legacy
  // reasons; in practice runPhase2InsightsPipeline always returns it.
  // Default to an empty array so downstream code (logging, persistence,
  // counts, samples) doesn't have to repeat the narrowing.
  const auditFindings = (insights.auditReport?.findings ?? []) as AuditFinding[];
  if (insights.warnings.length > 0 || !insights.trustworthy) {
    progress(
      onProgress,
      'insights',
      `gate: trustworthy=${insights.trustworthy} warnings=${insights.warnings
        .map((w) => `${w.code}`)
        .join(',')}`,
    );
  }
  progress(
    onProgress,
    'insights',
    `auditReport: ${auditFindings.length} findings (legacy ${insights.findings.length})`,
  );

  // Persist the flow graph so /app/flow renders without re-deriving.
  // Best-effort — a cache write never blocks the run.
  let flowGraphResult: GenerateResult['flowGraph'];
  if (insights.flowGraph) {
    const fg = insights.flowGraph;
    try {
      await createFlowGraphRepository().upsert(fg, organizationId);
      const flowFinding = auditFindings.find((f) => f.ruleId === 'flow-inter-step-dropoff');
      flowGraphResult = {
        nodes: fg.nodes.length,
        edges: fg.edges.length,
        sessionCount: fg.sessionCount,
        flowFindingFired: !!flowFinding,
        chokepointRoute: flowFinding?.pathRef ?? null,
      };
      progress(
        onProgress,
        'insights',
        `flow graph: ${fg.nodes.length} routes, ${fg.edges.length} edges` +
          (flowFinding ? ` — chokepoint: ${flowFinding.pathRef}` : ' — no chokepoint finding'),
      );
    } catch (err) {
      progress(
        onProgress,
        'insights',
        `flow graph persist failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Persist findings to forge_findings so /app/loop (and the embedded
  // PM view) has something to render. Reuses the cron's upsert helper
  // verbatim — same deterministic id, same dedup, same shape.
  // Persistence failure is non-fatal: a run is still useful even if the
  // PM view ends up empty.
  if (auditFindings.length > 0) {
    try {
      const writtenFindings = await upsertFindings(
        organizationId,
        siteId,
        auditFindings,
        sessionStart.getTime() - padMs,
        sessionEnd.getTime() + padMs,
      );
      progress(
        onProgress,
        'insights',
        `persisted ${writtenFindings} findings to forge_findings`,
      );
    } catch (err) {
      progress(
        onProgress,
        'insights',
        `persist failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 4.5) Synthetic experiment — closes the loop for the PM view.
  // Creates a running experiment for the top finding, emits assignment +
  // conversion events (variant arm lifted), and runs Zybit's outcome
  // computation so /app/loop shows DEPLOYED → RESULT → LEARNED. Non-fatal:
  // a run is still useful for Identify/Propose even if this step fails.
  progress(onProgress, 'experiments', 'creating synthetic experiment + outcome');
  let experimentSummary: GenerateResult['experiment'];
  try {
    const exp = await generateSyntheticExperiment({
      organizationId,
      siteId,
      slug: scenario.siteManifest.slug,
      primaryMetric: scenario.siteManifest.expectedConversionEvent ?? 'cta_click',
    });
    experimentSummary = {
      experimentId: exp.experimentId,
      action: exp.action,
      result: exp.result ?? null,
      liftPct: exp.liftPct ?? null,
      confidence: exp.confidence ?? null,
      participants: exp.participants,
      conversionEvents: exp.conversionEvents,
    };
    progress(
      onProgress,
      'experiments',
      exp.action === 'no-finding'
        ? 'no finding to test — skipped experiment'
        : `experiment ${exp.action}: result=${exp.result ?? 'n/a'} lift=${
            exp.liftPct != null ? `${exp.liftPct.toFixed(1)}%` : 'n/a'
          } (${exp.participants} participants)`,
    );
  } catch (err) {
    progress(
      onProgress,
      'experiments',
      `experiment failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4.6) Layer 2 calibration exercise.
  //
  // Layer 2 requires MIN_CONCLUSIVE_OUTCOMES (3) before any threshold moves.
  // Step 4.5 produced 1 outcome. We insert 2 more synthetic positives for the
  // top finding's rule — if it is in CALIBRATED_RULE_IDS — bringing the total
  // to 3. Then we re-run the pipeline so the inspector can confirm calibration
  // is mechanically active. Non-fatal and clearly labelled as synthetic seeds.
  let layer2Result: GenerateResult['layer2'];
  {
    const topRuleId = auditFindings[0]?.ruleId;
    const topPathRef = auditFindings[0]?.pathRef ?? null;
    if (topRuleId && CALIBRATED_RULE_IDS.has(topRuleId)) {
      try {
        const db = getDb();
        const syntheticOutcomes = [1, 2].map((i) => ({
          id: `lh_cal_seed_${siteId}_${topRuleId}_${i}`,
          organizationId,
          siteId,
          experimentId: `lh_cal_exp_${siteId}_${topRuleId}_${i}`,
          ruleId: topRuleId,
          pathRef: topPathRef,
          modificationType: 'copy-change',
          result: 'positive' as const,
          liftPct: 12.0,
          confidence: 0.92,
          controlConversions: 45,
          controlParticipants: 300,
          variantConversions: 58,
          variantParticipants: 300,
          guardrailBreached: null,
          concludedAt: new Date(Date.now() - (i + 1) * 7 * 86_400_000),
        }));
        await db
          .insert(zybitExperimentOutcomes)
          .values(syntheticOutcomes)
          .onConflictDoNothing();

        progress(onProgress, 'insights', 'running Layer 2 calibration pass (step 4.6)');
        const insights2 = await runPhase2InsightsPipeline({
          organizationId,
          siteId,
          window: {
            start: new Date(sessionStart.getTime() - padMs).toISOString(),
            end: new Date(sessionEnd.getTime() + padMs).toISOString(),
          },
          maxFindings: 50,
        });
        const calibratedDiags = (insights2.auditReport?.diagnostics ?? []).filter(
          (d) => d.calibration && d.calibration.direction !== 'neutral',
        );
        layer2Result = {
          calibrated: calibratedDiags.length > 0,
          calibratedRuleCount: calibratedDiags.length,
          calibrationSummary: calibratedDiags.map((d) => ({
            ruleId: d.ruleId,
            direction: d.calibration!.direction,
            multiplier: d.calibration!.multiplier,
          })),
        };
        progress(
          onProgress,
          'insights',
          `layer2: ${calibratedDiags.length} rule(s) calibrated — ${
            calibratedDiags.map((d) => `${d.ruleId}(×${d.calibration!.multiplier.toFixed(2)})`).join(', ') || 'none'
          }`,
        );
      } catch (err) {
        progress(
          onProgress,
          'insights',
          `layer2 calibration exercise failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 5) Sample rows for the inspector.
  //
  // Events + snapshots come from the DB so we see the real persisted
  // shape. Findings come from the in-memory auditReport (rather than
  // re-reading forge_findings) so the inspector reflects this run only,
  // not whatever was previously persisted for this site.
  const db = getDb();
  const [eventSample, snapshotSample] = await Promise.all([
    db
      .select({
        id: phase1Events.id,
        type: phase1Events.type,
        path: phase1Events.path,
        source: phase1Events.source,
        occurredAt: phase1Events.occurredAt,
      })
      .from(phase1Events)
      .where(eq(phase1Events.siteId, siteId))
      .limit(5),
    db
      .select({
        pathRef: phase2PageSnapshots.pathRef,
        url: phase2PageSnapshots.url,
        contentHash: phase2PageSnapshots.contentHash,
        fetchedAt: phase2PageSnapshots.fetchedAt,
      })
      .from(phase2PageSnapshots)
      .where(eq(phase2PageSnapshots.siteId, siteId))
      .limit(5),
  ]);
  const findingsSample = auditFindings.slice(0, 10).map((f) => ({
    ruleId: f.ruleId,
    pathRef: f.pathRef,
    title: f.title,
    priorityScore: f.priorityScore,
    severity: f.severity,
    category: f.category,
    summary: f.summary,
  }));

  progress(onProgress, 'done', 'scenario complete');
  return {
    runId,
    scenarioId: scenario.id,
    organizationId,
    siteId,
    counts: {
      sessions,
      events: written,
      snapshots: snapshotsTaken,
      findings: auditFindings.length,
    },
    sample: {
      events: eventSample,
      snapshots: snapshotSample,
      findings: findingsSample,
    },
    startedAt,
    finishedAt: now(),
    ...(flowGraphResult ? { flowGraph: flowGraphResult } : {}),
    ...(experimentSummary ? { experiment: experimentSummary } : {}),
    ...(layer2Result ? { layer2: layer2Result } : {}),
    ...(snapshotErrors.length ? { snapshotErrors } : {}),
  };
}

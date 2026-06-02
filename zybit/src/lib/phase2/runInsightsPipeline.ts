import { incrementUsage } from '@/lib/billing/usage';
import { createPhase1Repository, generateFindings } from '@/lib/phase1';
import { buildInsightInputFromEvents, runInsightInputGate } from '@/lib/phase2';
import type { Phase2SiteConfig, RollupContext, RunInsightsResponse, TimeWindow } from '@/lib/phase2/types';
import { runAuditRules } from '@/lib/phase2/rules';
import { applyLearnRerank } from '@/lib/phase2/rules/learnReranker';
import { computeRuleCalibrations } from '@/lib/phase2/rules/ruleCalibration';
import type { AuditMode } from '@/lib/phase2/rules/types';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';
import { buildCaptureIndex, isCaptureV2Enabled } from '@/lib/phase2/capture';
import { createCaptureRepository } from '@/lib/phase2/capture/repository';
import type { PageCapture } from '@/lib/phase2/capture/types';
import { createOutcomesRepository } from '@/lib/phase2/outcomes/repository';
import { deriveFlowGraph } from '@/lib/phase2/flow';
import { classifySiteFromSnapshots } from '@/lib/phase2/classification/siteClassifier';
import { applyLayerB, isLayerBEnabled } from '@/lib/phase2/layerB/orchestrator';
import {
  deriveSiteContext,
  isSiteContextEnabled,
  siteSignalsFromSnapshots,
  type SiteContext,
} from '@/lib/phase2/siteContext';

export interface RunPhase2InsightsArgs {
  organizationId: string;
  siteId: string;
  window: TimeWindow;
  maxFindings: number;
  /**
   * Where this pipeline run lives. `'public-audit'` flips `runAuditRules`
   * into fail-closed mode: only rules with a declared `publicAuditBehavior`
   * emit, and `'structural-only'` rules' findings are rewritten in-place
   * before persistence. Defaults to `'in-app'`.
   */
  mode?: AuditMode;
  /**
   * Layer B (LLM finding prose) on/off override. When omitted, the
   * `LLM_REFACTOR_ENABLED` env flag decides (production default: off).
   * The Lighthouse GUI passes an explicit boolean so an operator can run
   * the same audit both ways and compare.
   */
  layerB?: boolean;
  /**
   * Compare mode — derive facts from evidence so EVERY finding is Layer-B
   * eligible (not just rules with their own factsJson). Lighthouse's Compare
   * button sets this with `layerB: true`.
   */
  layerBDeriveFacts?: boolean;
  /**
   * SiteContext (LLM context enrichment) on/off override. When omitted the
   * `LLM_SITE_CONTEXT_ENABLED` env flag decides. The eval harness passes an
   * explicit boolean so it can run the same audit with and without context.
   */
  siteContext?: boolean;
}

function emptyConfig(siteId: string, organizationId: string): Phase2SiteConfig {
  return {
    siteId,
    organizationId,
    cohortDimensions: [],
    onboardingSteps: [],
    ctas: [],
    narratives: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function buildSnapshotIndex(snapshots: PageSnapshot[]): Map<string, PageSnapshot> {
  const map = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    if (!map.has(s.pathRef)) {
      map.set(s.pathRef, s);
    }
  }
  return map;
}

/**
 * Single entry point for Phase 2 insights + audit — used by HTTP routes and tests.
 */
export async function runPhase2InsightsPipeline(
  args: RunPhase2InsightsArgs
): Promise<RunInsightsResponse> {
  const { organizationId, siteId, window, maxFindings, mode, layerB, layerBDeriveFacts } = args;
  const siteContextOverride = args.siteContext;
  const repository = createPhase1Repository();

  const captureEnabled = await isCaptureV2Enabled();

  const [config, events, pageSnapshots, recentCaptures] = await Promise.all([
    repository.getPhase2SiteConfig({ organizationId, siteId }),
    repository.listEventsInWindow({ organizationId, siteId, window }),
    repository.listPageSnapshots({ organizationId, siteId, limit: 200 }),
    captureEnabled
      ? createCaptureRepository().listRecentPageCaptures({ organizationId, siteId, sinceHours: 25, limit: 200 })
      : Promise.resolve([] as PageCapture[]),
  ]);

  const resolvedConfig = config ?? emptyConfig(siteId, organizationId);

  const ctx: RollupContext = {
    siteId,
    window,
    config: resolvedConfig,
    events,
  };

  const generatedAt = new Date().toISOString();
  const rollup = buildInsightInputFromEvents(ctx, generatedAt);
  const gate = runInsightInputGate({
    rollup,
    config: resolvedConfig,
    window,
  });

  const findings = generateFindings(rollup.insightInput, { maxFindings });

  const pageSnapshotsByPath = buildSnapshotIndex(pageSnapshots);
  const pageCapturesByPath = recentCaptures.length > 0
    ? buildCaptureIndex(recentCaptures)
    : undefined;

  // Past outcomes drive both Learn layers for this site. Fetched once and
  // reused: Layer 2 calibrates rule thresholds before the rules run; Layer 1
  // re-ranks the findings the rules produce.
  const pastOutcomes = await createOutcomesRepository().listForSite(organizationId, siteId);
  const calibration = computeRuleCalibrations(pastOutcomes);

  // Flow graph (PRD Milestone 1) — derived deterministically from the same
  // windowed events. Feeds the flow-aware audit rule and the /app/flow view.
  const flowGraph = deriveFlowGraph({
    siteId,
    windowStart: window.start,
    windowEnd: window.end,
    events,
    generatedAt,
  });

  const siteNiche = classifySiteFromSnapshots(pageSnapshots);

  const auditReport = runAuditRules({
    organizationId,
    siteId,
    window,
    config: resolvedConfig,
    events,
    rollup,
    pageSnapshots,
    pageSnapshotsByPath,
    calibration,
    flowGraph,
    siteNiche,
    ...(mode ? { mode } : {}),
    ...(pageCapturesByPath ? { pageCapturesByPath } : {}),
  });

  // Layer 1 Learn — re-rank by past outcomes for this site. Pure fn, no schema
  // change. Findings still surface — order and learnAdjustment metadata shift.
  auditReport.findings = applyLearnRerank(auditReport.findings, pastOutcomes);

  // SiteContext (LLM context enrichment) — computed once per audit from the
  // homepage signals, gated by LLM_SITE_CONTEXT_ENABLED. Only computed when
  // Layer B will actually run (it's the sole consumer here), so the flag-off /
  // Layer-B-off paths add zero cost. Fail-soft: deriveSiteContext returns null
  // on any error and Layer B prose is then written exactly as before.
  let siteContext: SiteContext | null = null;
  if (isSiteContextEnabled(siteContextOverride) && isLayerBEnabled(typeof layerB === 'boolean' ? layerB : undefined)) {
    const { url, signals } = siteSignalsFromSnapshots(pageSnapshots);
    siteContext = await deriveSiteContext({ url: url ?? '', signals }).catch(() => null);
  }

  // Layer B (LLM finding prose) — post-pass over the ranked findings. Off by
  // default; swaps narrative prose for grounded LLM prose on the top findings
  // when enabled, falling back to the rule's template on any failure. Never
  // touches the deterministic decision or any number. Telemetry is surfaced
  // for Lighthouse + the eval harness.
  const layerBResult = await applyLayerB(auditReport.findings, { pageSnapshotsByPath, siteContext }, {
    ...(typeof layerB === 'boolean' ? { enabled: layerB } : {}),
    ...(layerBDeriveFacts ? { deriveFactsFromEvidence: true } : {}),
  });
  auditReport.findings = layerBResult.findings;

  // Best-effort: never block or fail an insights run on a usage write.
  incrementUsage(organizationId, 'insightsRuns', 1).catch(() => {});

  return {
    siteId,
    window,
    generatedAt,
    findings,
    warnings: gate.warnings,
    diagnostics: rollup.diagnostics,
    trustworthy: gate.ok,
    flowGraph,
    auditReport,
    layerB: layerBResult.telemetry,
  };
}

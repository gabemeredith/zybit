import { incrementUsage } from '@/lib/billing/usage';
import { createPhase1Repository, generateFindings } from '@/lib/phase1';
import { buildInsightInputFromEvents, runInsightInputGate } from '@/lib/phase2';
import type { Phase2SiteConfig, RollupContext, RunInsightsResponse, TimeWindow } from '@/lib/phase2/types';
import { runAuditRules } from '@/lib/phase2/rules';
import { applyLearnRerank } from '@/lib/phase2/rules/learnReranker';
import { computeRuleCalibrations } from '@/lib/phase2/rules/ruleCalibration';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';
import { buildCaptureIndex, isCaptureV2Enabled } from '@/lib/phase2/capture';
import { createCaptureRepository } from '@/lib/phase2/capture/repository';
import type { PageCapture } from '@/lib/phase2/capture/types';
import { createOutcomesRepository } from '@/lib/phase2/outcomes/repository';

export interface RunPhase2InsightsArgs {
  organizationId: string;
  siteId: string;
  window: TimeWindow;
  maxFindings: number;
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
  const { organizationId, siteId, window, maxFindings } = args;
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
    ...(pageCapturesByPath ? { pageCapturesByPath } : {}),
  });

  // Layer 1 Learn — re-rank by past outcomes for this site. Pure fn, no schema
  // change. Findings still surface — order and learnAdjustment metadata shift.
  auditReport.findings = applyLearnRerank(auditReport.findings, pastOutcomes);

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
    auditReport,
  };
}

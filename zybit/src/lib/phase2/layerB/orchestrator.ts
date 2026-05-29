/**
 * Layer B orchestrator — the post-pass that runs over a whole audit's
 * findings and decides, per finding, whether to swap the deterministic
 * template prose for LLM-generated prose.
 *
 * Contract:
 *   - Only findings that carry `factsJson` (i.e. rules converted to the
 *     Layer A/B contract) are eligible. Everything else is left untouched.
 *   - Eligible findings are ranked by `priorityScore` and only the top N
 *     are sent to Layer B — bounds cost to a few calls per audit.
 *   - On a successful, grounded Layer B result the finding's `summary`,
 *     `recommendation`, and `prescription` are replaced and `proseSource`
 *     is set to `'llm-v1'`. On any failure the finding keeps its template
 *     prose and `proseSource` is `'template'`.
 *   - Every attempt is recorded in `LayerBRunTelemetry` — including the
 *     fallback reason — so Lighthouse and the eval harness read the numbers
 *     off one object instead of re-deriving them.
 *
 * The deterministic decision (whether a finding fires, its numbers) is NOT
 * touched here. This module only rewrites narrative phrasing.
 */

import type { AuditFinding } from '@/lib/phase2/rules/types';
import type { PageSnapshot, PageType } from '@/lib/phase2/snapshots/types';
import {
  runLayerBTraced,
  type LayerBCallTelemetry,
  type LayerBInput,
  type LayerBRunOpts,
} from './runLayerB';

/** Default number of top findings (by priorityScore) sent to Layer B. */
export const LAYER_B_TOP_N = 4;

/**
 * Resolve whether Layer B is enabled. An explicit boolean (e.g. the
 * Lighthouse GUI toggle) always wins; otherwise fall back to the
 * `LLM_REFACTOR_ENABLED=1` env switch (production default: off).
 */
export function isLayerBEnabled(override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  return process.env.LLM_REFACTOR_ENABLED === '1';
}

/** The three narrative fields Layer B owns, captured as a pair per finding. */
export interface LayerBProse {
  summary: string;
  recommendation: string[];
  prescription: AuditFinding['prescription'];
}

export interface LayerBFindingTelemetry {
  findingId: string;
  ruleId: string;
  pathRef: string | null;
  pageType: PageType;
  priorityScore: number;
  category: string;
  proseSource: 'template' | 'llm-v1';
  call: LayerBCallTelemetry;
  /** Both versions, so the GUI can show a side-by-side before the judge exists. */
  prose: { template: LayerBProse; llm: LayerBProse | null };
}

export interface LayerBRunTelemetry {
  enabled: boolean;
  model: string;
  /** Eligible findings actually sent to Layer B (had factsJson, in top N). */
  attempted: number;
  /** Findings where the LLM prose won (proseSource === 'llm-v1'). */
  llmWon: number;
  /** Findings that fell back to template prose. */
  fellBack: number;
  fallbackRate: number;
  fabricationRejections: number;
  fabricationRejectionRate: number;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  totalPromptTokens: number;
  totalResponseTokens: number;
  estTotalCostUsd: number;
  proseSourceCounts: { template: number; 'llm-v1': number };
  findings: LayerBFindingTelemetry[];
}

export interface ApplyLayerBContext {
  /** Snapshot per pathRef — source of pageType (and, later, brand tokens). */
  pageSnapshotsByPath: Map<string, PageSnapshot>;
}

export interface ApplyLayerBOpts extends LayerBRunOpts {
  /** Explicit on/off; overrides the env flag. */
  enabled?: boolean;
  /** Override the top-N cap (tests). */
  topN?: number;
}

function proseOf(finding: AuditFinding): LayerBProse {
  return {
    summary: finding.summary,
    recommendation: finding.recommendation,
    prescription: finding.prescription,
  };
}

function pageTypeFor(
  finding: AuditFinding,
  ctx: ApplyLayerBContext,
): PageType {
  if (!finding.pathRef) return 'unknown';
  return ctx.pageSnapshotsByPath.get(finding.pathRef)?.data.visualSignals?.pageType ?? 'unknown';
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Run Layer B over a findings array. Returns the (possibly prose-swapped)
 * findings plus a telemetry record. Never throws — a per-finding failure
 * degrades that finding to template prose and is recorded.
 */
export async function applyLayerB(
  findings: AuditFinding[],
  ctx: ApplyLayerBContext,
  opts?: ApplyLayerBOpts,
): Promise<{ findings: AuditFinding[]; telemetry: LayerBRunTelemetry }> {
  const enabled = isLayerBEnabled(opts?.enabled);
  const topN = opts?.topN ?? LAYER_B_TOP_N;

  const empty: LayerBRunTelemetry = {
    enabled,
    model: '',
    attempted: 0,
    llmWon: 0,
    fellBack: 0,
    fallbackRate: 0,
    fabricationRejections: 0,
    fabricationRejectionRate: 0,
    latencyMsP50: null,
    latencyMsP95: null,
    totalPromptTokens: 0,
    totalResponseTokens: 0,
    estTotalCostUsd: 0,
    proseSourceCounts: { template: 0, 'llm-v1': 0 },
    findings: [],
  };

  if (!enabled) return { findings, telemetry: empty };

  // Eligible = converted rules (carry factsJson), ranked by priority, capped.
  const eligibleIds = new Set(
    [...findings]
      .filter((f) => f.factsJson)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, topN)
      .map((f) => f.id),
  );

  if (eligibleIds.size === 0) return { findings, telemetry: empty };

  const perFinding: LayerBFindingTelemetry[] = [];

  const out = await Promise.all(
    findings.map(async (finding): Promise<AuditFinding> => {
      if (!eligibleIds.has(finding.id) || !finding.factsJson) return finding;

      const template = proseOf(finding);
      const input: LayerBInput = {
        ruleId: finding.ruleId,
        category: finding.category,
        title: finding.title,
        pageType: pageTypeFor(finding, ctx),
        pathRef: finding.pathRef,
        factsJson: finding.factsJson,
        // Brand tokens live on a separate design-snapshot row; enriching the
        // input with them is a Layer 1B (brand-voice) concern, not the wire.
        designTokens: null,
      };

      const { output, telemetry } = await runLayerBTraced(input, opts);
      const proseSource: 'template' | 'llm-v1' = output ? 'llm-v1' : 'template';

      perFinding.push({
        findingId: finding.id,
        ruleId: finding.ruleId,
        pathRef: finding.pathRef,
        pageType: input.pageType,
        priorityScore: finding.priorityScore,
        category: finding.category,
        proseSource,
        call: telemetry,
        prose: { template, llm: output },
      });

      if (!output) return { ...finding, proseSource };
      return {
        ...finding,
        summary: output.summary,
        recommendation: output.recommendation,
        prescription: output.prescription,
        proseSource,
      };
    }),
  );

  const latencies = perFinding
    .map((f) => f.call.latencyMs)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  const llmWon = perFinding.filter((f) => f.proseSource === 'llm-v1').length;
  const fellBack = perFinding.length - llmWon;
  const fabricationRejections = perFinding.filter(
    (f) => f.call.outcome === 'fabrication-reject',
  ).length;

  const telemetry: LayerBRunTelemetry = {
    enabled,
    model: perFinding[0]?.call.model ?? '',
    attempted: perFinding.length,
    llmWon,
    fellBack,
    fallbackRate: perFinding.length ? fellBack / perFinding.length : 0,
    fabricationRejections,
    fabricationRejectionRate: perFinding.length
      ? fabricationRejections / perFinding.length
      : 0,
    latencyMsP50: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    totalPromptTokens: perFinding.reduce((s, f) => s + (f.call.promptTokens ?? 0), 0),
    totalResponseTokens: perFinding.reduce((s, f) => s + (f.call.responseTokens ?? 0), 0),
    estTotalCostUsd: perFinding.reduce((s, f) => s + (f.call.estCostUsd ?? 0), 0),
    proseSourceCounts: { template: fellBack, 'llm-v1': llmWon },
    findings: perFinding,
  };

  return { findings: out, telemetry };
}

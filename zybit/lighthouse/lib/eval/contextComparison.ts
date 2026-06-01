/**
 * Context A/B eval — the "is it noticeably better?" test environment.
 *
 * Runs the SAME public-URL audit twice in one process: baseline (SiteContext
 * OFF) and enriched (SiteContext ON), Layer B ON for both so the prose is
 * generated and comparable. Findings are paired by (ruleId, pathRef) so a human
 * can eyeball baseline-vs-enriched prose side by side and mark each valid/invalid.
 *
 * The explicit `siteContext` override (not env mutation) is what makes this
 * race-free — see RunUrlAuditOpts.siteContext / isSiteContextEnabled(override).
 *
 * `pairFindings` is a pure function (unit-tested); `runContextComparison` is the
 * orchestrator that does the two audits.
 */

import { runUrlAudit, type RunUrlAuditOpts } from '../runner/runUrlAudit';
import type { GenerateProgressEvent } from '../types';
import type { SiteContext } from '@/lib/phase2/siteContext';
import type { LayerBRunTelemetry } from '@/lib/phase2/layerB/orchestrator';

export interface FindingProse {
  summary: string;
  whatToChange: string | null;
}

/** Minimal finding shape the comparison needs (subset of AuditFinding). */
export interface ComparableFinding {
  ruleId: string;
  pathRef: string | null;
  title: string;
  summary: string;
  prescription?: { whatToChange?: string } | null;
}

export interface ComparisonRow {
  /** `ruleId` + `pathRef` — stable identity across the two runs. */
  key: string;
  ruleId: string;
  pathRef: string | null;
  title: string;
  /** `null` when the finding did NOT fire in that run. */
  baseline: FindingProse | null;
  enriched: FindingProse | null;
  /** Prose differs between the two runs (only meaningful when both present). */
  changed: boolean;
  /** Fired in one run but not the other (SiteContext shifted a copy-critique score). */
  presenceDiff: boolean;
}

export interface ContextComparison {
  url: string;
  /** The SiteContext the enriched run inferred (from its Layer B telemetry). */
  siteContext: SiteContext | null;
  baselineCount: number;
  enrichedCount: number;
  /** Rows where the prose changed or presence differs — the interesting ones first. */
  rows: ComparisonRow[];
}

function keyOf(f: { ruleId: string; pathRef: string | null }): string {
  return `${f.ruleId}|${f.pathRef ?? '*'}`;
}

function proseOf(f: ComparableFinding): FindingProse {
  return { summary: f.summary, whatToChange: f.prescription?.whatToChange ?? null };
}

function proseEqual(a: FindingProse, b: FindingProse): boolean {
  return a.summary === b.summary && a.whatToChange === b.whatToChange;
}

/**
 * Pair baseline and enriched findings into comparison rows. Pure + deterministic.
 * Rows are ordered: changed/presence-diff first (the ones worth reviewing), then
 * unchanged, each group stable by key.
 */
export function pairFindings(
  baseline: ComparableFinding[],
  enriched: ComparableFinding[],
): ComparisonRow[] {
  const baseByKey = new Map(baseline.map((f) => [keyOf(f), f]));
  const enrByKey = new Map(enriched.map((f) => [keyOf(f), f]));
  const keys = [...new Set([...baseByKey.keys(), ...enrByKey.keys()])].sort();

  const rows: ComparisonRow[] = keys.map((key) => {
    const b = baseByKey.get(key) ?? null;
    const e = enrByKey.get(key) ?? null;
    const ref = b ?? e!;
    const baselineProse = b ? proseOf(b) : null;
    const enrichedProse = e ? proseOf(e) : null;
    const presenceDiff = !b || !e;
    const changed =
      !presenceDiff && !!baselineProse && !!enrichedProse && !proseEqual(baselineProse, enrichedProse);
    return {
      key,
      ruleId: ref.ruleId,
      pathRef: ref.pathRef,
      title: ref.title,
      baseline: baselineProse,
      enriched: enrichedProse,
      changed,
      presenceDiff,
    };
  });

  const rank = (r: ComparisonRow): number => (r.presenceDiff ? 0 : r.changed ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

/**
 * Map a run's Layer B telemetry to the comparison shape. The "effective" prose
 * is the LLM prose when it survived (`prose.llm`), else the deterministic
 * template — i.e. exactly what the PM would have seen for that run.
 */
export function findingsFromTelemetry(t: LayerBRunTelemetry | null | undefined): ComparableFinding[] {
  return (t?.findings ?? []).map((f) => {
    const p = f.prose.llm ?? f.prose.template;
    return {
      ruleId: f.ruleId,
      pathRef: f.pathRef,
      title: f.ruleId,
      summary: p.summary,
      prescription: { whatToChange: p.prescription?.whatToChange },
    };
  });
}

export interface RunContextComparisonOpts {
  url: string;
  maxPages?: number;
  visionPagesLimit?: number;
  onProgress?: (event: GenerateProgressEvent) => void;
}

/**
 * Run the baseline + enriched audits sequentially and build the comparison.
 * Sequential (not parallel) so the two runs don't contend on the shared
 * synthetic org/site rows the runner provisions per URL.
 */
export async function runContextComparison(
  opts: RunContextComparisonOpts,
): Promise<ContextComparison> {
  const base: Omit<RunUrlAuditOpts, 'siteContext'> = {
    url: opts.url,
    maxPages: opts.maxPages ?? 8,
    // Layer B ON + derive-facts so EVERY finding gets prose and is comparable
    // (not just the handful with their own factsJson).
    layerB: true,
    layerBDeriveFacts: true,
    ...(opts.visionPagesLimit !== undefined ? { visionPagesLimit: opts.visionPagesLimit } : { visionPagesLimit: 3 }),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  };

  opts.onProgress?.({ step: 'insights', message: 'baseline run (SiteContext OFF)', at: new Date().toISOString() });
  const baseline = await runUrlAudit({ ...base, siteContext: false });

  opts.onProgress?.({ step: 'insights', message: 'enriched run (SiteContext ON)', at: new Date().toISOString() });
  const enriched = await runUrlAudit({ ...base, siteContext: true });

  const baseFindings = findingsFromTelemetry(baseline.layerB);
  const enrFindings = findingsFromTelemetry(enriched.layerB);

  return {
    url: opts.url,
    siteContext: enriched.layerB?.siteContext ?? null,
    baselineCount: baseFindings.length,
    enrichedCount: enrFindings.length,
    rows: pairFindings(baseFindings, enrFindings),
  };
}

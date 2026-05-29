/**
 * FORGE-090 — The Visible Loop
 *
 * /app/loop — top-level page showing the full optimize cycle for a site.
 *
 * This is the product's most important view:
 *   - The demo that beats "ChatGPT can do this" in 10 seconds
 *   - The renewal story: what was detected, what was tested, what moved
 *   - The visible compound: each cycle tighter than the last
 *
 * Timeline entries (in chronological order):
 *   1. DETECTED — "Zybit detected [finding] on [page]" + evidence summary
 *   2. DEPLOYED — "Experiment launched: [hypothesis]" + traffic split
 *   3. RESULT   — "Variant X% vs Control Y% — +Npp (Z% relative), p=confidence"
 *                 OR "Guardrail breached: [metric]" (if stopped early)
 *                 OR "Inconclusive after N days" (if no significance)
 *   4. LEARNED  — "Signal adjusted: [rule] raised threshold on [page]" (requires Phase 2)
 *
 * Data sources:
 *   - zybit_findings (detection events, evidence)
 *   - zybit_experiments (deployment, hypothesis, dates)
 *   - zybit_experiment_outcomes (results, lift, confidence)
 *
 * Built: timeline merge (detections/deployments/results), per-entry
 * rendering, empty state, detail links, guardrail-breach amber flag
 * (Zybit-091), multi-site selector (Zybit-092), LEARNED entry with Layer 1
 * re-ranking consequence (Zybit-093), and Layer 2 calibration note when the
 * rule's threshold was tuned for this site.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq, and, desc } from 'drizzle-orm';
import { getServerAuth } from '@/lib/auth/serverAuth';
import { getDb } from '@/lib/db/client';
import { phase1Sites, zybitFindings, zybitExperiments, zybitExperimentOutcomes } from '@/lib/db/schema';
import { computeRuleCalibrations } from '@/lib/phase2/rules/ruleCalibration';
import { createOutcomesRepository } from '@/lib/phase2/outcomes/repository';
import { readPreviewProjectionNote, type PreviewProjectionNote } from '@/lib/experiments/previewExperiment';

// ---------------------------------------------------------------------------
// Timeline entry types
// ---------------------------------------------------------------------------

type DetectionEntry = {
  kind: 'detection';
  date: Date;
  findingId: string;
  title: string;
  pathRef: string | null;
  severity: string;
  evidenceSummary: string; // one-line: e.g. "42% abandonment rate on /checkout"
};

type DeploymentEntry = {
  kind: 'deployment';
  date: Date;
  experimentId: string;
  findingId: string | null;
  hypothesis: string;
  controlPct: number;
  variantPct: number;
  /** Free-experiment loop §5: a projected preview, never deployed to traffic. */
  previewOnly?: boolean;
  variantDescription?: string | null;
};

type ResultEntry = {
  kind: 'result';
  date: Date;
  experimentId: string;
  result: string; // 'positive' | 'negative' | 'inconclusive' | 'projected'
  liftPct: number | null;
  confidence: number | null;
  controlRate: number | null;
  variantRate: number | null;
  guardrailBreached: string | null;
  participants: number | null;
  /** Present when this is a projected (preview) result, not a measured one. */
  projected?: PreviewProjectionNote | null;
};

type LearnedEntry = {
  kind: 'learned';
  date: Date;
  experimentId: string;
  ruleId: string | null;
  pathRef: string | null;
  modificationType: string | null;
  result: string;
  liftPct: number | null;
  guardrailBreached: string | null;
  /** Layer 2 calibration state for this rule at the time of this entry. */
  calibration?: {
    direction: 'loosen' | 'tighten';
    reason: string;
    conclusiveCount: number;
  };
};

type TimelineEntry = DetectionEntry | DeploymentEntry | ResultEntry | LearnedEntry;

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function loadTimeline(
  db: ReturnType<typeof getDb>,
  orgId: string,
  siteId: string,
): Promise<TimelineEntry[]> {
  // Fetch past outcomes via the outcomes repository so we have the full
  // ExperimentOutcomeRow shape needed for computeRuleCalibrations.
  const pastOutcomes = await createOutcomesRepository().listForSite(orgId, siteId);
  const calibrations = computeRuleCalibrations(pastOutcomes);

  const [findings, experiments, outcomes] = await Promise.all([
    db
      .select({
        id: zybitFindings.id,
        title: zybitFindings.title,
        pathRef: zybitFindings.pathRef,
        severity: zybitFindings.severity,
        summary: zybitFindings.summary,
        evidence: zybitFindings.evidence,
        createdAt: zybitFindings.createdAt,
      })
      .from(zybitFindings)
      .where(and(eq(zybitFindings.siteId, siteId), eq(zybitFindings.organizationId, orgId)))
      .orderBy(desc(zybitFindings.createdAt)),

    db
      .select({
        id: zybitExperiments.id,
        findingId: zybitExperiments.findingId,
        hypothesis: zybitExperiments.hypothesis,
        audienceControlPct: zybitExperiments.audienceControlPct,
        audienceVariantPct: zybitExperiments.audienceVariantPct,
        status: zybitExperiments.status,
        previewOnly: zybitExperiments.previewOnly,
        notes: zybitExperiments.notes,
        startedAt: zybitExperiments.startedAt,
        createdAt: zybitExperiments.createdAt,
      })
      .from(zybitExperiments)
      .where(and(eq(zybitExperiments.siteId, siteId), eq(zybitExperiments.organizationId, orgId)))
      .orderBy(desc(zybitExperiments.createdAt)),

    db
      .select({
        experimentId: zybitExperimentOutcomes.experimentId,
        ruleId: zybitExperimentOutcomes.ruleId,
        pathRef: zybitExperimentOutcomes.pathRef,
        modificationType: zybitExperimentOutcomes.modificationType,
        result: zybitExperimentOutcomes.result,
        liftPct: zybitExperimentOutcomes.liftPct,
        confidence: zybitExperimentOutcomes.confidence,
        controlParticipants: zybitExperimentOutcomes.controlParticipants,
        variantParticipants: zybitExperimentOutcomes.variantParticipants,
        controlConversions: zybitExperimentOutcomes.controlConversions,
        variantConversions: zybitExperimentOutcomes.variantConversions,
        guardrailBreached: zybitExperimentOutcomes.guardrailBreached,
        concludedAt: zybitExperimentOutcomes.concludedAt,
      })
      .from(zybitExperimentOutcomes)
      .where(eq(zybitExperimentOutcomes.siteId, siteId)),
  ]);

  const outcomeByExperiment = new Map(outcomes.map((o) => [o.experimentId, o]));
  const entries: TimelineEntry[] = [];

  for (const f of findings) {
    const topEvidence = f.evidence[0];
    const evidenceSummary = topEvidence
      ? `${topEvidence.label}: ${topEvidence.value}`
      : f.summary.slice(0, 80);
    entries.push({
      kind: 'detection',
      date: f.createdAt,
      findingId: f.id,
      title: f.title,
      pathRef: f.pathRef,
      severity: f.severity,
      evidenceSummary,
    });
  }

  for (const exp of experiments) {
    if (exp.status === 'draft') continue;

    // Free-experiment loop §5: a preview experiment was never deployed to real
    // traffic — it shows as a "Proposed" step followed by a "Projected" result,
    // distinct from a measured outcome. No outcome row exists for it.
    if (exp.previewOnly) {
      const preview = readPreviewProjectionNote(exp.notes);
      const date = exp.startedAt ?? exp.createdAt;
      entries.push({
        kind: 'deployment',
        date,
        experimentId: exp.id,
        findingId: exp.findingId,
        hypothesis: exp.hypothesis,
        controlPct: exp.audienceControlPct,
        variantPct: exp.audienceVariantPct,
        previewOnly: true,
        variantDescription: preview?.variantDescription ?? null,
      });
      if (preview) {
        entries.push({
          kind: 'result',
          date: new Date(date.getTime() + 1_000), // sort right after the proposal
          experimentId: exp.id,
          result: 'projected',
          liftPct: null,
          confidence: null,
          controlRate: null,
          variantRate: null,
          guardrailBreached: null,
          participants: null,
          projected: preview.projection,
        });
      }
      continue;
    }

    entries.push({
      kind: 'deployment',
      date: exp.startedAt ?? exp.createdAt,
      experimentId: exp.id,
      findingId: exp.findingId,
      hypothesis: exp.hypothesis,
      controlPct: exp.audienceControlPct,
      variantPct: exp.audienceVariantPct,
    });

    const outcome = outcomeByExperiment.get(exp.id);
    if (outcome) {
      const controlRate =
        outcome.controlParticipants != null && outcome.controlParticipants > 0
          ? (outcome.controlConversions ?? 0) / outcome.controlParticipants
          : null;
      const variantRate =
        outcome.variantParticipants != null && outcome.variantParticipants > 0
          ? (outcome.variantConversions ?? 0) / outcome.variantParticipants
          : null;
      entries.push({
        kind: 'result',
        date: outcome.concludedAt,
        experimentId: exp.id,
        result: outcome.result,
        liftPct: outcome.liftPct,
        confidence: outcome.confidence,
        controlRate,
        variantRate,
        guardrailBreached: outcome.guardrailBreached,
        participants:
          (outcome.controlParticipants ?? 0) + (outcome.variantParticipants ?? 0),
      });

      // LEARNED entry (Zybit-093) — one minute after the result so chronological
      // order reads "we saw the result, then the model learned from it."
      const ruleCalibration = outcome.ruleId ? calibrations.get(outcome.ruleId) : undefined;
      entries.push({
        kind: 'learned',
        date: new Date(outcome.concludedAt.getTime() + 60_000),
        experimentId: exp.id,
        ruleId: outcome.ruleId,
        pathRef: outcome.pathRef,
        modificationType: outcome.modificationType,
        result: outcome.result,
        liftPct: outcome.liftPct,
        guardrailBreached: outcome.guardrailBreached,
        ...(ruleCalibration && ruleCalibration.direction !== 'neutral'
          ? {
              calibration: {
                direction: ruleCalibration.direction,
                reason: ruleCalibration.reason,
                conclusiveCount: ruleCalibration.conclusiveCount,
              },
            }
          : {}),
      });
    }
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return entries;
}

// ---------------------------------------------------------------------------
// Site selection
// ---------------------------------------------------------------------------

async function loadSites(
  db: ReturnType<typeof getDb>,
  orgId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: phase1Sites.id, name: phase1Sites.name })
    .from(phase1Sites)
    .where(eq(phase1Sites.organizationId, orgId));
  return rows;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function EntryIcon({ entry }: { entry: TimelineEntry }) {
  // detection: magnifying glass · deployment: rocket · result: chart · learned: brain
  // Preview variants read as "proposed" (lightbulb) → "projected" (crystal ball).
  if (entry.kind === 'deployment' && entry.previewOnly) {
    return <span className="text-lg">💡</span>;
  }
  if (entry.kind === 'result' && entry.projected) {
    return <span className="text-lg">🔮</span>;
  }
  const icons: Record<TimelineEntry['kind'], string> = {
    detection: '🔍',
    deployment: '🚀',
    result: '📊',
    learned: '🧠',
  };
  return <span className="text-lg">{icons[entry.kind]}</span>;
}

function EntryLabel({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'detection') {
    return (
      <div>
        <Link href={`/app/findings/${entry.findingId}`} className="font-medium hover:underline">
          {entry.title}
        </Link>
        {entry.pathRef && (
          <span className="ml-2 text-[#6B6B6B] text-sm font-mono">{entry.pathRef}</span>
        )}
        <p className="text-sm text-[#6B6B6B] mt-0.5">{entry.evidenceSummary}</p>
      </div>
    );
  }

  if (entry.kind === 'deployment') {
    return (
      <div>
        <Link href={`/app/experiments/${entry.experimentId}`} className="font-medium hover:underline">
          {entry.hypothesis}
        </Link>
        <p className="text-sm text-[#6B6B6B] mt-0.5">
          {entry.previewOnly
            ? entry.variantDescription ?? 'Proposed experiment — not yet deployed to real traffic.'
            : `${entry.controlPct}% control / ${entry.variantPct}% variant`}
        </p>
      </div>
    );
  }

  if (entry.kind === 'result') {
    if (entry.projected) {
      const { liftPctRange, basisNote } = entry.projected;
      return (
        <div>
          <Link href={`/app/experiments/${entry.experimentId}`} className="font-medium hover:underline">
            Projected{' '}
            <span className="brut-badge bg-[#00E5FF] text-[#111] align-middle">
              +{liftPctRange.min}–{liftPctRange.max}%
            </span>
          </Link>
          <p className="text-xs text-[#9B9B9B] mt-1">{basisNote}</p>
        </div>
      );
    }

    const breached = Boolean(entry.guardrailBreached);
    const resultColor =
      entry.result === 'positive'
        ? 'text-emerald-700'
        : entry.result === 'negative'
          ? 'text-red-600'
          : 'text-[#6B6B6B]';

    return (
      <div>
        <Link href={`/app/experiments/${entry.experimentId}`} className="font-medium hover:underline">
          Experiment{' '}
          {breached ? (
            <span className="brut-badge bg-amber-300 text-[#111] align-middle">
              ⚠ Guardrail breached
            </span>
          ) : (
            <span className={resultColor}>
              {entry.result === 'positive'
                ? `+${entry.liftPct?.toFixed(1)}pp`
                : entry.result === 'negative'
                  ? `${entry.liftPct?.toFixed(1)}pp`
                  : 'inconclusive'}
            </span>
          )}
        </Link>
        {breached && (
          <p className="text-sm text-amber-700 mt-0.5">
            Stopped early — {entry.guardrailBreached}
          </p>
        )}
        {!breached && entry.controlRate !== null && entry.variantRate !== null && (
          <p className="text-sm text-[#6B6B6B] mt-0.5">
            Variant {(entry.variantRate * 100).toFixed(2)}% vs Control{' '}
            {(entry.controlRate * 100).toFixed(2)}%
            {entry.confidence !== null && ` — p=${((1 - entry.confidence) * 100).toFixed(1)}%`}
          </p>
        )}
      </div>
    );
  }

  if (entry.kind === 'learned') {
    return (
      <div>
        <p className="font-medium">{learnedSentence(entry)}</p>
        <p className="text-sm text-[#6B6B6B] mt-0.5">{learnedConsequence(entry)}</p>
        {entry.calibration && (
          <p className="text-xs text-violet-600 mt-1 font-medium">
            Detection threshold {entry.calibration.direction === 'loosen' ? 'loosened' : 'raised'} based on{' '}
            {entry.calibration.conclusiveCount} concluded experiment{entry.calibration.conclusiveCount === 1 ? '' : 's'} on this site.
          </p>
        )}
      </div>
    );
  }

  return null;
}

function learnedSentence(e: LearnedEntry): string {
  const rule = e.ruleId ?? 'this rule';
  const path = e.pathRef ?? '(site-wide)';
  if (e.guardrailBreached) {
    return `Your ${rule} variant on ${path} was stopped early — breached ${e.guardrailBreached}.`;
  }
  if (e.result === 'positive') {
    return `You tested ${rule} on ${path} — variant won +${(e.liftPct ?? 0).toFixed(1)}%.`;
  }
  if (e.result === 'negative') {
    return `You tested ${rule} on ${path} — variant lost ${(e.liftPct ?? 0).toFixed(1)}%.`;
  }
  return `You tested ${rule} on ${path} — inconclusive.`;
}

function learnedConsequence(e: LearnedEntry): string {
  const rule = e.ruleId ?? 'similar';
  if (e.guardrailBreached) {
    const mod = e.modificationType ? `${e.modificationType} variants on ` : '';
    return `Future ${mod}${rule} findings will rank lower until a clean win.`;
  }
  if (e.result === 'positive') {
    return `Future ${rule} findings will rank higher until traffic patterns shift.`;
  }
  if (e.result === 'negative') {
    return `Future ${rule} findings will rank lower until a win.`;
  }
  return 'No ranking change — insufficient signal.';
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function LoopPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const auth = await getServerAuth();
  if (!auth.ok) redirect('/sign-in');
  const orgId = (auth as { ok: true; orgId: string; userId: string }).orgId;

  const db = getDb();

  const sites = await loadSites(db, orgId);
  const sp = await searchParams;
  const siteId = sp.site ?? sites[0]?.id ?? '';

  const timeline = siteId ? await loadTimeline(db, orgId, siteId) : [];

  const kindLabel: Record<TimelineEntry['kind'], string> = {
    detection: 'Detected',
    deployment: 'Deployed',
    result: 'Result',
    learned: 'Learned',
  };

  const entryLabel = (entry: TimelineEntry): string => {
    if (entry.kind === 'deployment' && entry.previewOnly) return 'Proposed';
    if (entry.kind === 'result' && entry.projected) return 'Projected';
    return kindLabel[entry.kind];
  };

  return (
    <main className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">The Loop</h1>
        <p className="text-[#6B6B6B] text-sm mt-1">
          Every finding detected, every experiment deployed, every result measured.
        </p>
      </div>

      {sites.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Site">
          {sites.map((s) => {
            const active = s.id === siteId;
            return (
              <Link
                key={s.id}
                href={`/app/loop?site=${encodeURIComponent(s.id)}`}
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? 'brut-badge bg-[#111] text-white px-3 py-1.5'
                    : 'brut-badge bg-[#F2F2F2] text-[#6B6B6B] px-3 py-1.5 hover:bg-[#E8E8E8] transition-colors'
                }
              >
                {s.name}
              </Link>
            );
          })}
        </div>
      )}

      {timeline.length === 0 ? (
        <div className="brut-card p-12 text-center border-dashed">
          <p className="text-[#6B6B6B] text-sm">
            {siteId
              ? 'No completed experiments yet. Approve a finding to get started.'
              : 'Connect a site to see your loop.'}
          </p>
          {siteId && (
            <Link
              href="/app/findings"
              className="mt-4 inline-block text-sm font-medium underline"
            >
              View findings →
            </Link>
          )}
        </div>
      ) : (
        <ol className="relative border-l-[1.5px] border-black/[0.08] ml-3 space-y-8">
          {timeline.map((entry, i) => (
            <li key={i} className="ml-6">
              <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-white border-[1.5px] border-black/[0.08]">
                <EntryIcon entry={entry} />
              </span>
              <div className="flex items-start gap-4">
                <div className="min-w-[90px] mono-text text-[11px] text-[#9B9B9B] pt-0.5 shrink-0">
                  {dateLabel(entry.date)}
                </div>
                <div className="flex-1">
                  <span className="brut-label mb-1 block">
                    {entryLabel(entry)}
                  </span>
                  <EntryLabel entry={entry} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

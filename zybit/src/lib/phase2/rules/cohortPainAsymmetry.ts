/**
 * Rule: cohort-pain-asymmetry (v2)
 *
 * Composite pain index per cohort: weighted blend of
 *   - rage events / session,
 *   - error events ($exception-mapped `error`) / session,
 *   - shallow-session rate (≤1 path, shallow event count — "can't find what they wanted").
 *
 * Indices are min–max normalized *across cohorts in this dimension*, then compared to the site
 * median composite so spikes on cold cohorts aren't missed when absolute rates are globally low.
 */

import type { CanonicalEvent, CohortDimensionConfig } from "@/lib/phase2/types";

import type { SessionTrace } from "./helpers";
import {
  assignSessionCohort,
  clamp,
  formatCount,
  groupSessions,
  modeStringProp,
  quote,
  round,
  sanitizeIdSegment,
  topByCount,
} from "./helpers";
import { calibratedFloor } from "./ruleCalibration";
import { COHORT_PAIN_ELIGIBILITY, COHORT_PAIN_WEIGHTS } from "./ruleTuning";
import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from "./types";

const {
  compositeAbsoluteFloor,
  epsilon,
  medianMultipleFloor,
  minSessionsPerCohort,
} = COHORT_PAIN_ELIGIBILITY;

const WR = COHORT_PAIN_WEIGHTS.rage;
const WE = COHORT_PAIN_WEIGHTS.error;
const WS = COHORT_PAIN_WEIGHTS.stagnation;

interface CohortBucket {
  label: string;
  sessions: SessionTrace[];
  rageEvents: CanonicalEvent[];
  errorEvents: CanonicalEvent[];
  /** Sessions with at most one path and few events — brittle browse / bounce-ish. */
  stagnationSessions: number;
}

export const cohortPainAsymmetry: AuditRule = {
  id: "cohort-pain-asymmetry",
  name: "Cohort pain asymmetry",
  category: "asymmetry",

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const sessions = groupSessions(ctx.events);
    if (sessions.length === 0) return [];
    const absoluteFloor = calibratedFloor(ctx, "cohort-pain-asymmetry", compositeAbsoluteFloor);
    const findings: AuditFinding[] = [];
    for (const dim of ctx.config.cohortDimensions) {
      const finding = evaluateDimension(dim, sessions, absoluteFloor);
      if (finding !== null) findings.push(finding);
    }
    return findings;
  },
};

function stagnationGuess(session: SessionTrace): boolean {
  return session.paths.length <= 1 && session.events.length <= 5;
}

function evaluateDimension(
  dim: CohortDimensionConfig,
  sessions: SessionTrace[],
  absoluteFloor: number,
): AuditFinding | null {
  const fallback = typeof dim.fallback === "string" ? dim.fallback : "(unassigned)";

  const buckets = new Map<string, CohortBucket>();
  for (const session of sessions) {
    const label = assignSessionCohort(session, dim);
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = {
        label,
        sessions: [],
        rageEvents: [],
        errorEvents: [],
        stagnationSessions: 0,
      };
      buckets.set(label, bucket);
    }
    bucket.sessions.push(session);
    if (stagnationGuess(session)) bucket.stagnationSessions += 1;
    for (const event of session.events) {
      if (event.type === "rage_click") bucket.rageEvents.push(event);
      if (event.type === "error") bucket.errorEvents.push(event);
    }
  }

  const eligible: Array<CohortBucket & { composite: number; rageRate: number; errorRate: number; stagRate: number }> = [];

  for (const bucket of buckets.values()) {
    if (bucket.label === fallback) continue;
    if (bucket.sessions.length < minSessionsPerCohort) continue;
    const n = bucket.sessions.length;
    const rageRate = bucket.rageEvents.length / n;
    const errorRate = bucket.errorEvents.length / n;
    const stagRate = bucket.stagnationSessions / n;
    eligible.push({
      ...bucket,
      rageRate,
      errorRate,
      stagRate,
      composite: 0,
    });
  }

  if (eligible.length < 2) return null;

  const maxR = Math.max(...eligible.map((b) => b.rageRate), epsilon);
  const maxE = Math.max(...eligible.map((b) => b.errorRate), epsilon);
  const maxS = Math.max(...eligible.map((b) => b.stagRate), epsilon);

  for (const b of eligible) {
    const normR = b.rageRate / maxR;
    const normE = b.errorRate / maxE;
    const normS = b.stagRate / maxS;
    b.composite = clamp(WR * normR + WE * normE + WS * normS, 0, 1);
  }

  const rates = eligible.map((b) => b.composite).sort((a, c) => a - c);
  const medianComposite = medianOf(rates);
  if (medianComposite <= 0) return null;

  eligible.sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    return a.label.localeCompare(b.label);
  });

  const top = eligible[0];
  const multiple = top.composite / Math.max(medianComposite, epsilon);
  const absoluteOk = top.composite >= absoluteFloor;
  const multipleOk = multiple >= medianMultipleFloor;
  if (!(absoluteOk && multipleOk)) return null;

  const asc = [...eligible].sort((a, b) => {
    if (a.composite !== b.composite) return a.composite - b.composite;
    return a.label.localeCompare(b.label);
  });

  let referenceRow = asc[Math.floor((asc.length - 1) / 2)];
  if (!referenceRow && asc[0]) referenceRow = asc[0];

  return buildFinding({
    dim,
    top,
    medianComposite,
    multiple,
    referenceRow: referenceRow ?? top,
  });
}

interface Inputs {
  dim: CohortDimensionConfig;
  top: CohortBucket & {
    composite: number;
    rageRate: number;
    errorRate: number;
    stagRate: number;
    stagnationSessions: number;
  };
  medianComposite: number;
  multiple: number;
  referenceRow: CohortBucket & {
    composite: number;
    rageRate: number;
    errorRate: number;
    stagRate: number;
    stagnationSessions: number;
  };
}

function buildFinding(inputs: Inputs): AuditFinding {
  const { dim, top, medianComposite, multiple, referenceRow } = inputs;

  const stagnationPct =
    top.sessions.length > 0
      ? `${Math.round((top.stagnationSessions / top.sessions.length) * 100)}%`
      : "0%";

  const summary =
    `On dimension ${quote(dim.label)}, the cohort ${quote(top.label)} has a composite pain index of ${round(top.composite, 3)} ` +
    `(rage ${round(top.rageRate, 3)} / sess, errors ${round(top.errorRate, 3)}, ${stagnationPct} shallow-session ` +
    `stagnation) — ${round(multiple, 1)}× the cross-cohort median (${round(medianComposite, 3)}). ` +
    `${formatCount(top.sessions.length)} sessions in this cohort.`;

  const para1 =
    `${top.label} users are accumulating friction signals the rest of the audience isn't (` +
    `${round(top.rageRate, 3)} rage/session, ${round(top.errorRate, 3)} errors/session, stagnation-heavy traffic). Pull a ` +
    `recording (\`recording_id\` on rage/error events where present) before deciding what's cultural vs broken.`;

  const para2 =
    `This cohort-level pattern responds to differentiated proof points and onboarding — a single shallow page tweak ` +
    `won't erase the gap. Benchmark against cohort ${quote(referenceRow.label)} (${round(referenceRow.composite, 3)} composite pain).`;

  const topRagePaths = topByCount(top.rageEvents, (e) => e.path).slice(0, 3);
  const topErrorPaths = topByCount(top.errorEvents, (e) => e.path).slice(0, 3);
  const cohortEventsFlat = top.sessions.flatMap((s) => s.events);
  const deviceMode = modeStringProp(cohortEventsFlat, "device_type");

  const evidence: AuditFindingEvidence[] = [
    { label: "Dimension", value: dim.label, context: dim.id },
    { label: "Top cohort", value: top.label },
    {
      label: "Composite pain index",
      value: round(top.composite, 3),
      context: `rage ${WR * 100}% + error ${WE * 100}% + stagn ${WS * 100}% (normalized cohort-to-cohort)`,
    },
    {
      label: "Component rates",
      value: `${round(top.rageRate, 4)} rage / ${round(top.errorRate, 4)} err / ${round(top.stagRate, 4)} shallow`,
    },
    {
      label: "Cross-cohort median (composite)",
      value: round(medianComposite, 3),
      context: `${round(multiple, 1)}× multiple`,
    },
    {
      label: "Reference cohort",
      value: `${quote(referenceRow.label)} (${round(referenceRow.composite, 3)} composite)`,
    },
  ];
  if (topRagePaths.length > 0) {
    evidence.push({
      label: "Top rage paths in cohort",
      value: topRagePaths.map((p) => `${p.key} (${p.count})`).join(", "),
    });
  }
  if (topErrorPaths.length > 0) {
    evidence.push({
      label: "Top error paths in cohort",
      value: topErrorPaths.map((p) => `${p.key} (${p.count})`).join(", "),
    });
  }
  if (deviceMode !== null) evidence.push({ label: "Top device type in cohort", value: deviceMode });

  const topRagePath = topRagePaths[0]?.key ?? null;
  const prescription = {
    whatToChange:
      `Pull session recordings for ${quote(top.label)} users — filter by rage or error events` +
      (topRagePath ? ` on ${topRagePath}` : '') +
      `. Identify the single highest-friction moment and fix it specifically for this cohort's context. ` +
      `Do not apply a site-wide change before understanding whether the cause is content, interaction, or loading.`,
    whyItWorks:
      `${quote(top.label)} users have ${round(multiple, 1)}× the pain index of the cohort median. ` +
      `This gap almost always has a concrete source — a broken feature for a specific device type, a message that doesn't match this cohort's expectation, or a loading issue on a specific plan tier. ` +
      `Watching 5-10 recordings is faster than guessing.`,
    experimentVariantDescription:
      `Once the root cause is identified from recordings: targeted fix for ${quote(top.label)} cohort. ` +
      `Primary metric: composite pain index (rage rate + error rate + shallow-session rate) for ${quote(top.label)} vs ${quote(referenceRow.label)}.`,
  };

  return {
    id: `cohort-pain-asymmetry:${sanitizeIdSegment(dim.id)}:${sanitizeIdSegment(top.label)}`,
    ruleId: "cohort-pain-asymmetry",
    category: "asymmetry",
    severity:
      multiple > COHORT_PAIN_ELIGIBILITY.severityMultipleCritical ? "critical" : "warn",
    confidence: clamp(0.4 + Math.log10(Math.max(top.sessions.length, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(Math.min(top.composite * 2, 1), 0, 1),
    pathRef: null,
    title: `Cohort ${quote(top.label)} pain index ${round(multiple, 1)}× cohort median`,
    summary,
    prescription,
    recommendation: [para1, para2],
    evidence,
  };
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

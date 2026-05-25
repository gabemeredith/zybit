/**
 * Rule: return-visit-thrash
 *
 * Detect sessions that bounce in and out of the same page repeatedly
 * without ever progressing to the path the page is meant to lead them
 * toward. When > 5% of sessions touching the page get caught in this
 * loop, the on-page links toward the next narrative aren't surfacing
 * (or aren't resolving).
 */

import type { VariantModification } from "@/lib/experiments/types";
import type { PageSnapshot } from "@/lib/phase2/snapshots/types";
import type { GoalConfig, GoalType, NarrativeConfig } from "@/lib/phase2/types";

import { ANNOTATION_WARN_COLOR } from "./annotationColors";
import type { SessionTrace } from "./helpers";
import {
  clamp,
  formatCount,
  groupSessions,
  modeStringProp,
  pct,
  pickPrimaryCta,
  quote,
  round,
  sanitizeIdSegment,
  topByCount,
} from "./helpers";
import { calibratedFloor } from "./ruleCalibration";
import { computeImpactEstimate, windowDaysFromTimeWindow } from "./impactEstimate";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
  ProposeModificationsContext,
} from "./types";

const MIN_PATH_SESSIONS = 50;
const MIN_THRASH_RATE = 0.05;
const STRONG_THRASH_RATE = 0.10;
const NARRATIVE_THRESHOLD = 3;
const STRICT_THRESHOLD = 4;

interface ThrashAggregate {
  pathRef: string;
  thrashSessions: number;
  pathSessions: number;
  pathCountsAcrossThrash: number[];
  deviceTags: string[];
  interimPaths: string[];
}

export const returnVisitThrash: AuditRule = {
  id: "return-visit-thrash",
  name: "Return-visit thrash",
  category: "thrash",

  proposeAnnotations(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[] {
    const ref = finding.refs?.ctaRef;
    if (!ref) return [];
    const cta = ctx.snapshot.data.ctas.find((c) => c.ref === ref);
    if (!cta?.cssSelector) return [];
    return [{
      type: 'css-inject',
      selector: cta.cssSelector,
      css: `outline: 3px dashed ${ANNOTATION_WARN_COLOR} !important; outline-offset: 4px;`,
    }];
  },

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const sessions = groupSessions(ctx.events);

    const narrativesBySource = new Map<string, NarrativeConfig>();
    for (const narrative of ctx.config.narratives) {
      // First narrative declared for a source path wins (deterministic).
      if (!narrativesBySource.has(narrative.sourcePathRef)) {
        narrativesBySource.set(narrative.sourcePathRef, narrative);
      }
    }

    const aggregates = new Map<string, ThrashAggregate>();

    for (const session of sessions) {
      const sessionDevice = modeStringProp(session.events, "device_type");
      for (const [pathRef, count] of session.pathCounts) {
        const agg = ensureAggregate(aggregates, pathRef);
        agg.pathSessions += 1;
        if (count < NARRATIVE_THRESHOLD) continue;

        const narrative = narrativesBySource.get(pathRef);
        if (!isThrashSession(session, pathRef, count, narrative)) continue;

        agg.thrashSessions += 1;
        agg.pathCountsAcrossThrash.push(count);
        if (sessionDevice !== null) agg.deviceTags.push(sessionDevice);
        for (const visited of pathsBetweenRevisits(session, pathRef)) {
          if (visited !== pathRef) agg.interimPaths.push(visited);
        }
      }
    }

    const windowDays = windowDaysFromTimeWindow(ctx.window);
    const minThrashRate = calibratedFloor(ctx, "return-visit-thrash", MIN_THRASH_RATE);
    const findings: AuditFinding[] = [];
    const ordered = [...aggregates.values()].sort((a, b) => a.pathRef.localeCompare(b.pathRef));
    for (const agg of ordered) {
      if (agg.pathSessions < MIN_PATH_SESSIONS) continue;
      const thrashRate = agg.thrashSessions / agg.pathSessions;
      if (thrashRate <= minThrashRate) continue;
      findings.push(buildFinding(agg, thrashRate, narrativesBySource.get(agg.pathRef), windowDays, ctx.config.goalType, ctx.config.goalConfig, ctx.pageSnapshotsByPath.get(agg.pathRef)));
    }
    return findings;
  },
};

function ensureAggregate(
  aggregates: Map<string, ThrashAggregate>,
  pathRef: string,
): ThrashAggregate {
  let agg = aggregates.get(pathRef);
  if (!agg) {
    agg = {
      pathRef,
      thrashSessions: 0,
      pathSessions: 0,
      pathCountsAcrossThrash: [],
      deviceTags: [],
      interimPaths: [],
    };
    aggregates.set(pathRef, agg);
  }
  return agg;
}

function isThrashSession(
  session: SessionTrace,
  pathRef: string,
  count: number,
  narrative: NarrativeConfig | undefined,
): boolean {
  const between = pathsBetweenRevisits(session, pathRef);

  if (narrative) {
    if (count < NARRATIVE_THRESHOLD) return false;
    for (const visited of between) {
      if (narrative.expectedPathRefs.includes(visited)) return false;
    }
    return true;
  }

  if (count < STRICT_THRESHOLD) return false;
  for (const visited of between) {
    if (visited !== pathRef) return false;
  }
  return true;
}

/**
 * Distinct paths visited strictly between the first and last occurrence
 * of `pathRef` in `session.paths`. Empty when `pathRef` only appears
 * once in the dedupped path sequence (consecutive self-visits collapse
 * to a single entry).
 */
function pathsBetweenRevisits(session: SessionTrace, pathRef: string): string[] {
  const first = session.paths.indexOf(pathRef);
  if (first === -1) return [];
  const last = session.paths.lastIndexOf(pathRef);
  if (last === first) return [];
  return session.paths.slice(first + 1, last);
}

function buildFinding(
  agg: ThrashAggregate,
  thrashRate: number,
  narrative: NarrativeConfig | undefined,
  windowDays: number,
  goalType: GoalType | undefined,
  goalConfig: GoalConfig | undefined,
  snapshot: PageSnapshot | undefined,
): AuditFinding {
  const median = round(medianOf(agg.pathCountsAcrossThrash), 1);
  const deviceMode = topOf(agg.deviceTags);
  const interimTop = topByCount(agg.interimPaths, (p) => p).slice(0, 3);

  const summary =
    `${formatCount(agg.thrashSessions)} sessions visit ${agg.pathRef} 3+ times without progressing — ` +
    `${pct(thrashRate)}% of sessions that touch this page get caught in a loop. They're searching ` +
    `for something the page doesn't surface clearly.`;

  const docPara =
    `Return-visit loops mean visitors leave the page, fail to find what they expected elsewhere, ` +
    `and come back. Audit on-page navigation: do the most-clicked sub-links resolve to the answers ` +
    `people are looking for? If ${agg.pathRef} is documentation, add a TL;DR + table of contents at ` +
    `the top; if it's a feature/pricing page, surface the comparison they keep returning to look up.`;

  const narrativePara = narrative
    ? `${agg.pathRef} is the source of the narrative ${quote(narrative.label)} with expected ` +
      `destinations ${narrative.expectedPathRefs.map((p) => quote(p)).join(", ")}. Sessions are ` +
      `returning here without visiting any of those — the on-page links toward the narrative aren't ` +
      `surfacing or aren't resolving.`
    : `Consider declaring a Phase 2 narrative for ${agg.pathRef} so the audit can detect more nuanced ` +
      `thrash patterns.`;

  const evidence: AuditFindingEvidence[] = [
    { label: "Page", value: agg.pathRef },
    {
      label: "Thrash sessions",
      value: agg.thrashSessions,
      context: `${formatCount(agg.pathSessions)} sessions touched the page`,
    },
    { label: "Thrash rate", value: `${pct(thrashRate)}%` },
    {
      label: "Median visits / thrash session",
      value: median,
      context: "events on the path per thrashing session",
    },
  ];
  if (deviceMode !== null) {
    evidence.push({ label: "Top device", value: deviceMode });
  }
  evidence.push({
    label: "Narrative declared",
    value: narrative ? narrative.label : "no",
    context: narrative
      ? `expects ${narrative.expectedPathRefs.join(", ")}`
      : "consider adding one",
  });
  if (interimTop.length > 0) {
    evidence.push({
      label: "Top interim paths",
      value: interimTop.map((p) => `${p.key} (${p.count})`).join(", "),
      context: "visited between re-visits, excluding the page itself",
    });
  }

  const impactEstimate = computeImpactEstimate({
    affectedRate: thrashRate,
    windowVolume: agg.pathSessions,
    windowDays,
    goalType,
    goalConfig,
    signalDescription: `sessions looping on ${agg.pathRef} without progressing`,
  });

  const interimClause = interimTop.length > 0
    ? `Visitors leave, visit ${interimTop.slice(0, 2).map((p) => quote(p.key)).join(' and ')}, then come back — those pages aren't answering the question either. Fix the answer on ${agg.pathRef} itself.`
    : `Add a TL;DR or anchor navigation at the top of ${agg.pathRef} so returning visitors can jump to what they're looking for.`;

  const prescription = {
    whatToChange:
      `Add a "Quick answer" section or anchor navigation at the top of ${agg.pathRef} that surfaces the ${narrative ? `${narrative.expectedPathRefs.length} expected destinations` : 'most common follow-up destinations'} visitors expect to find here. ${interimClause}`,
    whyItWorks:
      `${formatCount(agg.thrashSessions)} sessions visit ${agg.pathRef} 3+ times without progressing — ${pct(thrashRate)}% of all sessions touching this page. ` +
      `They keep coming back because they haven't found what they need. Making the answer findable on the first visit eliminates the loop.`,
    experimentVariantDescription:
      `Variant B: top-of-page quick-answer section or anchor navigation added to ${agg.pathRef}. ` +
      `Primary metric: return-visit rate and funnel progression rate from ${agg.pathRef}.`,
  };

  // Anchor for the finding-detail visual: the page's primary CTA. The
  // diagnostic story isn't "this CTA is broken" — it's "this is what
  // visitors see when they keep coming back, and the answer they need
  // isn't here." Same mechanism as `bounce-on-key-page`.
  const primary = snapshot ? pickPrimaryCta(snapshot.data.ctas) : null;

  return {
    id: `return-visit-thrash:${sanitizeIdSegment(agg.pathRef)}`,
    ruleId: "return-visit-thrash",
    category: "thrash",
    severity: thrashRate > STRONG_THRASH_RATE ? "warn" : "info",
    confidence: clamp(0.4 + Math.log10(Math.max(agg.thrashSessions, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(thrashRate * 4, 0, 1),
    pathRef: agg.pathRef,
    title: 'Return-visit thrash',
    summary,
    prescription,
    impactEstimate,
    recommendation: [docPara, narrativePara],
    evidence,
    ...(snapshot
      ? {
          refs: {
            snapshotId: snapshot.id,
            ...(primary ? { ctaRef: primary.ref } : {}),
          },
        }
      : {}),
  };
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function topOf(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { key: string; count: number } | null = null;
  for (const [key, count] of counts) {
    if (best === null || count > best.count || (count === best.count && key.localeCompare(best.key) < 0)) {
      best = { key, count };
    }
  }
  return best === null ? null : best.key;
}

/**
 * Rule: hesitation-pattern
 *
 * Per session, every `page_view` event with `metrics.activeSeconds >= 45`
 * is a long-dwell. The session "hesitates" on that page when the next
 * event in the trace is undefined (session ended) or is a `page_view`
 * of a path the session has already visited (a back-navigation). A
 * `cta_click` directly after the long-dwell never counts.
 *
 * Aggregate per page: emit when ≥ 30 distinct sessions hesitate.
 */

import type { VariantModification } from "@/lib/experiments/types";
import type { CtaCandidate, PageSnapshot } from "@/lib/phase2/snapshots/types";
import type { CanonicalEvent, GoalConfig, GoalType } from "@/lib/phase2/types";

import { ANNOTATION_WARN_COLOR } from "./annotationColors";
import {
  clamp,
  formatCount,
  groupSessions,
  nextEventAfter,
  pct,
  pickPrimaryCta,
  quote,
  sanitizeIdSegment,
  share,
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

const MIN_ACTIVE_SECONDS = 45;
const MIN_HESITATION_SESSIONS = 30;

interface PageBucket {
  hesitationSessions: Set<string>;
  longDwellSessions: Set<string>;
  hesitationActiveSeconds: number[];
}

function readActiveSeconds(event: CanonicalEvent): number | null {
  const value = event.metrics?.activeSeconds;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export const hesitationPattern: AuditRule = {
  id: "hesitation-pattern",
  name: "Hesitation pattern",
  category: "hesitation",

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
    const byPath = new Map<string, PageBucket>();

    for (const session of sessions) {
      const visited = new Set<string>();
      for (const event of session.events) {
        const activeSeconds = readActiveSeconds(event);
        const isLongDwell =
          event.type === "page_view" && activeSeconds !== null && activeSeconds >= MIN_ACTIVE_SECONDS;
        if (!isLongDwell) {
          visited.add(event.path);
          continue;
        }

        let bucket = byPath.get(event.path);
        if (!bucket) {
          bucket = {
            hesitationSessions: new Set<string>(),
            longDwellSessions: new Set<string>(),
            hesitationActiveSeconds: [],
          };
          byPath.set(event.path, bucket);
        }
        bucket.longDwellSessions.add(session.sessionId);
        visited.add(event.path);

        const next = nextEventAfter(session, Date.parse(event.occurredAt));
        const seconds = activeSeconds ?? 0;
        if (next === null) {
          bucket.hesitationSessions.add(session.sessionId);
          bucket.hesitationActiveSeconds.push(seconds);
          continue;
        }
        if (next.type === "cta_click") {
          continue;
        }
        if (next.type === "page_view" && visited.has(next.path)) {
          bucket.hesitationSessions.add(session.sessionId);
          bucket.hesitationActiveSeconds.push(seconds);
        }
      }
    }

    const minHesitationSessions = calibratedFloor(ctx, "hesitation-pattern", MIN_HESITATION_SESSIONS);
    const findings: AuditFinding[] = [];
    for (const [pathRef, bucket] of byPath) {
      const hesitationSessions = bucket.hesitationSessions.size;
      if (hesitationSessions < minHesitationSessions) continue;
      const longDwellSessions = bucket.longDwellSessions.size;
      const hesitationShare = share(hesitationSessions, longDwellSessions) ?? 0;
      const snapshot = ctx.pageSnapshotsByPath.get(pathRef);
      const primary = snapshot ? pickPrimaryCta(snapshot.data.ctas) : null;

      findings.push(
        buildFinding({
          pathRef,
          hesitationSessions,
          longDwellSessions,
          hesitationShare,
          medianActiveSeconds: medianRounded(bucket.hesitationActiveSeconds),
          primary,
          snapshot,
          windowDays: windowDaysFromTimeWindow(ctx.window),
          goalType: ctx.config.goalType,
          goalConfig: ctx.config.goalConfig,
        }),
      );
    }
    return findings;
  },
};

interface FindingInputs {
  pathRef: string;
  hesitationSessions: number;
  longDwellSessions: number;
  hesitationShare: number;
  medianActiveSeconds: number;
  primary: CtaCandidate | null;
  snapshot: PageSnapshot | undefined;
  windowDays: number;
  goalType?: GoalType;
  goalConfig?: GoalConfig;
}

function buildFinding(inputs: FindingInputs): AuditFinding {
  const {
    pathRef,
    hesitationSessions,
    longDwellSessions,
    hesitationShare,
    medianActiveSeconds,
    primary,
    snapshot,
    windowDays,
    goalType,
    goalConfig,
  } = inputs;

  const summary =
    `On ${pathRef}, ${formatCount(hesitationSessions)} sessions held the page in active view for ` +
    `≥45s without acting (no CTA click in the same session) — ${pct(hesitationShare)}% of ` +
    `long-dwell sessions either left or back-navigated. Visitors are reading and not deciding.`;

  const recommendation: string[] = [
    `Long active dwell with no follow-up is value-clarity friction. The page hands the visitor ` +
      `information but not a reason to commit. Audit the primary CTA copy and proof points; the eye ` +
      `is staying on this page longer than usual but the close isn't landing.`,
    `If the page is a pricing or features page, consider an inline comparison or a single anchor ` +
      `question (${quote("What changes when you upgrade?")}) above the fold. Don't expand the ` +
      `page — sharpen the close.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    { label: "Page", value: pathRef },
    { label: "Hesitation sessions", value: hesitationSessions },
    { label: "Long-dwell sessions", value: longDwellSessions, context: "denominator" },
    { label: "Hesitation share", value: `${pct(hesitationShare)}%` },
    {
      label: "Median active seconds",
      value: medianActiveSeconds,
      context: "across hesitation events",
    },
  ];
  if (primary !== null) {
    evidence.push({
      label: "Primary CTA",
      value: primary.text || "(unnamed CTA)",
      context: `visual weight ${primary.visualWeight}, landmark ${primary.landmark}`,
    });
  }

  const impactEstimate = computeImpactEstimate({
    affectedRate: hesitationShare,
    windowVolume: longDwellSessions,
    windowDays,
    goalType,
    goalConfig,
    signalDescription: `long-dwell sessions on ${pathRef} that don't convert`,
  });

  const ctaClause = primary
    ? `Rewrite the copy on ${quote(primary.text)} to answer "what specifically changes when I do this?" — not just label the action.`
    : `Add a single, direct CTA with copy that answers the implied question keeping visitors on this page for ${medianActiveSeconds}s.`;

  const prescription = {
    whatToChange:
      `${ctaClause} Add 1-3 sentences of proof immediately above the CTA: a specific outcome, a number, or a quote. ` +
      `Do not add more content to the page — reduce and sharpen.`,
    whyItWorks:
      `Visitors spend a median ${medianActiveSeconds}s actively on ${pathRef} before leaving without acting. ` +
      `They're reading, not confused — they need a reason to commit, not more information. ` +
      `Proof + specificity on the CTA is the pattern that closes long-dwell hesitation.`,
    experimentVariantDescription:
      `Variant B: primary CTA copy updated with specific outcome language; 1-3 proof points added above fold. ` +
      `Primary metric: CTA click rate from long-dwell sessions on ${pathRef}.`,
  };

  return {
    id: `hesitation-pattern:${sanitizeIdSegment(pathRef)}`,
    ruleId: "hesitation-pattern",
    category: "hesitation",
    severity: hesitationShare > 0.7 ? "warn" : "info",
    confidence: clamp(0.4 + Math.log10(Math.max(hesitationSessions, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(hesitationShare, 0, 1),
    pathRef,
    title: `Hesitation without follow-up on ${pathRef}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
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

function medianRounded(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(median);
}

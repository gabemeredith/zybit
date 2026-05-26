/**
 * Rule: bounce-on-key-page
 *
 * For each session, take its landing path (`session.paths[0]`). The
 * session "bounced" when it visited only that one path, emitted ≤ 3
 * events, and never triggered a `cta_click`. Aggregate per landing
 * path, restrict to "key" pages via `isKeyPath`, and emit when entries
 * ≥ 100 and bounce rate exceeds 50%.
 */

import type { VariantModification } from "@/lib/experiments/types";
import type { CtaCandidate, PageSnapshot } from "@/lib/phase2/snapshots/types";
import type { GoalConfig, GoalType } from "@/lib/phase2/types";

import { ANNOTATION_HEAVY_COLOR } from "./annotationColors";
import {
  annotationCaption,
  outlineMod,
  snapshotHeadingSelector,
} from "./annotationHelpers";
import {
  clamp,
  formatCount,
  groupSessions,
  isKeyPath,
  modeStringProp,
  pct,
  quote,
  readStringProp,
  sanitizeIdSegment,
  share,
  topByCount,
} from "./helpers";
import type { SessionTrace } from "./helpers";
import { calibratedFloor } from "./ruleCalibration";
import { computeImpactEstimate, windowDaysFromTimeWindow } from "./impactEstimate";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
  ProposeModificationsContext,
} from "./types";

const MIN_ENTRIES = 100;
const MIN_BOUNCE_RATE = 0.5;

interface BounceBucket {
  entries: number;
  bounces: number;
  /** session id → resolved device for the landing path. */
  sessionDevices: Map<string, string>;
  /** All `referrer` property values seen in `page_view` events on this path. */
  referrers: string[];
}

function isBounce(session: SessionTrace): boolean {
  if (session.paths.length !== 1) return false;
  if (session.events.length > 3) return false;
  for (const event of session.events) {
    if (event.type === "cta_click") return false;
  }
  return true;
}

export const bounceOnKeyPage: AuditRule = {
  id: "bounce-on-key-page",
  name: "Bounce on key page",
  category: "bounce",

  proposeAnnotations(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[] {
    // The prescription is "rewrite the hero headline to answer the implied
    // question in the top referrer traffic." The element being asked to
    // change is the headline, not the CTA — so outline the first heading
    // in red and label it with the "why."
    const anchor = snapshotHeadingSelector(ctx.snapshot.data);
    if (!anchor) return [];
    return [
      outlineMod(anchor, ANNOTATION_HEAVY_COLOR),
      ...annotationCaption({
        anchorSelector: anchor,
        position: 'after',
        ruleClassName: 'zybit-anno-bounce',
        label: 'Rewrite to answer the question referrer traffic is arriving with',
        color: ANNOTATION_HEAVY_COLOR,
      }),
    ];
  },

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const sessions = groupSessions(ctx.events);
    const byPath = new Map<string, BounceBucket>();

    for (const session of sessions) {
      const landing = session.paths[0];
      if (typeof landing !== "string" || landing.length === 0) continue;

      let bucket = byPath.get(landing);
      if (!bucket) {
        bucket = {
          entries: 0,
          bounces: 0,
          sessionDevices: new Map<string, string>(),
          referrers: [],
        };
        byPath.set(landing, bucket);
      }
      bucket.entries += 1;
      if (isBounce(session)) bucket.bounces += 1;

      const onLanding = session.events.filter((e) => e.path === landing);
      const device = modeStringProp(onLanding, "device_type");
      if (device !== null) bucket.sessionDevices.set(session.sessionId, device);

      for (const event of onLanding) {
        if (event.type !== "page_view") continue;
        const referrer = readStringProp(event.properties, "referrer");
        if (referrer !== null) bucket.referrers.push(referrer);
      }
    }

    const findings: AuditFinding[] = [];
    for (const [pathRef, bucket] of byPath) {
      if (bucket.entries < MIN_ENTRIES) continue;
      const snapshot = ctx.pageSnapshotsByPath.get(pathRef);
      if (!isKeyPath(pathRef, ctx.config, snapshot)) continue;
      const bounceRate = share(bucket.bounces, bucket.entries) ?? 0;
      if (bounceRate <= calibratedFloor(ctx, "bounce-on-key-page", MIN_BOUNCE_RATE)) continue;

      findings.push(
        buildFinding({
          pathRef,
          entries: bucket.entries,
          bounces: bucket.bounces,
          bounceRate,
          referrers: bucket.referrers,
          sessionDevices: bucket.sessionDevices,
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
  entries: number;
  bounces: number;
  bounceRate: number;
  referrers: string[];
  sessionDevices: Map<string, string>;
  snapshot: PageSnapshot | undefined;
  windowDays: number;
  goalType?: GoalType;
  goalConfig?: GoalConfig;
}

function buildFinding(inputs: FindingInputs): AuditFinding {
  const {
    pathRef, entries, bounces, bounceRate, referrers, sessionDevices, snapshot,
    windowDays, goalType, goalConfig,
  } = inputs;
  const primary = snapshot ? pickPrimaryCta(snapshot.data.ctas) : null;
  const topReferrers = topByCount(referrers, (r) => r).slice(0, 3);
  const deviceCounts = countDevices(sessionDevices);

  const primaryClause = primary
    ? ` The most prominent CTA is ${quote(primary.text)} (visual weight ${primary.visualWeight}).`
    : "";

  const summary =
    `${formatCount(entries)} sessions land on ${pathRef} and ${pct(bounceRate)}% leave without ` +
    `clicking anything — a key page that costs visitors more than it gives.${primaryClause}`;

  const recommendation: string[] = [
    `This is the page where the funnel begins; if half of arrivals leave without engaging, the ` +
      `first impression is mis-priced. Audit hero copy, CTA prominence, and load performance — ` +
      `visitors should see something they want within 1.5 seconds.`,
    `Cross-check this page's referrer mix: bounces concentrated on one campaign or one device ` +
      `suggest a promise/destination mismatch you can fix at the source rather than the page.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    { label: "Landing path", value: pathRef },
    { label: "Entries", value: entries },
    { label: "Bounces", value: bounces },
    { label: "Bounce rate", value: `${pct(bounceRate)}%` },
  ];
  for (let i = 0; i < topReferrers.length; i += 1) {
    const referrer = topReferrers[i];
    evidence.push({
      label: `Top referrer #${i + 1}`,
      value: referrer.key,
      context: `${formatCount(referrer.count)} pageviews`,
    });
  }
  if (primary !== null) {
    evidence.push({
      label: "Primary CTA",
      value: primary.text || "(unnamed CTA)",
      context: `visual weight ${primary.visualWeight}, landmark ${primary.landmark}`,
    });
  }
  if (deviceCounts.mobile + deviceCounts.desktop > 0) {
    evidence.push({
      label: "Mobile entries",
      value: deviceCounts.mobile,
      context:
        `${formatCount(deviceCounts.desktop)} desktop` +
        (deviceCounts.other > 0 ? `, ${formatCount(deviceCounts.other)} other` : ""),
    });
  }

  const refs: AuditFinding["refs"] | undefined = snapshot
    ? {
        snapshotId: snapshot.id,
        ...(primary ? { ctaRef: primary.ref } : {}),
      }
    : undefined;

  const impactEstimate = computeImpactEstimate({
    affectedRate: bounceRate,
    windowVolume: entries,
    windowDays,
    goalType,
    goalConfig,
    signalDescription: `sessions landing on ${pathRef}`,
  });

  const ctaClause = primary
    ? `Raise the prominence of ${quote(primary.text)} (your highest-weight CTA) to hero position — it should be the first thing visitors read, not something they find after scrolling.`
    : `Place a single, prominent CTA above the fold that matches the promise in the referrer or ad copy that sent visitors here.`;

  const prescription = {
    whatToChange:
      `${ctaClause} Rewrite the hero headline to answer the implied question in the top referrer traffic, not just describe the product.`,
    whyItWorks:
      `${pct(bounceRate)}% of visitors land on ${pathRef} and leave without a single click. ` +
      `The page is receiving traffic but not giving visitors a reason to engage. ` +
      `The fix is a match between arrival intent and first-visible content — not more content.`,
    experimentVariantDescription:
      `Variant B: hero headline and primary CTA rewritten to reflect top referrer intent. ` +
      `Primary metric: bounce rate and first CTA click rate on ${pathRef}.`,
  };

  return {
    id: `bounce-on-key-page:${sanitizeIdSegment(pathRef)}`,
    ruleId: "bounce-on-key-page",
    category: "bounce",
    severity: bounceRate > 0.7 ? "critical" : "warn",
    confidence: clamp(0.5 + Math.log10(Math.max(entries, 1)) * 0.15, 0, 0.95),
    priorityScore: clamp(bounceRate, 0, 1),
    pathRef,
    title: 'High bounce on key page',
    summary,
    recommendation,
    prescription,
    impactEstimate,
    evidence,
    ...(refs !== undefined ? { refs } : {}),
  };
}

function pickPrimaryCta(ctas: readonly CtaCandidate[]): CtaCandidate | null {
  let best: CtaCandidate | null = null;
  for (const cta of ctas) {
    if (cta.disabled) continue;
    if (
      best === null ||
      cta.visualWeight > best.visualWeight ||
      (cta.visualWeight === best.visualWeight && cta.documentIndex < best.documentIndex)
    ) {
      best = cta;
    }
  }
  return best;
}

function countDevices(sessionDevices: Map<string, string>): {
  mobile: number;
  desktop: number;
  other: number;
} {
  const counts = { mobile: 0, desktop: 0, other: 0 };
  for (const device of sessionDevices.values()) {
    if (device === "mobile") counts.mobile += 1;
    else if (device === "desktop") counts.desktop += 1;
    else counts.other += 1;
  }
  return counts;
}

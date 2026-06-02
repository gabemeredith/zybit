/**
 * Rule: rage-click-target
 *
 * Cluster `rage_click` events by their target identity (preferring a
 * stable ref, falling back to text, and finally to tag + classes). When
 * a single element absorbs ≥ 5 rage clicks AND ≥ 5% of the sessions on
 * its page rage-click it, the affordance is misleading — emit a finding.
 */

import type { VariantModification } from "@/lib/experiments/types";
import type { CanonicalEvent } from "@/lib/phase2/types";

import { ANNOTATION_HEAVY_COLOR } from "./annotationColors";
import { annotationCaption, outlineMod } from "./annotationHelpers";
import {
  clamp,
  formatCount,
  matchCtaToEvent,
  modeStringProp,
  pct,
  quote,
  readStringProp,
  sanitizeIdSegment,
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

const MIN_RAGE_CLICKS = 5;
const MIN_RAGE_RATE = 0.05;

interface RageGroup {
  /** Stable key used for grouping; first non-empty of ref / text / tag-classes. */
  key: string;
  pathRef: string;
  events: CanonicalEvent[];
  /** Best human label for the group (text first, then a synthetic tag.classes). */
  label: string;
  /** Original `rage_target_ref` if present, for `refs.ctaRef`. */
  rageTargetRef: string | null;
}

export const rageClickTarget: AuditRule = {
  id: "rage-click-target",
  name: "Rage-click target cluster",
  category: "rage",
  // Behavioral rule: needs real rage-click sessions; synthetic generator
  // no longer fabricates them. Skipped on public audits.
  publicAuditBehavior: 'empty',

  proposeAnnotations(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[] {
    // The rage target *is* the broken element — keep the red outline. Add a
    // small caption so the PM immediately sees why it's flagged (visitors
    // expected it to respond and it didn't), instead of having to read the
    // finding body.
    const ref = finding.refs?.ctaRef;
    if (!ref) return [];
    const cta = ctx.snapshot.data.ctas.find((c) => c.ref === ref);
    if (!cta?.cssSelector) return [];
    return [
      outlineMod(cta.cssSelector, ANNOTATION_HEAVY_COLOR),
      ...annotationCaption({
        anchorSelector: cta.cssSelector,
        position: 'after',
        ruleClassName: 'zybit-anno-rage',
        label: 'Visitors rage-click here — they expect it to respond and it doesn\'t',
        color: ANNOTATION_HEAVY_COLOR,
      }),
    ];
  },

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const sessionsByPath = countSessionsByPath(ctx.events);

    const groups = new Map<string, RageGroup>();
    for (const event of ctx.events) {
      if (event.type !== "rage_click") continue;

      const ref = readStringProp(event.properties, "rage_target_ref");
      const text = readStringProp(event.properties, "rage_target_text");
      const tag = readStringProp(event.properties, "element_tag");
      const classes = readStringProp(event.properties, "element_classes");

      let key: string;
      let label: string;
      if (ref !== null) {
        key = `ref:${ref}`;
        label = text !== null && text.length > 0 ? text : ref;
      } else if (text !== null) {
        key = `text:${text.trim().toLowerCase()}`;
        label = text;
      } else if (tag !== null && classes !== null) {
        key = `tagcls:${tag}.${classes.trim().toLowerCase()}`;
        label = `${tag}.${classes.trim()}`;
      } else {
        continue;
      }

      const fullKey = `${event.path}::${key}`;
      let group = groups.get(fullKey);
      if (!group) {
        group = {
          key: fullKey,
          pathRef: event.path,
          events: [],
          label,
          rageTargetRef: ref,
        };
        groups.set(fullKey, group);
      }
      group.events.push(event);
    }

    const findings: AuditFinding[] = [];
    const orderedGroupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
    for (const key of orderedGroupKeys) {
      const group = groups.get(key);
      if (!group) continue;
      const finding = evaluateGroup(group, sessionsByPath, ctx, windowDaysFromTimeWindow(ctx.window));
      if (finding !== null) {
        findings.push(finding);
      }
    }
    return findings;
  },
};

function evaluateGroup(
  group: RageGroup,
  sessionsByPath: Map<string, number>,
  ctx: AuditRuleContext,
  windowDays: number,
): AuditFinding | null {
  const rageCount = group.events.length;
  if (rageCount < MIN_RAGE_CLICKS) return null;

  const totalSessionsOnPage = sessionsByPath.get(group.pathRef) ?? 0;
  if (totalSessionsOnPage <= 0) return null;
  const rageSessions = new Set<string>();
  for (const event of group.events) {
    rageSessions.add(event.sessionId);
  }
  const rageRate = rageSessions.size / totalSessionsOnPage;
  if (rageRate <= calibratedFloor(ctx, "rage-click-target", MIN_RAGE_RATE)) return null;

  // Try to upgrade the label by matching a snapshot CTA — gives the
  // finding the page's actual button text instead of the property value.
  const snapshot = ctx.pageSnapshotsByPath.get(group.pathRef);
  let displayText = group.label;
  let matchedRef: string | null = null;
  if (snapshot) {
    for (const event of group.events) {
      const matched = matchCtaToEvent(snapshot, event);
      if (matched) {
        displayText = matched.text || group.label;
        matchedRef = matched.ref;
        break;
      }
    }
  }

  const tag = modeStringProp(group.events, "element_tag");
  const classes = modeStringProp(group.events, "element_classes");
  const classCtx =
    tag !== null || classes !== null
      ? ` (${[tag, classes].filter((v): v is string => typeof v === "string" && v.length > 0).join(" ")})`
      : "";

  const roleHint = modeStringProp(group.events, "element_role");

  const summary =
    `${formatCount(rageCount)} rage clicks targeting ${quote(displayText)}${classCtx} — that's ` +
    `${pct(rageRate)}% of sessions on ${group.pathRef}. The element looks like an affordance but ` +
    `probably doesn't behave like one.`;

  const recommendation: string[] = [
    `Inspect ${quote(displayText)}: if it is meant to be clickable, make sure it has a visible hover ` +
      `state and a working handler. If it's meant to be plain text, demote its visual treatment so ` +
      `it stops reading as a control.`,
  ];
  if (roleHint !== null && roleHint.length > 0) {
    recommendation.push(
      `Surrounding ${roleHint} suggests this lives in the ${roleHint} of the page; rage-clicks here ` +
        `usually mean visitors are trying to navigate but the element doesn't respond.`,
    );
  }

  const evidence: AuditFindingEvidence[] = [
    {
      label: "Rage target",
      value: displayText,
      context: classCtx.length > 0 ? classCtx.trim().slice(1, -1) : undefined,
    },
    {
      label: "Rage clicks",
      value: rageCount,
      context: `${formatCount(rageSessions.size)} unique sessions`,
    },
    {
      label: "Rage rate",
      value: `${pct(rageRate)}%`,
      context: `${formatCount(rageSessions.size)} of ${formatCount(totalSessionsOnPage)} page sessions`,
    },
    { label: "Page", value: group.pathRef },
  ];
  if (roleHint !== null) {
    evidence.push({ label: "Element role", value: roleHint });
  }

  const idSlug =
    matchedRef ?? group.rageTargetRef ?? (sanitizeIdSegment(displayText) || "_");
  // Only persist ctaRef when it resolved against snapshot.data.ctas — the
  // event-side `rage_target_ref` lives in a different namespace and would
  // mislead downstream consumers (e.g. the AI Advisor) that treat ctaRef
  // as a snapshot-CTA reference.
  const refsCtaRef = matchedRef ?? undefined;

  const impactEstimate = computeImpactEstimate({
    affectedRate: rageRate,
    windowVolume: totalSessionsOnPage,
    windowDays,
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `sessions on ${group.pathRef} that rage-click ${quote(displayText)}`,
  });

  const prescription = {
    whatToChange:
      `If ${quote(displayText)} is meant to be clickable: add a visible hover/focus state and verify its click handler fires. ` +
      `If it's decorative text or an icon: remove pointer cursor and change its visual treatment so it no longer reads as a button.`,
    whyItWorks:
      `${pct(rageRate)}% of sessions on ${group.pathRef} rage-click this element — visitors expect it to respond and it doesn't. ` +
      `Fixing affordance mismatches like this removes a frustration signal that erodes trust on conversion-critical pages.`,
    experimentVariantDescription:
      `Variant B: ${quote(displayText)} given correct interactive treatment (working handler + hover state) or visually demoted to plain text. ` +
      `Primary metric: rage_click rate on ${group.pathRef}.`,
  };

  return {
    id: `rage-click-target:${group.pathRef}:${sanitizeIdSegment(idSlug)}`,
    ruleId: "rage-click-target",
    category: "rage",
    severity: rageRate > 0.15 ? "critical" : "warn",
    confidence: clamp(0.4 + Math.log10(Math.max(rageCount, 1)) * 0.25, 0, 0.95),
    priorityScore: clamp(rageRate * 4, 0, 1),
    pathRef: group.pathRef,
    title: `Rage clicks cluster on ${quote(displayText)}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
    evidence,
    refs: {
      ...(refsCtaRef !== undefined ? { ctaRef: refsCtaRef } : {}),
      ...(snapshot ? { snapshotId: snapshot.id } : {}),
    },
  };
}

function countSessionsByPath(events: readonly CanonicalEvent[]): Map<string, number> {
  const sessionsByPath = new Map<string, Set<string>>();
  for (const event of events) {
    let bucket = sessionsByPath.get(event.path);
    if (!bucket) {
      bucket = new Set<string>();
      sessionsByPath.set(event.path, bucket);
    }
    bucket.add(event.sessionId);
  }
  const counts = new Map<string, number>();
  for (const [path, set] of sessionsByPath) {
    counts.set(path, set.size);
  }
  return counts;
}

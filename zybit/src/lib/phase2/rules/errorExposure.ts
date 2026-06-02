/**
 * Rule: error-exposure
 *
 * Cluster `error` events by (path, error_type, error_message). When a
 * single failure mode happens 5+ times in window, emit a finding that
 * names the actual exception, the file where it lives, and what share
 * of sessions reaching the page actually see it. Capped at 10 groups
 * so a broken site doesn't drown the report.
 */

import type { CanonicalEvent } from "@/lib/phase2/types";

import {
  clamp,
  formatCount,
  isKeyPath,
  modeStringProp,
  pct,
  quote,
  readStringProp,
  sanitizeIdSegment,
  share,
  topByCount,
} from "./helpers";
import { calibratedFloor } from "./ruleCalibration";
import { computeImpactEstimate, windowDaysFromTimeWindow } from "./impactEstimate";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
} from "./types";

const MIN_ERROR_COUNT = 5;
const MAX_GROUPS = 10;
const MESSAGE_KEY_LIMIT = 200;
const MESSAGE_DISPLAY_LIMIT = 120;
const ID_MESSAGE_LIMIT = 60;

interface ErrorGroup {
  pathRef: string;
  errorType: string;
  /** First 200 chars of error_message — used as the grouping key. */
  messageKey: string;
  events: CanonicalEvent[];
}

export const errorExposure: AuditRule = {
  id: "error-exposure",
  name: "Error exposure cluster",
  category: "error",
  // Behavioral rule: consumes JS error events from the analytics connector.
  publicAuditBehavior: 'empty',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const sessionsByPath = new Map<string, Set<string>>();
    for (const event of ctx.events) {
      let bucket = sessionsByPath.get(event.path);
      if (!bucket) {
        bucket = new Set<string>();
        sessionsByPath.set(event.path, bucket);
      }
      bucket.add(event.sessionId);
    }

    const groups = new Map<string, ErrorGroup>();
    for (const event of ctx.events) {
      if (event.type !== "error") continue;
      const errorType = readStringProp(event.properties, "error_type") ?? "(unknown)";
      const errorMessageRaw = readStringProp(event.properties, "error_message") ?? "(no message)";
      const messageKey = errorMessageRaw.slice(0, MESSAGE_KEY_LIMIT);
      const fullKey = `${event.path}::${errorType}::${messageKey}`;
      let group = groups.get(fullKey);
      if (!group) {
        group = { pathRef: event.path, errorType, messageKey, events: [] };
        groups.set(fullKey, group);
      }
      group.events.push(event);
    }

    const minErrorCount = calibratedFloor(ctx, "error-exposure", MIN_ERROR_COUNT);
    const eligible = [...groups.values()]
      .filter((g) => g.events.length >= minErrorCount)
      .sort((a, b) => {
        if (b.events.length !== a.events.length) return b.events.length - a.events.length;
        const pathCmp = a.pathRef.localeCompare(b.pathRef);
        if (pathCmp !== 0) return pathCmp;
        const typeCmp = a.errorType.localeCompare(b.errorType);
        if (typeCmp !== 0) return typeCmp;
        return a.messageKey.localeCompare(b.messageKey);
      })
      .slice(0, MAX_GROUPS);

    const windowDays = windowDaysFromTimeWindow(ctx.window);
    return eligible.map((group) => buildFinding(group, sessionsByPath, ctx, windowDays));
  },
};

function buildFinding(
  group: ErrorGroup,
  sessionsByPath: Map<string, Set<string>>,
  ctx: AuditRuleContext,
  windowDays: number,
): AuditFinding {
  const errorCount = group.events.length;
  const distinctSessions = new Set(group.events.map((e) => e.sessionId)).size;
  const pageSessionsTotal = sessionsByPath.get(group.pathRef)?.size ?? 0;
  const impactedShare = share(distinctSessions, pageSessionsTotal);

  const sample = group.events[0].properties ?? {};
  const messageRaw = readStringProp(sample, "error_message") ?? "(no message)";
  const messageShort = shortenMessage(messageRaw);

  const errorSource = modeStringProp(group.events, "error_source");
  const errorLine = readNumericProp(sample, "error_line");
  const errorColumn = readNumericProp(sample, "error_column");
  const handled = readBooleanProp(sample, "error_handled");
  const isHandled = handled === true;
  const handledLabel = isHandled ? "(handled)" : "(unhandled)";

  const snapshot = ctx.pageSnapshotsByPath.get(group.pathRef);
  const keyPath = isKeyPath(group.pathRef, ctx.config, snapshot);

  const summary =
    `${formatCount(errorCount)} exceptions on ${group.pathRef}: ` +
    `${quote(group.errorType)} "${messageShort}" ${handledLabel}. ` +
    `Affects ${formatCount(distinctSessions)} sessions in the window.` +
    (impactedShare !== null ? ` ${pct(impactedShare)}% of sessions on this page see it.` : "");

  const sourceFragment = errorSource !== null ? ` (raised in ${errorSource})` : "";
  const consequence = isHandled
    ? "Even though the error is caught, the user-facing path likely degrades — error boundaries trigger fallbacks, retry loops kick in, or features silently disappear."
    : "Unhandled exceptions stop scripts mid-execution and usually leave the user staring at a half-rendered page or a button that no longer responds.";
  const para1 =
    `Visitors on ${group.pathRef} hit ${quote(group.errorType)} "${messageShort}"${sourceFragment}. ${consequence}`;

  const sharePhrase = impactedShare !== null
    ? `${pct(impactedShare)}% of sessions reaching ${group.pathRef}`
    : `${formatCount(distinctSessions)} sessions reaching ${group.pathRef}`;
  const keyPathSentence = keyPath
    ? `${group.pathRef} matches the configured funnel (onboarding/narrative/CTA), so bumping this fix above feature work is correct.`
    : `If ${group.pathRef} is a conversion page (signup, checkout), bumping fixes here above feature work is correct.`;
  const para2 = `This error fires on ${sharePhrase}. ${keyPathSentence}`;

  const evidence: AuditFindingEvidence[] = [
    { label: "Error type", value: group.errorType },
    { label: "Message", value: messageShort },
    { label: "Page", value: group.pathRef },
    {
      label: "Error count",
      value: errorCount,
      context: `${formatCount(distinctSessions)} unique sessions`,
    },
  ];
  if (errorSource !== null) {
    evidence.push({ label: "Source", value: errorSource });
  }
  if (errorLine !== null) {
    evidence.push({
      label: "Line",
      value: errorLine,
      context: errorColumn !== null ? `column ${errorColumn}` : undefined,
    });
  } else if (errorColumn !== null) {
    evidence.push({ label: "Column", value: errorColumn });
  }
  if (impactedShare !== null) {
    evidence.push({
      label: "Impacted share",
      value: `${pct(impactedShare)}%`,
      context: `${formatCount(distinctSessions)} of ${formatCount(pageSessionsTotal)} page sessions`,
    });
  }
  if (handled !== null) {
    evidence.push({ label: "Handled", value: handled ? "yes" : "no" });
  }
  evidence.push({
    label: "Key path",
    value: keyPath ? "yes" : "no",
    context: keyPath ? "matches onboarding/narrative/CTA config" : "no funnel match",
  });
  const topDevices = topByCount(group.events, (e) => readStringProp(e.properties, "device_type") ?? "")
    .filter((b) => b.key.length > 0)
    .slice(0, 3);
  if (topDevices.length > 0) {
    evidence.push({
      label: "Top device types",
      value: topDevices.map((b) => `${b.key} (${b.count})`).join(", "),
    });
  }
  const topReferrers = topByCount(group.events, (e) => readStringProp(e.properties, "referrer") ?? "")
    .filter((b) => b.key.length > 0)
    .slice(0, 3);
  if (topReferrers.length > 0) {
    evidence.push({
      label: "Top referrers",
      value: topReferrers.map((b) => `${b.key} (${b.count})`).join(", "),
    });
  }

  const idSlug =
    `${sanitizeIdSegment(group.pathRef)}:${sanitizeIdSegment(group.errorType)}:` +
    sanitizeIdSegment(group.messageKey).slice(0, ID_MESSAGE_LIMIT);

  const impactEstimate = computeImpactEstimate({
    affectedRate: impactedShare ?? Math.min(distinctSessions / Math.max(pageSessionsTotal, 1), 1),
    windowVolume: pageSessionsTotal || distinctSessions,
    windowDays,
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `sessions exposed to ${quote(group.errorType)} on ${group.pathRef}`,
  });

  const sourceClause = errorSource !== null ? ` in ${errorSource}` : "";
  const prescription = {
    whatToChange:
      `Fix ${quote(group.errorType)}${sourceClause}: ${shortenMessage(messageRaw)}. ` +
      (isHandled
        ? `The error is currently caught — remove the silent fallback and replace it with a user-visible recovery path or a proper fix.`
        : `The error is unhandled — add a try/catch and either fix the root cause or show a clear error state with a retry action.`),
    whyItWorks:
      `${formatCount(distinctSessions)} sessions hit this exception in the window. ` +
      `${isHandled ? 'Even handled errors degrade the experience' : 'Unhandled exceptions stop script execution mid-page'} — ` +
      `users on ${group.pathRef} are encountering broken state${keyPath ? ' on a key funnel page' : ''}.`,
    experimentVariantDescription:
      `Fix deployed: ${quote(group.errorType)} resolved${sourceClause}. ` +
      `Primary metric: error rate and conversion rate on ${group.pathRef}.`,
  };

  return {
    id: `error-exposure:${idSlug}`,
    ruleId: "error-exposure",
    category: "error",
    severity: !isHandled || keyPath ? "critical" : "warn",
    confidence: clamp(0.5 + Math.log10(Math.max(errorCount, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(
      impactedShare !== null && impactedShare > 0
        ? impactedShare
        : Math.min(errorCount / 100, 1),
      0,
      1,
    ),
    pathRef: group.pathRef,
    title: `${formatCount(errorCount)} ${quote(group.errorType)} exceptions on ${group.pathRef}`,
    summary,
    prescription,
    impactEstimate,
    recommendation: [para1, para2],
    evidence,
  };
}

function shortenMessage(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MESSAGE_DISPLAY_LIMIT) return collapsed;
  return `${collapsed.slice(0, MESSAGE_DISPLAY_LIMIT)}…`;
}

function readNumericProp(
  props: NonNullable<CanonicalEvent["properties"]>,
  key: string,
): number | null {
  const v = props[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readBooleanProp(
  props: NonNullable<CanonicalEvent["properties"]>,
  key: string,
): boolean | null {
  const v = props[key];
  return typeof v === "boolean" ? v : null;
}

/**
 * Rule: help-seeking-spike
 *
 * Per non-help page with ≥ 50 CTA clicks: compare the local rate of
 * "help" CTA clicks (matched by label) to the site-wide baseline over
 * the same population of non-help pages. When the local rate is at
 * least 2× baseline AND ≥ 5% absolute, the page is sending visitors
 * looking for help instead of letting them act — emit a finding.
 */

import type { CanonicalEvent, GoalConfig, GoalType } from "@/lib/phase2/types";

import {
  clamp,
  formatCount,
  pct,
  quote,
  readStringProp,
  round,
  sanitizeIdSegment,
  share,
  siteBaselineRate,
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

const HELP_TEXT_REGEX = /(\bhelp\b|\bsupport\b|\bcontact\b|\bfaq\b|chat|talk to (sales|us))/i;
const HELP_PATH_REGEX = /help|support|faq|contact|docs/i;
const MIN_PAGE_CTA_CLICKS = 50;
const MIN_SITE_CTA_CLICKS = 200;
const MIN_LOCAL_RATE = 0.05;
const MULTIPLIER = 2;

function isCtaClick(event: CanonicalEvent): boolean {
  return event.type === "cta_click";
}

function isHelpPath(path: string): boolean {
  return HELP_PATH_REGEX.test(path);
}

function isHelpClick(event: CanonicalEvent): boolean {
  if (!isCtaClick(event)) return false;
  const text = readStringProp(event.properties, "cta_text");
  if (text === null) return false;
  return HELP_TEXT_REGEX.test(text);
}

export const helpSeekingSpike: AuditRule = {
  id: "help-seeking-spike",
  name: "Help-seeking spike",
  category: "help",

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const baselineRate = siteBaselineRate(
      ctx.events,
      (e) => isHelpClick(e),
      (e) => isCtaClick(e) && !isHelpPath(e.path),
    );
    if (baselineRate <= 0) return [];

    let siteCtaClicks = 0;
    let siteHelpClicks = 0;
    const ctaByPath = new Map<string, CanonicalEvent[]>();
    const helpByPath = new Map<string, CanonicalEvent[]>();
    for (const event of ctx.events) {
      if (!isCtaClick(event)) continue;
      if (isHelpPath(event.path)) continue;
      siteCtaClicks += 1;
      let bucket = ctaByPath.get(event.path);
      if (!bucket) {
        bucket = [];
        ctaByPath.set(event.path, bucket);
      }
      bucket.push(event);
      if (isHelpClick(event)) {
        siteHelpClicks += 1;
        let helpBucket = helpByPath.get(event.path);
        if (!helpBucket) {
          helpBucket = [];
          helpByPath.set(event.path, helpBucket);
        }
        helpBucket.push(event);
      }
    }
    if (siteCtaClicks < MIN_SITE_CTA_CLICKS) return [];

    const minLocalRate = calibratedFloor(ctx, "help-seeking-spike", MIN_LOCAL_RATE);
    const findings: AuditFinding[] = [];
    for (const [pathRef, ctaEvents] of ctaByPath) {
      const pageCtaClicks = ctaEvents.length;
      if (pageCtaClicks < MIN_PAGE_CTA_CLICKS) continue;
      const helpEvents = helpByPath.get(pathRef) ?? [];
      const pageHelpClicks = helpEvents.length;
      const localRate = share(pageHelpClicks, pageCtaClicks) ?? 0;
      if (localRate < minLocalRate) continue;
      if (localRate < baselineRate * MULTIPLIER) continue;

      findings.push(
        buildFinding({
          pathRef,
          pageCtaClicks,
          pageHelpClicks,
          localRate,
          siteCtaClicks,
          siteHelpClicks,
          baselineRate,
          multiple: localRate / baselineRate,
          helpEvents,
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
  pageCtaClicks: number;
  pageHelpClicks: number;
  localRate: number;
  siteCtaClicks: number;
  siteHelpClicks: number;
  baselineRate: number;
  multiple: number;
  helpEvents: CanonicalEvent[];
  windowDays: number;
  goalType?: GoalType;
  goalConfig?: GoalConfig;
}

function buildFinding(inputs: FindingInputs): AuditFinding {
  const {
    pathRef,
    pageCtaClicks,
    pageHelpClicks,
    localRate,
    siteCtaClicks,
    siteHelpClicks,
    baselineRate,
    multiple,
    helpEvents,
    windowDays,
    goalType,
    goalConfig,
  } = inputs;

  const topGroups = topByCount(helpEvents, (e) => readStringProp(e.properties, "cta_text") ?? "")
    .filter((g) => g.key.length > 0)
    .slice(0, 3);
  const topQuoted = topGroups.map((g) => quote(g.key));
  const topClause =
    topQuoted.length >= 2
      ? topQuoted.slice(0, 2).join(", ")
      : topQuoted.length === 1
        ? topQuoted[0]
        : "the help-CTA labels visitors clicked";

  const summary =
    `On ${pathRef}, ${pct(localRate)}% of CTA clicks are help-seeking — ` +
    `${round(multiple, 1)}× the site baseline of ${pct(baselineRate)}%. ` +
    `Visitors are on this page but reaching for help instead of acting.`;

  const recommendation: string[] = [
    `Help-seeking spikes here suggest the page promises a decision but doesn't supply the answer. ` +
      `Inline the most-asked support questions as a FAQ accordion below the fold; quote the actual ` +
      `help-CTA labels visitors clicked: ${topClause}.`,
    `If the page is meant to convert (pricing, signup), audit the value claim and the proof. ` +
      `Visitors clicking help mid-funnel are confidence-shopping; address the doubt where it ` +
      `appears, not in a separate page.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    { label: "Page", value: pathRef },
    { label: "Page help clicks", value: pageHelpClicks },
    { label: "Page CTA clicks", value: pageCtaClicks },
    { label: "Local rate", value: `${pct(localRate)}%` },
    { label: "Site help clicks", value: siteHelpClicks, context: "across non-help pages" },
    { label: "Site CTA clicks", value: siteCtaClicks, context: "across non-help pages" },
    { label: "Site baseline rate", value: `${pct(baselineRate)}%` },
    { label: "Multiple", value: `${round(multiple, 1)}×`, context: "local / baseline" },
  ];
  for (let i = 0; i < topGroups.length; i += 1) {
    const group = topGroups[i];
    evidence.push({
      label: `Top help-CTA #${i + 1}`,
      value: group.key,
      context: `${formatCount(group.count)} clicks`,
    });
  }

  const impactEstimate = computeImpactEstimate({
    affectedRate: localRate,
    windowVolume: pageCtaClicks,
    windowDays,
    goalType,
    goalConfig,
    signalDescription: `CTA clicks on ${pathRef} deflected to help instead of conversion`,
  });

  const faqTopics = topGroups.slice(0, 2).map((g) => quote(g.key)).join(' and ');
  const prescription = {
    whatToChange:
      `Add a 2-3 question FAQ accordion to ${pathRef} that directly addresses the doubts visitors are shopping for. ` +
      `Base the questions on the actual help-CTA labels clicked: ${faqTopics || 'the help labels in the evidence below'}. ` +
      `Place the FAQ immediately above the primary CTA, not at the bottom of the page.`,
    whyItWorks:
      `${pct(localRate)}% of CTA clicks on this page go to help — ${round(multiple, 1)}× the site baseline. ` +
      `Visitors want to convert but have an unanswered question. Inlining the answer removes the deflection without losing them to a support page.`,
    experimentVariantDescription:
      `Variant B: 2-3 question FAQ accordion added above the primary CTA on ${pathRef}, addressing the top help-seeking labels. ` +
      `Primary metric: help-CTA click rate and primary CTA conversion rate on ${pathRef}.`,
  };

  return {
    id: `help-seeking-spike:${sanitizeIdSegment(pathRef)}`,
    ruleId: "help-seeking-spike",
    category: "help",
    severity: multiple > 4 ? "critical" : "warn",
    confidence: clamp(0.4 + Math.log10(Math.max(pageCtaClicks, 1)) * 0.15, 0, 0.95),
    priorityScore: clamp(localRate, 0, 1),
    pathRef,
    title: `Help-seeking spike on ${pathRef}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
    evidence,
  };
}

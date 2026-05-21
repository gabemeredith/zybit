/**
 * Rule: hero-hierarchy-inversion
 *
 * Per page that has a snapshot (or PageCapture) AND ≥ 30 `cta_click` events
 * in window: find the most-clicked CTA and the visually heaviest CTA. If they
 * differ, the page's visual weight is pulling the eye away from where the
 * value actually lands — emit one finding.
 *
 * Dual-path: when a PageCapture is available, CTAs with a null or zero bbox
 * (hidden/off-screen elements) are excluded from the "visually heaviest"
 * calculation, reducing false positives from CSS-hidden CTAs.
 */

import type { CtaCandidate, PageSnapshot } from "@/lib/phase2/snapshots/types";
import type { CtaCandidateMeasured, PageCapture } from "@/lib/phase2/capture/types";
import type { CanonicalEvent } from "@/lib/phase2/types";

import {
  clamp,
  formatCount,
  matchCtaToEvent,
  normalizeText,
  pct,
  quote,
  share,
  topByCount,
} from "./helpers";
import { computeImpactEstimate, windowDaysFromTimeWindow } from "./impactEstimate";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
} from "./types";

const MIN_CTA_CLICKS = 30;

interface ClickedRef {
  cta: CtaCandidate | null;
  fallbackText: string | null;
}

export const heroHierarchyInversion: AuditRule = {
  id: "hero-hierarchy-inversion",
  name: "Hero hierarchy inversion",
  category: "hierarchy",

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const clicksByPath = new Map<string, CanonicalEvent[]>();
    for (const event of ctx.events) {
      if (event.type !== "cta_click") continue;
      let bucket = clicksByPath.get(event.path);
      if (!bucket) {
        bucket = [];
        clicksByPath.set(event.path, bucket);
      }
      bucket.push(event);
    }

    for (const [pathRef, clicks] of clicksByPath) {
      if (clicks.length < MIN_CTA_CLICKS) continue;

      // Prefer PageCapture: excludes hidden/off-screen CTAs from "heaviest" calc
      if (ctx.pageCapturesByPath) {
        const captures = ctx.pageCapturesByPath.get(pathRef);
        if (captures && captures.length > 0) {
          const desktop = captures.find(c => c.breakpoint === 'desktop') ?? captures[0];
          const finding = evaluatePageWithCapture(pathRef, desktop, clicks, ctx);
          if (finding !== null) findings.push(finding);
          continue;
        }
      }

      const snapshot = ctx.pageSnapshotsByPath.get(pathRef);
      if (!snapshot) continue;

      const finding = evaluatePage(pathRef, snapshot, clicks, ctx);
      if (finding !== null) findings.push(finding);
    }

    return findings;
  },
};

function evaluatePage(
  pathRef: string,
  snapshot: PageSnapshot,
  clicks: CanonicalEvent[],
  ctx: AuditRuleContext,
): AuditFinding | null {
  const totalClicks = clicks.length;

  // Bucket clicks by matched CTA ref. Unmatched clicks fall back to
  // their normalized text label so we can still surface the user's
  // observed preference even when the snapshot doesn't carry the CTA.
  const keyedClicks = clicks.map<{ event: CanonicalEvent; key: string; ref: ClickedRef }>(
    (event) => {
      const matched = matchCtaToEvent(snapshot, event);
      if (matched) {
        return {
          event,
          key: `ref:${matched.ref}`,
          ref: { cta: matched, fallbackText: matched.text },
        };
      }
      const text =
        typeof event.properties?.["cta_text"] === "string"
          ? (event.properties["cta_text"] as string)
          : null;
      const norm = text !== null ? normalizeText(text) : "";
      if (norm.length === 0) {
        return { event, key: "__unmatched__", ref: { cta: null, fallbackText: null } };
      }
      return { event, key: `text:${norm}`, ref: { cta: null, fallbackText: text } };
    },
  );

  const topClickedGroups = topByCount(keyedClicks, (k) => k.key);
  const topClickedGroup = topClickedGroups[0];
  if (!topClickedGroup || topClickedGroup.key === "__unmatched__") {
    return null;
  }
  const clickedSample = topClickedGroup.items[0];
  const clickedCta = clickedSample.ref.cta;
  const clickedText = clickedCta?.text ?? clickedSample.ref.fallbackText;
  const clickedCount = topClickedGroup.count;
  const clickedShare = share(clickedCount, totalClicks) ?? 0;

  // Visually heaviest CTA: the highest-weight non-disabled candidate.
  const eligible = snapshot.data.ctas.filter((cta) => !cta.disabled);
  const heavy = pickHeaviest(eligible);
  if (!heavy) return null;

  if (sameCta(clickedCta, clickedText, heavy)) {
    return null;
  }

  const heavySignals = heavy.visualWeightSignals.slice(0, 3);
  const heavySignalList = heavySignals.length > 0 ? heavySignals.join(", ") : "no class signals";
  const heavyTopSignal = heavy.visualWeightSignals[0] ?? "the dominant treatment";
  const heavyPairSignals =
    heavy.visualWeightSignals.length >= 2
      ? heavy.visualWeightSignals.slice(0, 2).join(" + ")
      : heavyTopSignal;
  const promotionSlot =
    heavy.landmark === "header" ? "the same header position" : "the primary slot";

  const summary =
    `Most-clicked CTA on ${pathRef} is ${quote(clickedText)} (${pct(clickedShare)}% of CTA clicks, ` +
    `${formatCount(clickedCount)} clicks). The visually heaviest CTA is ${quote(heavy.text)} ` +
    `(visual weight ${heavy.visualWeight}, signals: ${heavySignalList}).`;

  const recommendation: string[] = [
    `Either reduce the visual weight of ${quote(heavy.text)} or raise ${quote(clickedText)} to match. ` +
      `The eye should land where the value lands, and right now those are different places.`,
    `Concretely: drop ${heavyTopSignal} from ${quote(heavy.text)}, or promote ${quote(clickedText)} into ` +
      `${promotionSlot} and give it ${heavyPairSignals}.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    {
      label: "Most-clicked CTA",
      value: clickedText ?? "(unnamed CTA)",
      context: `${pct(clickedShare)}% / ${formatCount(clickedCount)} clicks`,
    },
    {
      label: "Visually heaviest CTA",
      value: heavy.text || "(unnamed CTA)",
      context: `weight ${heavy.visualWeight}, ${heavySignalList}`,
    },
    {
      label: "Heaviest CTA position",
      value: heavy.landmark,
      context: `foldGuess: ${heavy.foldGuess}`,
    },
    { label: "Page", value: pathRef },
    { label: "Sample size", value: totalClicks, context: "CTA clicks in window" },
  ];

  const impactEstimate = computeImpactEstimate({
    affectedRate: clickedShare,
    windowVolume: totalClicks,
    windowDays: windowDaysFromTimeWindow(ctx.window),
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `CTA clicks on ${pathRef} going to a lower-priority element`,
  });

  const prescription = {
    whatToChange:
      `Give ${quote(clickedText ?? heavy.text)} the visual weight currently held by ${quote(heavy.text)}. ` +
      `Specifically: apply ${heavy.visualWeightSignals.slice(0, 2).join(' + ')} to ${quote(clickedText ?? '')} ` +
      `and demote ${quote(heavy.text)} to a secondary style.`,
    whyItWorks:
      `Users vote with their clicks — ${pct(clickedShare)}% of CTA clicks go to ${quote(clickedText ?? '')} ` +
      `but ${quote(heavy.text)} gets the most visual attention. Aligning design emphasis with user preference ` +
      `removes the mismatch that forces visitors to hunt for the thing they actually want.`,
    experimentVariantDescription:
      `Variant B: ${quote(clickedText ?? '')} promoted to primary visual treatment; ` +
      `${quote(heavy.text)} demoted to secondary. Primary metric: CTA click rate on ${pathRef}.`,
  };

  return {
    id: `hero-hierarchy-inversion:${pathRef}`,
    ruleId: "hero-hierarchy-inversion",
    category: "hierarchy",
    severity: clickedShare > 0.4 ? "warn" : "info",
    confidence: clamp(0.4 + Math.log10(Math.max(totalClicks, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(clickedShare + 0.2, 0, 1),
    pathRef,
    title: `Visual hierarchy inverts user preference on ${pathRef}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
    evidence,
    refs: { snapshotId: snapshot.id, ctaRef: heavy.ref },
  };
}

function pickHeaviest(ctas: CtaCandidate[]): CtaCandidate | null {
  if (ctas.length === 0) return null;
  let best = ctas[0];
  for (let i = 1; i < ctas.length; i += 1) {
    const candidate = ctas[i];
    if (candidate.visualWeight > best.visualWeight) {
      best = candidate;
      continue;
    }
    if (
      candidate.visualWeight === best.visualWeight &&
      candidate.documentIndex < best.documentIndex
    ) {
      best = candidate;
    }
  }
  return best;
}

function sameCta(
  clicked: CtaCandidate | null,
  clickedText: string | null,
  heavy: CtaCandidate,
): boolean {
  if (clicked && clicked.ref === heavy.ref) {
    return true;
  }
  if (clickedText !== null && normalizeText(clickedText) === normalizeText(heavy.text)) {
    return true;
  }
  return false;
}

/**
 * Measured path: same logic as evaluatePage but excludes CTAs with no
 * bounding box (hidden / display:none / zero-size) from the "heaviest"
 * calculation. This eliminates the most common source of false positives
 * where an off-screen decorative element scores the highest visual weight.
 */
function evaluatePageWithCapture(
  pathRef: string,
  capture: PageCapture,
  clicks: CanonicalEvent[],
  ctx: AuditRuleContext,
): AuditFinding | null {
  const totalClicks = clicks.length;

  // Use the same snapshot-like structure but with measured CTAs
  const snapshotLike = {
    id: `capture:${capture.contentHash}`,
    data: { ctas: capture.ctas },
  } as unknown as PageSnapshot;

  const keyedClicks = clicks.map<{ event: CanonicalEvent; key: string; ref: ClickedRef }>(
    (event) => {
      const matched = matchCtaToEvent(snapshotLike, event);
      if (matched) {
        return { event, key: `ref:${matched.ref}`, ref: { cta: matched, fallbackText: matched.text } };
      }
      const text = typeof event.properties?.['cta_text'] === 'string'
        ? (event.properties['cta_text'] as string) : null;
      const norm = text !== null ? normalizeText(text) : '';
      if (norm.length === 0) return { event, key: '__unmatched__', ref: { cta: null, fallbackText: null } };
      return { event, key: `text:${norm}`, ref: { cta: null, fallbackText: text } };
    },
  );

  const topClickedGroups = topByCount(keyedClicks, (k) => k.key);
  const topClickedGroup = topClickedGroups[0];
  if (!topClickedGroup || topClickedGroup.key === '__unmatched__') return null;

  const clickedSample = topClickedGroup.items[0];
  const clickedCta = clickedSample.ref.cta;
  const clickedText = clickedCta?.text ?? clickedSample.ref.fallbackText;
  const clickedCount = topClickedGroup.count;
  const clickedShare = share(clickedCount, totalClicks) ?? 0;

  // Only consider CTAs with a measured bbox — null means toDocBBox returned
  // nothing (element has zero dimensions or display:none), so exclude them.
  const visibleCtas = (capture.ctas as CtaCandidateMeasured[]).filter(
    cta => !cta.disabled && cta.bbox !== null,
  );
  const heavy = pickHeaviest(visibleCtas) as CtaCandidateMeasured | null;
  if (!heavy) return null;

  if (sameCta(clickedCta, clickedText, heavy)) return null;

  const heavySignals = heavy.visualWeightSignals.slice(0, 3);
  const heavySignalList = heavySignals.length > 0 ? heavySignals.join(', ') : 'no class signals';
  const heavyTopSignal = heavy.visualWeightSignals[0] ?? 'the dominant treatment';
  const heavyPairSignals =
    heavy.visualWeightSignals.length >= 2
      ? heavy.visualWeightSignals.slice(0, 2).join(' + ')
      : heavyTopSignal;
  const promotionSlot =
    heavy.landmark === 'header' ? 'the same header position' : 'the primary slot';
  const bboxNote = heavy.bbox ? ` (${Math.round(heavy.bbox.width)}×${Math.round(heavy.bbox.height)}px)` : '';

  const summary =
    `Most-clicked CTA on ${pathRef} is ${quote(clickedText)} (${pct(clickedShare)}% of CTA clicks, ` +
    `${formatCount(clickedCount)} clicks). The visually heaviest CTA is ${quote(heavy.text)} ` +
    `(visual weight ${heavy.visualWeight}, signals: ${heavySignalList}${bboxNote}).`;

  const recommendation: string[] = [
    `Either reduce the visual weight of ${quote(heavy.text)} or raise ${quote(clickedText)} to match. ` +
      `The eye should land where the value lands, and right now those are different places.`,
    `Concretely: drop ${heavyTopSignal} from ${quote(heavy.text)}, or promote ${quote(clickedText)} into ` +
      `${promotionSlot} and give it ${heavyPairSignals}.`,
  ];

  const evidence = [
    {
      label: 'Most-clicked CTA',
      value: clickedText ?? '(unnamed CTA)',
      context: `${pct(clickedShare)}% / ${formatCount(clickedCount)} clicks`,
    },
    {
      label: 'Visually heaviest CTA',
      value: heavy.text || '(unnamed CTA)',
      context: `weight ${heavy.visualWeight}, ${heavySignalList}${bboxNote}`,
    },
    {
      label: 'Heaviest CTA position',
      value: heavy.landmark,
      context: `foldGuess: ${heavy.foldGuess}`,
    },
    { label: 'Page', value: pathRef },
    { label: 'Sample size', value: totalClicks, context: 'CTA clicks in window' },
  ];

  const impactEstimate = computeImpactEstimate({
    affectedRate: clickedShare,
    windowVolume: totalClicks,
    windowDays: windowDaysFromTimeWindow(ctx.window),
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `CTA clicks on ${pathRef} going to a lower-priority element`,
  });

  const prescription = {
    whatToChange:
      `Give ${quote(clickedText ?? heavy.text)} the visual weight currently held by ${quote(heavy.text)}. ` +
      `Specifically: apply ${heavy.visualWeightSignals.slice(0, 2).join(' + ')} to ${quote(clickedText ?? '')} ` +
      `and demote ${quote(heavy.text)} to a secondary style.`,
    whyItWorks:
      `Users vote with their clicks — ${pct(clickedShare)}% of CTA clicks go to ${quote(clickedText ?? '')} ` +
      `but ${quote(heavy.text)} gets the most visual attention${bboxNote}. Aligning design emphasis with ` +
      `user preference removes the mismatch that forces visitors to hunt for the thing they actually want.`,
    experimentVariantDescription:
      `Variant B: ${quote(clickedText ?? '')} promoted to primary visual treatment; ` +
      `${quote(heavy.text)} demoted to secondary. Primary metric: CTA click rate on ${pathRef}.`,
  };

  return {
    id: `hero-hierarchy-inversion:${pathRef}`,
    ruleId: 'hero-hierarchy-inversion',
    category: 'hierarchy',
    severity: clickedShare > 0.4 ? 'warn' : 'info',
    confidence: clamp(0.4 + Math.log10(Math.max(totalClicks, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(clickedShare + 0.2, 0, 1),
    pathRef,
    title: `Visual hierarchy inverts user preference on ${pathRef}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
    evidence,
  };
}

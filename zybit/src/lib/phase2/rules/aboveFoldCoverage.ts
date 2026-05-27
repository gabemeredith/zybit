/**
 * Rule: above-fold-coverage
 *
 * Per page that has a snapshot (or PageCapture) AND ≥ 30 `page_view` events
 * with a finite scroll metric: pick the visually heaviest CTA below the fold.
 * If more than half of pageviews never scroll past 40% of the page, emit a
 * finding — most visitors literally never see the ask.
 *
 * Dual-path: when a PageCapture is available, uses real `bbox.y < foldY`
 * for precise fold classification instead of the heuristic `foldGuess` field.
 */

import type { CtaCandidate, PageSnapshot } from "@/lib/phase2/snapshots/types";
import type { CtaCandidateMeasured, PageCapture } from "@/lib/phase2/capture/types";
import type { CanonicalEvent } from "@/lib/phase2/types";

import type { VariantModification } from "@/lib/experiments/types";

import { ANNOTATION_HEAVY_COLOR } from "./annotationColors";
import {
  annotationCaption,
  missingPlaceholder,
  outlineMod,
  snapshotHeadingSelector,
} from "./annotationHelpers";
import {
  clamp,
  evidenceFromFinding,
  formatCount,
  pct,
  quote,
  readScrollFraction,
} from "./helpers";
import { calibratedFloor } from "./ruleCalibration";
import { pageTypeFromSnapshot, pageTypeModulation } from "./pageTypeModulation";
import { computeImpactEstimate, windowDaysFromTimeWindow } from "./impactEstimate";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
  ProposeModificationsContext,
  SnapshotDiagram,
  SnapshotDiagramItem,
} from "./types";

const MIN_PAGEVIEWS = 30;
const FOLD_FRACTION = 0.4;
const MIN_VISUAL_WEIGHT = 0.4;
const MIN_BELOW_FOLD_SHARE = 0.5;

export const aboveFoldCoverage: AuditRule = {
  id: "above-fold-coverage",
  name: "Above-fold CTA coverage",
  category: "fold",
  publicAuditBehavior: 'structural-only',

  // Public-audit rewrite: the rule's evaluate() requires ≥30 page_view events
  // with scroll metrics; in public mode those events are synthetic. The
  // structural half ("primary CTA sits below the fold") still holds — the
  // CTA position is measured from real HTML — so this rewrite keeps that
  // framing and strips the behavioral overlay.
  //
  // Vision-fallback (Ring 2 consumer): when the parser's CTA evidence
  // resolves to `(unnamed CTA)` (typical for icon-only buttons), borrow
  // the semantic label from `visualSignals.visualPrimaryCta.text`. Closes
  // the same root cause as `heroHierarchyInversion`'s vision fallback —
  // an icon-only "Get started" hero no longer surfaces as an unnamed
  // placeholder on the prospect surface.
  structuralPublicAuditCopy(finding, ctx) {
    const page = evidenceFromFinding(finding, 'Page') ?? finding.pathRef ?? 'your homepage';
    const parsedCtaLabel = evidenceFromFinding(finding, 'Primary CTA') ?? '';
    let ctaLabel = parsedCtaLabel;
    if (!ctaLabel || ctaLabel.toLowerCase().includes('unnamed')) {
      const snapshot = finding.pathRef ? ctx.pageSnapshotsByPath.get(finding.pathRef) : null;
      const visual = snapshot?.data.visualSignals?.visualPrimaryCta;
      if (visual?.text) ctaLabel = visual.text;
    }
    // Defense-in-depth: if both parser and vision still yield no label, we
    // must not render "(unnamed CTA)" or a bare quote — that's the same
    // gibberish the public-audit scrub exists to catch. Return null and
    // let the orchestrator drop the finding.
    if (!ctaLabel || ctaLabel.toLowerCase().includes('unnamed')) return null;
    return {
      title: `Your primary CTA on ${page} sits below the fold`,
      summary:
        `On ${page}, the heaviest CTA in your design ("${ctaLabel}") only becomes visible after a ` +
        `scroll. Visitors who don't scroll never see your main action — and a meaningful share of any ` +
        `audience doesn't scroll.`,
      whyItMatters:
        `Your heaviest CTA ("${ctaLabel}") only becomes visible after a scroll on ${page} — and a meaningful share of any audience never scrolls.`,
      evidence: [
        { label: 'Primary CTA', value: ctaLabel },
        { label: 'Page', value: page },
        {
          label: 'Based on',
          value: 'page structure (CTA position measured from your HTML — connect PostHog to confirm with real scroll data)',
        },
      ],
    };
  },

  proposeAnnotations(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[] {
    // The prescription is "move this CTA above the fold." Two parts to the
    // story: outline the CTA in red where it lives today (below the fold),
    // and show a missing-placeholder above the first heading where it should
    // go. The two annotations together tell the move-from-here-to-there
    // story — outlining alone would just point at the wrong location.
    const ref = finding.refs?.ctaRef;
    if (!ref) return [];
    const cta = ctx.snapshot.data.ctas.find((c) => c.ref === ref);
    if (!cta?.cssSelector) return [];
    const mods: VariantModification[] = [
      outlineMod(cta.cssSelector, ANNOTATION_HEAVY_COLOR),
      ...annotationCaption({
        anchorSelector: cta.cssSelector,
        position: 'before',
        ruleClassName: 'zybit-anno-fold-current',
        label: 'Below the fold — most visitors never see this',
        color: ANNOTATION_HEAVY_COLOR,
      }),
    ];
    const headingAnchor = snapshotHeadingSelector(ctx.snapshot.data);
    if (headingAnchor) {
      mods.push(
        ...missingPlaceholder({
          anchorSelector: headingAnchor,
          position: 'before',
          ruleClassName: 'zybit-anno-fold-target',
          label: 'a duplicate (or moved) primary CTA here — above the fold',
          color: ANNOTATION_HEAVY_COLOR,
        }),
      );
    }
    return mods;
  },

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const pageviewsByPath = new Map<string, CanonicalEvent[]>();
    for (const event of ctx.events) {
      if (event.type !== "page_view") continue;
      if (readScrollFraction(event) === null) continue;
      let bucket = pageviewsByPath.get(event.path);
      if (!bucket) {
        bucket = [];
        pageviewsByPath.set(event.path, bucket);
      }
      bucket.push(event);
    }

    const windowDays = windowDaysFromTimeWindow(ctx.window);

    for (const [pathRef, pageviews] of pageviewsByPath) {
      if (pageviews.length < MIN_PAGEVIEWS) continue;

      // PageType modulation runs *before* the capture/snapshot branch so
      // suppression and floor-tightening apply uniformly to both paths.
      // blog / legal / docs / about / support legitimately have content
      // below the fold — emitting "your primary CTA is below the fold"
      // on a Privacy Policy is noise regardless of whether we measured
      // it via headless capture or static snapshot. We still need to
      // read pageType from the snapshot (the capture itself doesn't
      // carry visualSignals), so look that up first and fall back to
      // neutral if no snapshot exists yet.
      const snapshot = ctx.pageSnapshotsByPath.get(pathRef);
      const pageType = pageTypeFromSnapshot(snapshot?.data.visualSignals);
      const modulation = pageTypeModulation("above-fold-coverage", pageType);
      if (modulation.suppress) continue;

      // Prefer headless capture (precise bbox) over legacy heuristic snapshot
      if (ctx.pageCapturesByPath) {
        const captures = ctx.pageCapturesByPath.get(pathRef);
        if (captures && captures.length > 0) {
          const desktop = captures.find(c => c.breakpoint === 'desktop') ?? captures[0];
          const finding = evaluatePageWithCapture(pathRef, desktop, pageviews, windowDays, ctx, modulation.floorMultiplier);
          if (finding !== null) findings.push(finding);
          continue;
        }
      }

      if (!snapshot) continue;

      const finding = evaluatePage(pathRef, snapshot, pageviews, windowDays, ctx, modulation.floorMultiplier);
      if (finding !== null) findings.push(finding);
    }

    return findings;
  },
};

function evaluatePage(
  pathRef: string,
  snapshot: PageSnapshot,
  pageviews: CanonicalEvent[],
  windowDays: number,
  ctx: AuditRuleContext,
  floorMultiplier = 1,
): AuditFinding | null {
  const primary = pickPrimaryBelowFoldCta(snapshot.data.ctas);
  if (!primary) return null;
  if (primary.visualWeight < MIN_VISUAL_WEIGHT) return null;

  let lowScrollCount = 0;
  for (const event of pageviews) {
    const fraction = readScrollFraction(event);
    if (fraction === null) continue;
    if (fraction < FOLD_FRACTION) {
      lowScrollCount += 1;
    }
  }
  const totalPageviews = pageviews.length;
  const belowFoldShare = totalPageviews > 0 ? lowScrollCount / totalPageviews : 0;
  // PageType-modulated floor: pricing/signup/checkout get a lower bar
  // (floorMultiplier ~0.7) because below-fold CTAs on a conversion page are
  // higher impact. Other rules pass 1 (neutral). Calibrated floor still
  // applies first — pageType only further loosens or tightens it.
  if (belowFoldShare <= calibratedFloor(ctx, "above-fold-coverage", MIN_BELOW_FOLD_SHARE) * floorMultiplier) return null;

  const signals = primary.visualWeightSignals.slice(0, 3);
  const signalList = signals.length > 0 ? signals.join(", ") : "no class signals";

  const summary =
    `${pct(belowFoldShare)}% of pageviews on ${pathRef} never scroll past 40% of the page. ` +
    `${quote(primary.text)} (visual weight ${primary.visualWeight}, foldGuess ${primary.foldGuess}) ` +
    `sits inside the ${primary.landmark} — most visitors never see it.`;

  const recommendation: string[] = [
    `Move ${quote(primary.text)} above the fold, or duplicate it as a secondary CTA in the hero. ` +
      `Right now your ask costs the visitor a scroll, and ${pct(belowFoldShare)}% of them don't pay it.`,
    `If ${primary.landmark} can't be restructured, add an anchor link or sticky version. The signals ` +
      `making this CTA visually important (${signalList}) only matter when the CTA is rendered.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    {
      label: "Primary CTA",
      value: primary.text || "(unnamed CTA)",
      context: `weight ${primary.visualWeight}, fold ${primary.foldGuess}, landmark ${primary.landmark}`,
    },
    {
      label: "Below-fold sessions",
      value: `${pct(belowFoldShare)}%`,
      context: `${formatCount(lowScrollCount)} of ${formatCount(totalPageviews)} pageviews scrolled <40%`,
    },
    { label: "Page", value: pathRef },
  ];

  // Build page-structure diagram for the UI wireframe
  const diagramItems: SnapshotDiagramItem[] = [];
  // Add headings (H1 first, then H2s) in document order
  for (const h of snapshot.data.headings.slice(0, 5)) {
    diagramItems.push({
      type: h.level === 1 ? 'h1' : h.level === 2 ? 'h2' : 'h3',
      text: h.text.length > 60 ? h.text.slice(0, 57) + '…' : h.text,
      isFlagged: false,
    });
  }
  // Add CTAs in document order (flag the primary below-fold one)
  for (const cta of snapshot.data.ctas.slice(0, 4)) {
    diagramItems.push({
      type: 'cta',
      text: cta.text.length > 40 ? cta.text.slice(0, 37) + '…' : cta.text,
      isFlagged: cta.ref === primary.ref,
      foldGuess: cta.foldGuess,
      proposedPosition: cta.ref === primary.ref ? 'above-fold' : undefined,
      subtext: `weight ${cta.visualWeight.toFixed(1)}, ${cta.landmark}`,
    });
  }
  // Fold line: after the last item whose foldGuess is 'above', or after index 2
  const lastAboveIdx = diagramItems.reduce((acc, item, idx) =>
    item.foldGuess === 'above' ? idx : acc, 1);
  const foldAfterIndex = Math.max(0, lastAboveIdx);

  const snapshotDiagram: SnapshotDiagram = {
    type: 'page-structure',
    pathRef,
    items: diagramItems,
    foldAfterIndex,
    proposedFix: `Move ${quote(primary.text)} above the fold line — duplicate it as a hero CTA or sticky element.`,
  };

  const impactEstimate = computeImpactEstimate({
    affectedRate: belowFoldShare,
    windowVolume: totalPageviews,
    windowDays,
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `pageviews on ${pathRef}`,
  });

  const prescription = {
    whatToChange:
      `Move ${quote(primary.text)} above the fold on ${pathRef}. ` +
      `If the layout can't be restructured, add a sticky version or duplicate it as a hero button.`,
    whyItWorks:
      `${pct(belowFoldShare)}% of sessions never scroll past 40% of the page. ` +
      `${quote(primary.text)} has visual weight ${primary.visualWeight} — it's designed to convert, ` +
      `but most visitors never reach it. Moving it above the fold puts the ask where the attention is.`,
    experimentVariantDescription:
      `Variant B: ${quote(primary.text)} repositioned above the fold in the hero section. ` +
      `All other content unchanged. Primary metric: CTA click rate on ${pathRef}.`,
  };

  return {
    id: `above-fold-coverage:${pathRef}`,
    ruleId: "above-fold-coverage",
    category: "fold",
    severity: belowFoldShare > 0.7 ? "critical" : "warn",
    confidence: clamp(0.5 + Math.log10(Math.max(totalPageviews, 1)) * 0.15, 0, 0.95),
    priorityScore: clamp(belowFoldShare, 0, 1),
    pathRef,
    title: 'Primary CTA hidden below the fold',
    summary,
    recommendation,
    prescription,
    impactEstimate,
    snapshotDiagram,
    evidence,
    refs: { snapshotId: snapshot.id, ctaRef: primary.ref },
  };
}

function pickPrimaryBelowFoldCta(ctas: readonly CtaCandidate[]): CtaCandidate | null {
  let best: CtaCandidate | null = null;
  for (const cta of ctas) {
    if (cta.disabled) continue;
    if (cta.foldGuess === "above") continue;
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

/** Measured path: uses real bbox.y vs foldY instead of heuristic foldGuess. */
function pickPrimaryBelowFoldCtaMeasured(
  ctas: readonly CtaCandidateMeasured[],
  foldY: number,
): CtaCandidateMeasured | null {
  let best: CtaCandidateMeasured | null = null;
  for (const cta of ctas) {
    if (cta.disabled) continue;
    if (cta.visualWeight < MIN_VISUAL_WEIGHT) continue;
    // Null bbox → hidden/zero-size element; can't be "seen below the fold"
    // Non-null bbox with top edge above foldY → element is above the fold
    if (cta.bbox === null || cta.bbox.y < foldY) continue;
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

function evaluatePageWithCapture(
  pathRef: string,
  capture: PageCapture,
  pageviews: CanonicalEvent[],
  windowDays: number,
  ctx: AuditRuleContext,
  floorMultiplier = 1,
): AuditFinding | null {
  const primary = pickPrimaryBelowFoldCtaMeasured(capture.ctas, capture.fold.foldY);
  if (!primary) return null;

  let lowScrollCount = 0;
  for (const event of pageviews) {
    const fraction = readScrollFraction(event);
    if (fraction === null) continue;
    if (fraction < FOLD_FRACTION) lowScrollCount++;
  }
  const totalPageviews = pageviews.length;
  const belowFoldShare = totalPageviews > 0 ? lowScrollCount / totalPageviews : 0;
  // PageType-modulated floor (same shape as the snapshot path in
  // `evaluatePage`): pricing/signup/checkout get a lower bar
  // (floorMultiplier ~0.7); other rules pass 1 (neutral). Calibrated
  // floor still applies first.
  if (belowFoldShare <= calibratedFloor(ctx, "above-fold-coverage", MIN_BELOW_FOLD_SHARE) * floorMultiplier) return null;

  const signals = primary.visualWeightSignals.slice(0, 3);
  const signalList = signals.length > 0 ? signals.join(", ") : "no class signals";
  const foldPx = Math.round(capture.fold.foldY);
  const ctaTopPx = primary.bbox ? Math.round(primary.bbox.y) : null;
  const positionLabel = ctaTopPx !== null ? `${ctaTopPx}px from top (fold at ${foldPx}px)` : `foldGuess ${primary.foldGuess}`;

  const summary =
    `${pct(belowFoldShare)}% of pageviews on ${pathRef} never scroll past 40% of the page. ` +
    `${quote(primary.text)} (visual weight ${primary.visualWeight}, ${positionLabel}) ` +
    `sits inside the ${primary.landmark} — most visitors never see it.`;

  const recommendation: string[] = [
    `Move ${quote(primary.text)} above the fold, or duplicate it as a secondary CTA in the hero. ` +
      `Right now your ask costs the visitor a scroll, and ${pct(belowFoldShare)}% of them don't pay it.`,
    `If ${primary.landmark} can't be restructured, add an anchor link or sticky version. The signals ` +
      `making this CTA visually important (${signalList}) only matter when the CTA is rendered.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    {
      label: "Primary CTA",
      value: primary.text || "(unnamed CTA)",
      context: `weight ${primary.visualWeight}, ${positionLabel}, landmark ${primary.landmark}`,
    },
    {
      label: "Below-fold sessions",
      value: `${pct(belowFoldShare)}%`,
      context: `${formatCount(lowScrollCount)} of ${formatCount(totalPageviews)} pageviews scrolled <40%`,
    },
    { label: "Page", value: pathRef },
  ];

  // Diagram items
  const diagramItems: SnapshotDiagramItem[] = [];
  for (const h of capture.headings.slice(0, 5)) {
    diagramItems.push({
      type: h.level === 1 ? 'h1' : h.level === 2 ? 'h2' : 'h3',
      text: h.text.length > 60 ? h.text.slice(0, 57) + '…' : h.text,
      isFlagged: false,
    });
  }
  for (const cta of capture.ctas.slice(0, 4)) {
    const isAbove = cta.bbox !== null && cta.bbox.y < capture.fold.foldY;
    diagramItems.push({
      type: 'cta',
      text: cta.text.length > 40 ? cta.text.slice(0, 37) + '…' : cta.text,
      isFlagged: cta.ref === primary.ref,
      foldGuess: isAbove ? 'above' : cta.bbox ? 'below' : cta.foldGuess,
      proposedPosition: cta.ref === primary.ref ? 'above-fold' : undefined,
      subtext: `weight ${cta.visualWeight.toFixed(1)}, ${cta.landmark}`,
    });
  }
  const lastAboveIdx = diagramItems.reduce((acc, item, idx) =>
    item.foldGuess === 'above' ? idx : acc, 1);

  const snapshotDiagram: SnapshotDiagram = {
    type: 'page-structure',
    pathRef,
    items: diagramItems,
    foldAfterIndex: Math.max(0, lastAboveIdx),
    proposedFix: `Move ${quote(primary.text)} above the fold line — duplicate it as a hero CTA or sticky element.`,
  };

  const impactEstimate = computeImpactEstimate({
    affectedRate: belowFoldShare,
    windowVolume: totalPageviews,
    windowDays,
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `pageviews on ${pathRef}`,
  });

  const prescription = {
    whatToChange:
      `Move ${quote(primary.text)} above the fold on ${pathRef}. ` +
      `If the layout can't be restructured, add a sticky version or duplicate it as a hero button.`,
    whyItWorks:
      `${pct(belowFoldShare)}% of sessions never scroll past 40% of the page. ` +
      `${quote(primary.text)} has visual weight ${primary.visualWeight}${ctaTopPx !== null ? ` and its top edge is at ${ctaTopPx}px (fold is ${foldPx}px)` : ''} — ` +
      `it's designed to convert, but most visitors never reach it.`,
    experimentVariantDescription:
      `Variant B: ${quote(primary.text)} repositioned above the fold in the hero section. ` +
      `All other content unchanged. Primary metric: CTA click rate on ${pathRef}.`,
  };

  return {
    id: `above-fold-coverage:${pathRef}`,
    ruleId: "above-fold-coverage",
    category: "fold",
    severity: belowFoldShare > 0.7 ? "critical" : "warn",
    confidence: clamp(0.5 + Math.log10(Math.max(totalPageviews, 1)) * 0.15, 0, 0.95),
    priorityScore: clamp(belowFoldShare, 0, 1),
    pathRef,
    title: 'Primary CTA hidden below the fold',
    summary,
    recommendation,
    prescription,
    impactEstimate,
    snapshotDiagram,
    evidence,
    refs: {
      ...(ctx.pageSnapshotsByPath.get(pathRef)?.id
        ? { snapshotId: ctx.pageSnapshotsByPath.get(pathRef)!.id }
        : {}),
      ctaRef: primary.ref,
    },
  };
}

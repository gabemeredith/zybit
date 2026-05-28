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
  evidenceFromFinding,
  formatCount,
  matchCtaToEvent,
  normalizeText,
  pct,
  quote,
  share,
  topByCount,
} from "./helpers";
import { ANNOTATION_CLICKED_COLOR, ANNOTATION_HEAVY_COLOR } from "./annotationColors";
import { siteNicheModulation } from "./siteNicheModulation";
import { annotationCaption, outlineMod } from "./annotationHelpers";
import { computeImpactEstimate, windowDaysFromTimeWindow } from "./impactEstimate";
import type {
  AuditFinding,
  AuditFindingEvidence,
  AuditRule,
  AuditRuleContext,
  ProposeModificationsContext,
} from "./types";
import type { VariantModification } from "@/lib/experiments/types";

const MIN_CTA_CLICKS = 30;

interface ClickedRef {
  cta: CtaCandidate | null;
  fallbackText: string | null;
}

// ── PM-facing copy helpers ──────────────────────────────────────────────────
// Translate internal labels (path strings, PageLandmark values,
// visualWeightSignals) into the language a PM uses. Kept local to this file
// while the why-framing pattern is being piloted — promote to `helpers.ts`
// once a second rule adopts it.

function humanizePath(pathRef: string): string {
  if (pathRef === '/' || pathRef === '') return 'your homepage';
  const slug = pathRef.replace(/^\//, '').split('/')[0] ?? '';
  if (slug.length === 0) return 'your homepage';
  return `your ${slug.replace(/-/g, ' ')} page`;
}

function describeLandmark(landmark: string): string {
  switch (landmark) {
    case 'header': return 'in your top nav';
    case 'nav':    return 'in your nav bar';
    case 'main':   return 'in the main content area';
    case 'aside':  return 'in the sidebar';
    case 'footer': return 'in the footer';
    case 'dialog': return 'in a dialog';
    default:       return 'on the page';
  }
}

/**
 * Turn the raw visualWeightSignals (`tag:a`, `landmark:header`, `text-xl`,
 * `font-bold`, `bg-blue-600`, …) into a short, plain-English phrase a PM
 * can act on. Intentionally lossy — a PM doesn't need the exact tokens.
 */
function describeVisualTreatment(signals: readonly string[]): string {
  const has = (pred: (s: string) => boolean) => signals.some(pred);
  const parts: string[] = [];
  if (has(s => /^text-(lg|xl|2xl|3xl|4xl|5xl)$/.test(s) || s.startsWith('size:'))) parts.push('larger text');
  if (has(s => /^font-(bold|extrabold|black|semibold)$/.test(s) || /^weight:(bold|[789]00)$/.test(s))) parts.push('bold weight');
  if (has(s => s.startsWith('bg-') || s.startsWith('background:'))) parts.push('a filled background');
  if (parts.length === 0) return 'the same bold styling';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

const FALLBACK_SECONDARY_COLOR = '#666';

export const heroHierarchyInversion: AuditRule = {
  id: "hero-hierarchy-inversion",
  name: "Hero hierarchy inversion",
  category: "hierarchy",
  publicAuditBehavior: 'structural-only',

  // Public-audit rewrite: the rule fires on real `cta_click` events in the
  // in-app pipeline, but on synthetic events in the public-audit pipeline.
  // The structural half (topmost vs visually heaviest CTA) is honest in both
  // modes — strip the behavioral framing for the prospect and lean on
  // structure-only language. Keeps title/evidence/whyItMatters in sync
  // between the persisted finding row and the email render.
  structuralPublicAuditCopy(finding) {
    const topmost = evidenceFromFinding(finding, 'What visitors click most') ?? '(unnamed button)';
    const heavy = evidenceFromFinding(finding, 'What your design emphasizes') ?? '(unnamed button)';
    const page = evidenceFromFinding(finding, 'Page') ?? finding.pathRef ?? 'your homepage';
    if (topmost.includes('(unnamed') || heavy.includes('(unnamed')) {
      // Defense-in-depth: the rule's evaluate() now bails on unnamed sides,
      // but a future regression that emitted them would slip through unless
      // we also refuse to render here. Returning null leaves the finding's
      // own copy intact so the registry test still sees a present rewrite.
      return null;
    }
    return {
      title: `On ${page}, the topmost CTA isn't the one your design emphasizes`,
      summary:
        `${page} leads with "${topmost}" at the top of the DOM, but your design's visual weight ` +
        `is on "${heavy}". The button the eye lands on and the button the page leads with aren't the ` +
        `same — visitors have to scan past the loud one to find the topmost one. That's friction.`,
      whyItMatters:
        `On ${page} the eye lands on "${heavy}" but the page leads with "${topmost}" — visitors pay a scan tax on every session to reconcile the mismatch.`,
      evidence: [
        { label: 'Topmost CTA', value: topmost },
        { label: 'Most visually emphasized CTA', value: heavy },
        { label: 'Page', value: page },
        {
          label: 'Based on',
          value: 'page structure (we cannot see your real visitors yet — connect PostHog to confirm with click data)',
        },
      ],
    };
  },

  proposeModifications(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[][] {
    const heavyRef = finding.refs?.ctaRef;
    if (!heavyRef) return [];
    const heavy = ctx.snapshot.data?.ctas?.find((cta) => cta.ref === heavyRef);
    if (!heavy || !heavy.cssSelector) return [];

    const secondary = ctx.designTokens?.secondaryColor ?? FALLBACK_SECONDARY_COLOR;
    return [[
      {
        type: 'css-inject',
        selector: heavy.cssSelector,
        css: `background: transparent; color: ${secondary}; font-weight: 400; border: 1px solid currentColor;`,
      },
    ]];
  },

  proposeAnnotations(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[] {
    // The two-color outline is already the right story (eye-vs-clicks
    // mismatch). Caption each one so the PM doesn't have to map color →
    // meaning mentally — heavy = "your design emphasizes this," clicked =
    // "users actually want this."
    const mods: VariantModification[] = [];
    const heavyRef = finding.refs?.ctaRef;
    const clickedRef = finding.refs?.clickedCtaRef;
    const heavy = heavyRef
      ? ctx.snapshot.data?.ctas?.find((cta) => cta.ref === heavyRef)
      : null;
    const clicked = clickedRef
      ? ctx.snapshot.data?.ctas?.find((cta) => cta.ref === clickedRef)
      : null;
    if (heavy?.cssSelector) {
      mods.push(outlineMod(heavy.cssSelector, ANNOTATION_HEAVY_COLOR));
      mods.push(
        ...annotationCaption({
          anchorSelector: heavy.cssSelector,
          position: 'after',
          ruleClassName: 'zybit-anno-hierarchy-heavy',
          label: 'Heaviest visual — but visitors don\'t click here',
          color: ANNOTATION_HEAVY_COLOR,
        }),
      );
    }
    if (clicked?.cssSelector) {
      mods.push(outlineMod(clicked.cssSelector, ANNOTATION_CLICKED_COLOR));
      mods.push(
        ...annotationCaption({
          anchorSelector: clicked.cssSelector,
          position: 'after',
          ruleClassName: 'zybit-anno-hierarchy-clicked',
          label: 'Visitors actually click here — give it the heavy treatment',
          color: ANNOTATION_CLICKED_COLOR,
        }),
      );
    }
    return mods;
  },

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

    // Site-niche severity downgrade: community/education/devtools hero patterns
    // are often intentional — an event photo hero or terminal-first hero is
    // not a CTA mistake. Downgrade warn → info so it surfaces for awareness
    // without being ranked as a top-priority fix.
    const nicheModulation = siteNicheModulation('hero-hierarchy-inversion', ctx.siteNiche);
    if (nicheModulation.severityDowngrade) {
      for (const f of findings) {
        if (f.severity === 'warn') f.severity = 'info';
      }
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

  // Vision-pass fallback for `heavyLabel` only: when the parser couldn't
  // read CTA text — typical for icon-only "Get started" buttons that ship
  // as `<button><svg/></button>` — borrow the semantic label from
  // `visualSignals.visualPrimaryCta`. Both `pickHeaviest()` and the vision
  // pass rank by visual prominence, so the correspondence holds well
  // enough for evidence copy. Closes handover §12.A's "unnamed-CTA root
  // cause" item.
  //
  // No symmetric fallback for `clickedLabel`: `visualSecondaryCta` is "the
  // second-most-visually-prominent CTA Gemini saw," not "the CTA visitors
  // clicked most." Borrowing it would mislabel icon-only most-clicked
  // elements (hamburger menus, search icons) with whatever vision called
  // secondary — fabricated evidence on the prospect surface. When clicked
  // text is missing, fall through to the bail below instead.
  const visual = snapshot.data.visualSignals;
  const heavyLabel =
    (heavy.text && heavy.text.length > 0) ? heavy.text :
    visual?.visualPrimaryCta?.text ?? '';
  const clickedLabel = clickedText ?? '';

  // Bail when either side STILL resolves to no text — the finding is
  // unactionable and the rendered output is gibberish ("your visitors want
  // '(unnamed button)' but your page emphasizes '(unnamed button)'"). After
  // vision fallback this is a much narrower bail than before; protects
  // every audit, not just public.
  if (!heavyLabel || !clickedLabel) return null;

  const pageName = humanizePath(pathRef);
  const heavyLocation = describeLandmark(heavy.landmark);
  const heavyTreatment = describeVisualTreatment(heavy.visualWeightSignals);
  const windowDays = windowDaysFromTimeWindow(ctx.window);
  const clickedQ = quote(clickedLabel);
  const heavyQ = quote(heavyLabel);

  const summary =
    `Of ${formatCount(totalClicks)} button clicks on ${pageName}, ${pct(clickedShare)}% went to ${clickedQ} ` +
    `— even though ${heavyQ} sits ${heavyLocation} with ${heavyTreatment}. The button your design ` +
    `emphasizes isn't the button your visitors want.`;

  const recommendation: string[] = [
    `Either reduce the visual weight of ${heavyQ} or raise ${clickedQ} to match. ` +
      `The eye should land where the value lands, and right now those are different places.`,
    `Concretely: promote ${clickedQ} ${heavyLocation} and give it ${heavyTreatment}, ` +
      `or demote ${heavyQ} to a secondary style.`,
  ];

  const evidence: AuditFindingEvidence[] = [
    {
      label: 'What visitors click most',
      value: clickedLabel,
      context: `${pct(clickedShare)}% of clicks · ${formatCount(clickedCount)} clicks`,
    },
    {
      label: 'What your design emphasizes',
      value: heavyLabel,
      context: `${heavyLocation}, ${heavyTreatment}`,
    },
    { label: 'Page', value: pageName },
    {
      label: 'Based on',
      value: `${formatCount(totalClicks)} button clicks over the last ${windowDays} days`,
    },
  ];

  const impactEstimate = computeImpactEstimate({
    affectedRate: clickedShare,
    windowVolume: totalClicks,
    windowDays,
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `CTA clicks on ${pathRef} going to a lower-priority element`,
  });

  const prescription = {
    whyItMatters:
      `Your visitors are reaching for ${clickedQ}, but ${pageName} is pointing them at ${heavyQ} ` +
      `${heavyLocation}. Every visitor who arrives wanting the thing they actually want has to scan past ` +
      `the loud button to find the small one — that's friction you're paying for on every session.`,
    whatToChange:
      `Promote ${clickedQ} ${heavyLocation} and give it ${heavyTreatment} (the styling ${heavyQ} has today). ` +
      `Demote ${heavyQ} to a secondary style.`,
    whyItWorks:
      `Designs work when visual emphasis matches user intent — the eye should land where the value lands. ` +
      `When they don't, visitors slow down, second-guess, and a chunk of them bounce before they find what they came for.`,
    experimentVariantDescription:
      `Variant B: ${clickedQ} promoted to primary visual treatment; ${heavyQ} demoted to secondary. ` +
      `Primary metric: CTA click rate on ${pathRef}.`,
  };

  return {
    id: `hero-hierarchy-inversion:${pathRef}`,
    ruleId: 'hero-hierarchy-inversion',
    category: 'hierarchy',
    severity: clickedShare > 0.4 ? 'warn' : 'info',
    confidence: clamp(0.4 + Math.log10(Math.max(totalClicks, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(clickedShare + 0.2, 0, 1),
    pathRef,
    title: `Your visitors want ${clickedQ}, but ${pageName} points them at ${heavyQ}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
    evidence,
    refs: {
      snapshotId: snapshot.id,
      ctaRef: heavy.ref,
      ...(clickedCta ? { clickedCtaRef: clickedCta.ref } : {}),
    },
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

  // Mirror the snapshot-path guard: don't fire when either side has no text.
  // See the snapshot-only `evaluate()` path above for the rationale.
  const clickedHasText = !!clickedText && clickedText.length > 0;
  const heavyHasText = !!heavy.text && heavy.text.length > 0;
  if (!clickedHasText || !heavyHasText) return null;

  if (sameCta(clickedCta, clickedText, heavy)) return null;

  const pageName = humanizePath(pathRef);
  const heavyLocation = describeLandmark(heavy.landmark);
  const heavyTreatment = describeVisualTreatment(heavy.visualWeightSignals);
  const windowDays = windowDaysFromTimeWindow(ctx.window);
  const clickedQ = quote(clickedText);
  const heavyQ = quote(heavy.text);
  const sizeNote = heavy.bbox
    ? ` and is ${Math.round(heavy.bbox.width)}×${Math.round(heavy.bbox.height)}px on desktop`
    : '';

  const summary =
    `Of ${formatCount(totalClicks)} button clicks on ${pageName}, ${pct(clickedShare)}% went to ${clickedQ} ` +
    `— even though ${heavyQ} sits ${heavyLocation} with ${heavyTreatment}${sizeNote}. ` +
    `The button your design emphasizes isn't the button your visitors want.`;

  const recommendation: string[] = [
    `Either reduce the visual weight of ${heavyQ} or raise ${clickedQ} to match. ` +
      `The eye should land where the value lands, and right now those are different places.`,
    `Concretely: promote ${clickedQ} ${heavyLocation} and give it ${heavyTreatment}, ` +
      `or demote ${heavyQ} to a secondary style.`,
  ];

  const evidence = [
    {
      label: 'What visitors click most',
      value: clickedText ?? '(unnamed button)',
      context: `${pct(clickedShare)}% of clicks · ${formatCount(clickedCount)} clicks`,
    },
    {
      label: 'What your design emphasizes',
      value: heavy.text || '(unnamed button)',
      context: `${heavyLocation}, ${heavyTreatment}${sizeNote}`,
    },
    { label: 'Page', value: pageName },
    {
      label: 'Based on',
      value: `${formatCount(totalClicks)} button clicks over the last ${windowDays} days`,
    },
  ];

  const impactEstimate = computeImpactEstimate({
    affectedRate: clickedShare,
    windowVolume: totalClicks,
    windowDays,
    goalType: ctx.config.goalType,
    goalConfig: ctx.config.goalConfig,
    signalDescription: `CTA clicks on ${pathRef} going to a lower-priority element`,
  });

  const prescription = {
    whyItMatters:
      `Your visitors are reaching for ${clickedQ}, but ${pageName} is pointing them at ${heavyQ} ` +
      `${heavyLocation}. Every visitor who arrives wanting the thing they actually want has to scan past ` +
      `the loud button to find the small one — that's friction you're paying for on every session.`,
    whatToChange:
      `Promote ${clickedQ} ${heavyLocation} and give it ${heavyTreatment} (the styling ${heavyQ} has today). ` +
      `Demote ${heavyQ} to a secondary style.`,
    whyItWorks:
      `Designs work when visual emphasis matches user intent — the eye should land where the value lands. ` +
      `When they don't, visitors slow down, second-guess, and a chunk of them bounce before they find what they came for.`,
    experimentVariantDescription:
      `Variant B: ${clickedQ} promoted to primary visual treatment; ${heavyQ} demoted to secondary. ` +
      `Primary metric: CTA click rate on ${pathRef}.`,
  };

  return {
    id: `hero-hierarchy-inversion:${pathRef}`,
    ruleId: 'hero-hierarchy-inversion',
    category: 'hierarchy',
    severity: clickedShare > 0.4 ? 'warn' : 'info',
    confidence: clamp(0.4 + Math.log10(Math.max(totalClicks, 1)) * 0.2, 0, 0.95),
    priorityScore: clamp(clickedShare + 0.2, 0, 1),
    pathRef,
    title: `Your visitors want ${clickedQ}, but ${pageName} points them at ${heavyQ}`,
    summary,
    prescription,
    impactEstimate,
    recommendation,
    evidence,
    refs: {
      ctaRef: heavy.ref,
      ...(clickedCta ? { clickedCtaRef: clickedCta.ref } : {}),
    },
  };
}

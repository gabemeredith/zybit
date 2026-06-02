/**
 * Orchestrator for the public-audit before/after fix-preview pipeline.
 *
 * Three-tier ladder, per finding. Each tier degrades to the next on
 * failure so the audit never ships without *some* visual:
 *
 *   Tier 1 — deterministic mutation:
 *     suggestAuditFix() ─► VariantModification[] ─► applyModifications()
 *     ─► Browserless before+after render. The "after" is a real render of
 *        a real fix; the rationale is the model's PM-readable one-liner.
 *
 *   Tier 2 — vision inpaint:
 *     The before screenshot is sent to gemini-2.5-flash-image-preview with
 *     a brand-tokens + finding-prescription prompt; the model edits the
 *     offending region of the real screenshot. Brand consistency is preserved
 *     by construction because everything outside the edit is the real site.
 *
 *   Tier 3 — annotated-before fallback (already shipped):
 *     `renderFindingScreenshot` runs in the existing path; the audit shows
 *     the highlighted "before" only with a "Sign up to see the fix" CTA.
 *     This module doesn't run Tier 3 itself — it returns `null` and the
 *     caller leaves the legacy `screenshotUrl` in place.
 *
 * Concurrency: the orchestrator processes one finding at a time. Browserless
 * connections aren't cheap on the cost side and they're rate-limited on the
 * Browserless side; we stay sequential to avoid surprises.
 */

import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase1Sites, zybitFindings } from '@/lib/db/schema';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { VariantModification } from '@/lib/experiments/types';
import type { SiteContext } from '@/lib/phase2/siteContext';
import { suggestAuditFix as defaultSuggestAuditFix } from './auditFixAdvisor';
import {
  renderBeforeAfter as defaultRenderBeforeAfter,
  renderBeforeOnly as defaultRenderBeforeOnly,
} from './renderBeforeAfter';
import { inpaintFixAfter as defaultInpaintFixAfter } from './visionInpaint';
import { assessScreenshotQuality as defaultAssessScreenshotQuality } from './screenshotQualityGate';
import type { FixPreview, FixPreviewOutcome } from './types';

/** A finding row, narrowed to the fields the orchestrator needs. */
export interface FindingForFixPreview {
  id: string;
  ruleId: string;
  title: string;
  pathRef: string | null;
  prescription: {
    whyItMatters?: string;
    whatToChange: string;
    whyItWorks: string;
    experimentVariantDescription: string;
  } | null;
}

export interface GenerateFixPreviewsArgs {
  organizationId: string;
  siteId: string;
  /** The audit URL — `https://<domain>` or w/ a path; used to construct per-pathRef URLs. */
  auditUrl: string;
  findings: FindingForFixPreview[];
  /** Hard cap. Top findings only — the lead magnet's wow surface is small. */
  maxFindings?: number;
  /** Business context — makes the generated fix on-brand. Optional / null = baseline. */
  siteContext?: SiteContext | null;
}

/**
 * Injectable dependencies. Production code leaves these undefined and the
 * orchestrator picks up the real implementations; tests substitute stubs
 * so the tier-fallback ladder can be exercised without Browserless +
 * Gemini + Neon.
 */
export interface FixPreviewDeps {
  suggestAuditFix?: typeof import('./auditFixAdvisor').suggestAuditFix;
  renderBeforeAfter?: typeof import('./renderBeforeAfter').renderBeforeAfter;
  renderBeforeOnly?: typeof import('./renderBeforeAfter').renderBeforeOnly;
  inpaintFixAfter?: typeof import('./visionInpaint').inpaintFixAfter;
  /** Override the screenshot quality gate for tests. */
  assessScreenshotQuality?: typeof import('./screenshotQualityGate').assessScreenshotQuality;
  /** Override the domain lookup for tests. */
  lookupDomain?: (organizationId: string, siteId: string) => Promise<string | null>;
  /** Override the design-snapshot lookup for tests. */
  lookupDesign?: (
    organizationId: string,
    siteId: string,
    pathRef: string,
  ) => Promise<{ designTokens: Record<string, unknown> | null; cssSystem: string | null } | null>;
  /**
   * Override the per-pathRef CTA-vocabulary lookup for tests. Returns the
   * site's conversion copy register (top non-nav/header CTA labels) so the
   * advisor's COPY REGISTER section is populated with real signal, not `[]`.
   */
  lookupCtaVocabulary?: (
    siteId: string,
    pathRef: string,
  ) => Promise<string[]>;
  /**
   * Override the resolved-render-URL lookup for tests. Returns the snapshot's
   * stored final URL (post-redirect) for the pathRef, so the render hits the
   * same origin the audit actually analyzed instead of the apex domain.
   */
  lookupRenderUrl?: (
    organizationId: string,
    siteId: string,
    pathRef: string,
  ) => Promise<string | null>;
  /** Override persistence for tests. Pass `noop` to skip the DB write. */
  persist?: (
    organizationId: string,
    preview: FixPreview,
  ) => Promise<void>;
}

const DEFAULT_MAX = 4;

/**
 * Rules whose findings are purely structural — the "fix" is a code edit
 * (add `<meta name="description">`, fix heading order, add an `href`, etc.)
 * that produces no visible delta in a screenshot. Generating before/after
 * imagery for these wastes Browserless + Gemini calls and produces visually
 * identical pairs that confuse the reader. Skip them at orchestration time;
 * the email gracefully renders the card without a preview row.
 */
const SKIP_FIX_PREVIEW_RULE_IDS = new Set<string>([
  'dead-click-target',
  'heading-hierarchy-jump',
  'missing-meta-description',
  'missing-canonical-url',
  'form-label-missing',
  'image-alt-text-missing',
  // nav-dispersion's fix is an information-architecture change (collapse the
  // top nav to 4 entries, demote the rest). There's no single-page CSS edit
  // that renders a meaningful before/after, so a screenshot pair would be
  // visually identical or misleading.
  'nav-dispersion',
]);

export async function generateFixPreviews(
  args: GenerateFixPreviewsArgs,
  deps: FixPreviewDeps = {},
): Promise<FixPreviewOutcome[]> {
  if (process.env.AUDIT_FIX_PREVIEW_ENABLED !== '1') {
    return args.findings.map((f) => ({
      findingId: f.id,
      preview: null,
      reason: 'tier3-fallback',
    }));
  }

  const cap = args.maxFindings ?? DEFAULT_MAX;
  const targets = args.findings.slice(0, cap);
  if (targets.length === 0) return [];

  const suggest = deps.suggestAuditFix ?? defaultSuggestAuditFix;
  const renderBA = deps.renderBeforeAfter ?? defaultRenderBeforeAfter;
  const renderBO = deps.renderBeforeOnly ?? defaultRenderBeforeOnly;
  const inpaint = deps.inpaintFixAfter ?? defaultInpaintFixAfter;
  const assessQuality = deps.assessScreenshotQuality ?? defaultAssessScreenshotQuality;
  const persist = deps.persist ?? persistFixPreview;

  const lookupDomain = deps.lookupDomain ?? defaultLookupDomain;
  const lookupDesign = deps.lookupDesign ?? defaultLookupDesign;
  const lookupCtaVocabulary = deps.lookupCtaVocabulary ?? defaultLookupCtaVocabulary;
  const lookupRenderUrl = deps.lookupRenderUrl ?? defaultLookupRenderUrl;

  const domain = await lookupDomain(args.organizationId, args.siteId);

  // Re-derive the URL scheme from the original audit URL so the preview
  // hits the same protocol the prospect typed. Defaults to https.
  let scheme = 'https';
  try {
    scheme = new URL(args.auditUrl).protocol.replace(':', '') || 'https';
  } catch {
    /* keep default */
  }

  const outcomes: FixPreviewOutcome[] = [];

  for (const finding of targets) {
    if (SKIP_FIX_PREVIEW_RULE_IDS.has(finding.ruleId)) {
      outcomes.push({
        findingId: finding.id,
        preview: null,
        reason: 'rule-skipped',
      });
      continue;
    }
    if (!finding.pathRef || !finding.prescription || !domain) {
      outcomes.push({ findingId: finding.id, preview: null, reason: 'no-html' });
      continue;
    }

    // Prefer the snapshot's resolved final URL (post-redirect) so the render
    // hits the same origin the audit analyzed. The apex `domain` is the
    // fallback. Rendering the apex of a site that redirects (e.g. apex → www)
    // serves the injected HTML under the wrong origin and its relative assets
    // 404, producing a blank frame (QA: cohor7.com).
    const [resolvedUrl, design, ctaVocabulary] = await Promise.all([
      lookupRenderUrl(args.organizationId, args.siteId, finding.pathRef),
      lookupDesign(args.organizationId, args.siteId, finding.pathRef),
      lookupCtaVocabulary(args.siteId, finding.pathRef),
    ]);
    const originUrl = resolvedUrl ?? `${scheme}://${domain}${finding.pathRef}`;

    const outcome = await runOneFinding(
      {
        finding,
        originUrl,
        designTokens: design?.designTokens ?? null,
        cssSystem: design?.cssSystem ?? null,
        ctaVocabulary,
        siteContext: args.siteContext ?? null,
      },
      { suggest, renderBA, renderBO, inpaint, assessQuality },
    );
    outcomes.push(outcome);

    if (outcome.preview) {
      await persist(args.organizationId, outcome.preview);
    }
  }

  return outcomes;
}

async function defaultLookupDomain(
  organizationId: string,
  siteId: string,
): Promise<string | null> {
  const db = getDb();
  const siteRows = await db
    .select({ domain: phase1Sites.domain })
    .from(phase1Sites)
    .where(
      and(
        eq(phase1Sites.id, siteId),
        eq(phase1Sites.organizationId, organizationId),
      ),
    )
    .limit(1);
  return siteRows[0]?.domain ?? null;
}

async function defaultLookupDesign(
  organizationId: string,
  siteId: string,
  pathRef: string,
): Promise<{ designTokens: Record<string, unknown> | null; cssSystem: string | null } | null> {
  const row = await createDesignSnapshotRepository().findBySitePath(
    organizationId,
    siteId,
    pathRef,
  );
  if (!row) return null;
  return { designTokens: row.designTokens ?? null, cssSystem: row.cssSystem ?? null };
}

/**
 * The snapshot's stored final URL (post-redirect) for this pathRef — what the
 * audit actually fetched. Returns null on miss so the caller falls back to the
 * apex-domain URL.
 */
async function defaultLookupRenderUrl(
  organizationId: string,
  siteId: string,
  pathRef: string,
): Promise<string | null> {
  try {
    const db = getDb();
    const result = await db.execute<{ url: string }>(sql`
      SELECT url FROM phase2_page_snapshots
      WHERE organization_id = ${organizationId} AND site_id = ${siteId} AND path_ref = ${pathRef}
      LIMIT 1
    `);
    return result.rows[0]?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Pull the conversion-copy register from the page snapshot the structural
 * audit already wrote. Mirrors `collectBrandDna`'s filter in the run route:
 * drop nav/header landmark CTAs (they're IA labels, not conversion copy),
 * rank by visualWeight so the hero CTA beats footer links, dedupe, cap at
 * 10 entries. Returns `[]` on any failure — the advisor's COPY REGISTER
 * section degrades gracefully.
 */
async function defaultLookupCtaVocabulary(
  siteId: string,
  pathRef: string,
): Promise<string[]> {
  try {
    const db = getDb();
    const result = await db.execute<{ data: PageSnapshotData }>(sql`
      SELECT data FROM phase2_page_snapshots
      WHERE site_id = ${siteId} AND path_ref = ${pathRef}
      LIMIT 1
    `);
    const data = result.rows[0]?.data;
    if (!data) return [];
    const candidates = (data.ctas ?? [])
      .filter((c) => c.landmark !== 'nav' && c.landmark !== 'header')
      .slice()
      .sort((a, b) => (b.visualWeight ?? 0) - (a.visualWeight ?? 0));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const cta of candidates) {
      const t = (cta.text ?? '').trim();
      if (!t || t.length >= 40 || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
}

interface RunOneArgs {
  finding: FindingForFixPreview;
  originUrl: string;
  designTokens: Record<string, unknown> | null;
  cssSystem: string | null;
  ctaVocabulary: string[];
  siteContext?: SiteContext | null;
}

interface RunOneDeps {
  suggest: typeof defaultSuggestAuditFix;
  renderBA: typeof defaultRenderBeforeAfter;
  renderBO: typeof defaultRenderBeforeOnly;
  inpaint: typeof defaultInpaintFixAfter;
  assessQuality: typeof defaultAssessScreenshotQuality;
}

async function runOneFinding(
  args: RunOneArgs,
  deps: RunOneDeps,
): Promise<FixPreviewOutcome> {
  const prescription = args.finding.prescription;
  if (!prescription) {
    return { findingId: args.finding.id, preview: null, reason: 'no-html' };
  }

  // Render the BEFORE first. It serves three purposes:
  //   1. Vision channel for the Tier 1 advisor — the model can see the
  //      live page when picking selectors (the biggest lift to Tier 1's
  //      hit rate on hash-class CSS frameworks).
  //   2. Tier 2 inpaint input if Tier 1 declines (vision inpaint edits
  //      this exact image).
  //   3. Tier 3 fallback screenshot if Tier 2 also declines.
  // We also keep the fetched HTML so Tier 1's after render can skip a
  // second SSRF fetch.
  const beforeOnly = await deps.renderBO({
    findingId: args.finding.id,
    originUrl: args.originUrl,
  });
  if (!beforeOnly) {
    return { findingId: args.finding.id, preview: null, reason: 'no-html' };
  }

  // Quality gate — the before screenshot is the root of all three tiers
  // (advisor vision channel, inpaint input, tier-3 fallback). When it comes
  // back login-gated, blank, mid-load, or with a broken layout, every tier
  // inherits the defect, so we bail before spending advisor + inpaint calls
  // and ship the finding card without any screenshot row. `isLikelyBlankFrame`
  // already caught the all-white case in the renderer; this catches the
  // visually-busy-but-unusable cases (login walls, half-rendered nav) a pixel
  // ratio can't. Fail-soft: a model failure returns render:true.
  const verdict = await deps.assessQuality({
    findingId: args.finding.id,
    buffer: beforeOnly.beforeBuffer,
  });
  if (!verdict.render) {
    return { findingId: args.finding.id, preview: null, reason: 'screenshot-unusable' };
  }

  // Tier 1 — ask the audit advisor for mods, with the before screenshot
  // as ground truth. The advisor sees what it's editing, which materially
  // lifts selector accuracy on real marketing sites.
  const suggestion = await deps.suggest({
    finding: {
      ruleId: args.finding.ruleId,
      title: args.finding.title,
      whatToChange: prescription.whatToChange,
      whyItWorks: prescription.whyItWorks,
      experimentVariantDescription: prescription.experimentVariantDescription,
    },
    designTokens: args.designTokens,
    cssSystem: args.cssSystem,
    availableSelectors: [],
    ctaVocabulary: args.ctaVocabulary,
    beforeScreenshotBase64: beforeOnly.beforeBuffer.toString('base64'),
    siteContext: args.siteContext ?? null,
  });

  if (suggestion && suggestion.modifications.length > 0) {
    const tier1 = await runTier1(
      {
        findingId: args.finding.id,
        originUrl: args.originUrl,
        modifications: suggestion.modifications,
        rationale: suggestion.rationale,
        prefetchedHtml: beforeOnly.fetchedHtml,
      },
      deps.renderBA,
    );
    if (tier1) {
      return { findingId: args.finding.id, preview: tier1, reason: 'ok' };
    }
  }

  // Tier 2 — inpaint. Re-use the before image already rendered above.
  const tier2 = await deps.inpaint({
    findingId: args.finding.id,
    beforeBuffer: beforeOnly.beforeBuffer,
    beforeUrl: beforeOnly.beforeUrl,
    finding: {
      ruleId: args.finding.ruleId,
      title: args.finding.title,
      whatToChange: prescription.whatToChange,
      whyItWorks: prescription.whyItWorks,
    },
    designTokens: args.designTokens,
  });
  if (tier2) {
    return {
      findingId: args.finding.id,
      preview: {
        findingId: args.finding.id,
        tier: 2,
        beforeUrl: tier2.beforeUrl,
        afterUrl: tier2.afterUrl,
        modifications: null,
        rationale: tier2.rationale,
        generatedAt: new Date(),
      },
      reason: 'ok',
    };
  }

  // Tier 2 inpaint failed; surface the before-only URL as a tier-3 result.
  // The caller renders it as the legacy annotated-before screenshot.
  return {
    findingId: args.finding.id,
    preview: {
      findingId: args.finding.id,
      tier: 3,
      beforeUrl: beforeOnly.beforeUrl,
      afterUrl: null,
      modifications: null,
      rationale: null,
      generatedAt: new Date(),
    },
    reason: 'inpaint-failed',
  };
}

interface Tier1Args {
  findingId: string;
  originUrl: string;
  modifications: VariantModification[];
  rationale: string | null;
  prefetchedHtml: string;
}

async function runTier1(
  args: Tier1Args,
  render: typeof defaultRenderBeforeAfter,
): Promise<FixPreview | null> {
  const pair = await render({
    findingId: args.findingId,
    originUrl: args.originUrl,
    modifications: args.modifications,
    prefetchedHtml: args.prefetchedHtml,
  });
  if (!pair) return null;
  return {
    findingId: args.findingId,
    tier: 1,
    beforeUrl: pair.beforeUrl,
    afterUrl: pair.afterUrl,
    modifications: args.modifications,
    rationale: args.rationale,
    generatedAt: new Date(),
  };
}

async function persistFixPreview(
  organizationId: string,
  preview: FixPreview,
): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(zybitFindings)
      .set({
        screenshotBeforeUrl: preview.beforeUrl,
        screenshotAfterUrl: preview.afterUrl,
        fixPreviewTier: preview.tier,
        fixRationale: preview.rationale,
        fixModifications: preview.modifications ?? null,
        fixPreviewGeneratedAt: preview.generatedAt,
        updatedAt: preview.generatedAt,
      })
      .where(
        and(
          eq(zybitFindings.id, preview.findingId),
          eq(zybitFindings.organizationId, organizationId),
        ),
      );
  } catch (err) {
    // Persistence failure is non-fatal — the URLs are still in the
    // returned outcome and the caller can inline them on
    // `public_audits.findings` without the canonical zybitFindings row.
    console.warn('[generateFixPreviews] persist failed', {
      findingId: preview.findingId,
      error: String(err),
    });
  }
}

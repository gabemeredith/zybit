/**
 * Full-LLM-depth extras for the URL-audit runner.
 *
 * `runUrlAudit` already exercises the capture-time LLM surface (vision + copy
 * critique via `visionPagesLimit`, and Layer B prose). These two helpers add
 * the remaining surfaces so a single Lighthouse run QAs the whole LLM PR
 * against a real owned site:
 *
 *   - runFixPreviews    → the before/after fix-preview pipeline (Tier 1 advisor
 *                          + Browserless render, Tier 2 inpaint), gated on
 *                          AUDIT_FIX_PREVIEW_ENABLED inside the orchestrator.
 *   - runVariantAdvisor → the AI Variant Advisor (`aiAdvisor.ts`), the same
 *                          call the /api/dashboard/experiments/ai-suggest route
 *                          makes — minus the per-org daily rate limit, which is
 *                          a prod cost control we don't want polluting a real
 *                          org's quota during QA.
 *
 * Both are fail-soft: any error is captured into the returned summary (and the
 * underlying calls log to console, so the Lighthouse log panel shows exactly
 * why a surface produced nothing — a missing key, an upstream error, etc.).
 */

import type { createPhase1Repository } from '@/lib/phase1';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import { findingPk } from '@/lib/phase2/jobs/insightsTrigger';
import { generateFixPreviews } from '@/lib/audit/fixPreview/generateFixPreviews';
import type { FixPreviewOutcome } from '@/lib/audit/fixPreview/types';
import {
  buildPrompt,
  callAdvisorModel,
  MODEL_NAME,
  parseAndValidateResponse,
  type AdvisorDesignContext,
  type AdvisorOption,
} from '@/lib/experiments/aiAdvisor';
import { logAiAdvisorUsage } from '@/lib/experiments/aiAdvisorRateLimit';
import type { SiteContext } from '@/lib/phase2/siteContext';

type Phase1Repository = ReturnType<typeof createPhase1Repository>;

export interface FixPreviewSummary {
  findingId: string;
  ruleId: string;
  pathRef: string | null;
  reason: FixPreviewOutcome['reason'];
  tier: number | null;
  beforeUrl: string | null;
  afterUrl: string | null;
  rationale: string | null;
}

export interface VariantProposalSummary {
  findingId: string;
  ruleId: string;
  pathRef: string;
  options: AdvisorOption[];
  droppedCount: number;
  note: string | null;
  /** Set when the advisor could not run for this finding (no key, no snapshot…). */
  error?: string;
}

/**
 * Run the before/after fix-preview pipeline over the top findings. The
 * orchestrator self-gates on AUDIT_FIX_PREVIEW_ENABLED (returns tier-3
 * fallbacks when off) and persists previews onto the finding rows itself.
 */
export async function runFixPreviews(args: {
  organizationId: string;
  siteId: string;
  auditUrl: string;
  findings: AuditFinding[];
  maxFindings?: number;
  siteContext?: SiteContext | null;
}): Promise<FixPreviewSummary[]> {
  const cap = args.maxFindings ?? 3;
  const targets = args.findings.slice(0, cap);
  if (targets.length === 0) return [];

  const idFor = (f: AuditFinding) => findingPk(args.siteId, f.ruleId, f.pathRef);
  const byId = new Map(targets.map((f) => [idFor(f), f]));

  const outcomes = await generateFixPreviews({
    organizationId: args.organizationId,
    siteId: args.siteId,
    auditUrl: args.auditUrl,
    maxFindings: cap,
    siteContext: args.siteContext ?? null,
    findings: targets.map((f) => ({
      id: idFor(f),
      ruleId: f.ruleId,
      title: f.title,
      pathRef: f.pathRef,
      prescription: f.prescription
        ? {
            whyItMatters: f.prescription.whyItMatters,
            whatToChange: f.prescription.whatToChange,
            whyItWorks: f.prescription.whyItWorks,
            experimentVariantDescription: f.prescription.experimentVariantDescription,
          }
        : null,
    })),
  });

  return outcomes.map((o) => {
    const f = byId.get(o.findingId);
    return {
      findingId: o.findingId,
      ruleId: f?.ruleId ?? '?',
      pathRef: f?.pathRef ?? null,
      reason: o.reason,
      tier: o.preview?.tier ?? null,
      beforeUrl: o.preview?.beforeUrl ?? null,
      afterUrl: o.preview?.afterUrl ?? null,
      rationale: o.preview?.rationale ?? null,
    };
  });
}

/** CTA + form + heading selectors the advisor may target (mirrors the route). */
function collectAllowedSelectors(data: PageSnapshotData): string[] {
  const out = new Set<string>();
  for (const cta of data.ctas ?? []) if (cta.cssSelector) out.add(cta.cssSelector);
  for (const form of data.forms ?? []) if (form.cssSelector) out.add(form.cssSelector);
  for (const heading of data.headings ?? []) if (heading.cssSelector) out.add(heading.cssSelector);
  return [...out];
}

/**
 * Run the AI Variant Advisor over the top findings. Mirrors the dashboard
 * route's assembly (snapshot selectors + CTA vocabulary + design context →
 * prompt → model → validate) but skips the per-org rate limit.
 */
export async function runVariantAdvisor(args: {
  organizationId: string;
  siteId: string;
  findings: AuditFinding[];
  repository: Phase1Repository;
  maxFindings?: number;
  siteContext?: SiteContext | null;
}): Promise<VariantProposalSummary[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const cap = args.maxFindings ?? 2;
  const targets = args.findings.filter((f) => f.pathRef && f.prescription).slice(0, cap);
  const designRepo = createDesignSnapshotRepository();
  const out: VariantProposalSummary[] = [];

  for (const f of targets) {
    const pathRef = f.pathRef as string;
    const base = { findingId: findingPk(args.siteId, f.ruleId, pathRef), ruleId: f.ruleId, pathRef };
    if (!apiKey) {
      out.push({ ...base, options: [], droppedCount: 0, note: null, error: 'OPENAI_API_KEY not set' });
      continue;
    }
    try {
      const snapshot = await args.repository.getPageSnapshot({
        organizationId: args.organizationId,
        siteId: args.siteId,
        pathRef,
      });
      if (!snapshot) {
        out.push({ ...base, options: [], droppedCount: 0, note: null, error: 'no snapshot' });
        continue;
      }
      const data = snapshot.data as PageSnapshotData;
      const availableSelectors = collectAllowedSelectors(data);
      if (availableSelectors.length === 0) {
        out.push({ ...base, options: [], droppedCount: 0, note: null, error: 'no usable selectors' });
        continue;
      }
      const ctaVocabulary = (data.ctas ?? [])
        .filter((c) => c.landmark !== 'nav' && c.landmark !== 'header')
        .map((c) => c.text?.trim())
        .filter((t): t is string => !!t && t.length > 0)
        .slice(0, 20);

      const design = await designRepo.findBySitePath(args.organizationId, args.siteId, pathRef);
      const designContext: AdvisorDesignContext = {
        captureMethod: design?.captureMethod ?? 'structural',
        designTokens: design?.designTokens ?? null,
        computedStyles: design?.computedStyles ?? null,
        cssSystem: design?.cssSystem ?? data.cssSystem ?? null,
        screenshotUrl: design?.screenshotUrl ?? null,
      };

      const prompt = buildPrompt({
        finding: {
          ruleId: f.ruleId,
          prescription: {
            whatToChange: f.prescription!.whatToChange,
            whyItWorks: f.prescription!.whyItWorks,
            experimentVariantDescription: f.prescription!.experimentVariantDescription,
          },
        },
        design: designContext,
        snapshot: { availableSelectors, ctaVocabulary },
        siteContext: args.siteContext ?? null,
      });

      const t0 = Date.now();
      const modelResult = await callAdvisorModel({ prompt, apiKey });
      const result = parseAndValidateResponse({
        raw: modelResult.text,
        availableSelectors,
        captureMethod: designContext.captureMethod,
      });
      logAiAdvisorUsage({
        organizationId: args.organizationId,
        findingId: base.findingId,
        model: MODEL_NAME,
        promptTokens: modelResult.promptTokens,
        responseTokens: modelResult.responseTokens,
        durationMs: Date.now() - t0,
        outcome: result.options.length > 0 ? 'ok' : 'invalid_response',
      });
      out.push({ ...base, options: result.options, droppedCount: result.droppedCount, note: result.note ?? null });
    } catch (err) {
      out.push({
        ...base,
        options: [],
        droppedCount: 0,
        note: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Zybit-144 — AI Variant Advisor.
 *
 * POST /api/dashboard/experiments/ai-suggest
 * Body: { findingId: string }
 *
 * Loads the finding + structural snapshot + design snapshot, calls Gemini
 * with the locked prompt (`aiAdvisor.ts`), validates response against the
 * `VariantModification` schema + selector allowlist, returns 3 options or
 * fewer with a `note` explaining the gap.
 *
 * Gated by `checkAndIncrementAiUsage` (Zybit-148). Token usage logged to
 * the structured logger under `service: 'ai-advisor'`.
 *
 * Missing GEMINI_API_KEY → 503 (route is non-essential; PMs build manually).
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  badRequest,
  mapRouteError,
  parseJsonObject,
  parseString,
  success,
} from '@/app/api/phase1/_shared';
import { resolveZybitActor } from '@/lib/auth/actor';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { createPhase1Repository } from '@/lib/phase1';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import {
  AI_DAILY_LIMIT,
  checkAndIncrementAiUsage,
  logAiAdvisorUsage,
} from '@/lib/experiments/aiAdvisorRateLimit';
import {
  buildPrompt,
  callGeminiFlash,
  MODEL_NAME,
  parseAndValidateResponse,
  type AdvisorDesignContext,
} from '@/lib/experiments/aiAdvisor';

export async function POST(request: Request) {
  try {
    const parsed = await parseJsonObject(request);
    if (!parsed.ok) return badRequest(parsed.message);

    const findingId = parseString(parsed.value.findingId);
    if (!findingId) return badRequest('`findingId` is required.');

    const actorResult = await resolveZybitActor(request, {
      bodyOrganizationId: parsed.value.organizationId,
    });
    if (!actorResult.ok) return actorResult.response;
    const organizationId = actorResult.actor.organizationId;

    // 1. Load the finding, org-scoped.
    const db = getDb();
    const findingRows = await db
      .select()
      .from(zybitFindings)
      .where(and(eq(zybitFindings.id, findingId), eq(zybitFindings.organizationId, organizationId)))
      .limit(1);
    const finding = findingRows[0];
    if (!finding) return badRequest('Finding not found.', 'NOT_FOUND');
    if (!finding.prescription) {
      return badRequest('Finding has no prescription — nothing to draft from.', 'NO_PRESCRIPTION');
    }
    if (!finding.pathRef) {
      return badRequest(
        'Finding is site-wide — AI suggestions require a specific page.',
        'NO_PATH_REF',
      );
    }

    // 2. Load the structural snapshot for selectors + CTA vocabulary.
    const repository = createPhase1Repository();
    const snapshot = await repository.getPageSnapshot({
      organizationId,
      siteId: finding.siteId,
      pathRef: finding.pathRef,
    });
    if (!snapshot) {
      return badRequest('No snapshot for this page — cannot ground suggestions.', 'NO_SNAPSHOT');
    }
    const snapshotData = snapshot.data as PageSnapshotData;
    const availableSelectors = collectAllowedSelectors(snapshotData);
    if (availableSelectors.length === 0) {
      return badRequest(
        'Snapshot has no usable selectors — AI cannot ground suggestions.',
        'NO_SELECTORS',
      );
    }
    // Exclude nav/header items so the AI's "copy register" reflects what the
    // page actually sells with (Start now / Get started / Book a demo) rather
    // than the IA labels (Products / Pricing / Solutions). Same shape as the
    // audit-funnel filter in `/api/audit/public/run` so the two surfaces agree.
    const ctaVocabulary = (snapshotData.ctas ?? [])
      .filter((c) => c.landmark !== 'nav' && c.landmark !== 'header')
      .map((c) => c.text?.trim())
      .filter((t): t is string => !!t && t.length > 0)
      .slice(0, 20);

    // 3. Load the design snapshot — captureMethod drives confidence.
    const designRepo = createDesignSnapshotRepository();
    const design = await designRepo.findBySitePath(organizationId, finding.siteId, finding.pathRef);
    const designContext: AdvisorDesignContext = {
      captureMethod: design?.captureMethod ?? 'structural',
      designTokens: design?.designTokens ?? null,
      computedStyles: design?.computedStyles ?? null,
      cssSystem: design?.cssSystem ?? snapshotData.cssSystem ?? null,
      screenshotUrl: design?.screenshotUrl ?? null,
    };

    // 4. API key check (cheap, before rate limit so a missing key doesn't
    // burn budget).
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'AI suggestions are unavailable — server is not configured.',
          code: 'AI_UNAVAILABLE',
        },
        { status: 503 },
      );
    }

    // 5. Rate limit.
    const rl = await checkAndIncrementAiUsage(organizationId);
    if (!rl.allowed) {
      logAiAdvisorUsage({
        organizationId,
        findingId,
        model: MODEL_NAME,
        promptTokens: 0,
        responseTokens: 0,
        durationMs: 0,
        outcome: 'rate_limited',
      });
      return NextResponse.json(
        {
          ok: false,
          error: `AI suggestion limit reached for today (${AI_DAILY_LIMIT}/day). Build manually or try again tomorrow.`,
          code: 'RATE_LIMITED',
        },
        { status: 429 },
      );
    }

    // 6. Build prompt + call Gemini.
    const prompt = buildPrompt({
      finding: {
        ruleId: finding.ruleId,
        prescription: finding.prescription,
      },
      design: designContext,
      snapshot: { availableSelectors, ctaVocabulary },
    });

    const t0 = Date.now();
    let geminiResult: Awaited<ReturnType<typeof callGeminiFlash>>;
    try {
      geminiResult = await callGeminiFlash({ prompt, apiKey });
    } catch (err) {
      logAiAdvisorUsage({
        organizationId,
        findingId,
        model: MODEL_NAME,
        promptTokens: null,
        responseTokens: null,
        durationMs: Date.now() - t0,
        outcome: 'upstream_error',
      });
      const message = err instanceof Error ? err.message : 'AI service error';
      return NextResponse.json(
        { ok: false, error: message, code: 'AI_UPSTREAM_ERROR' },
        { status: 502 },
      );
    }
    const durationMs = Date.now() - t0;

    // 7. Parse + validate.
    const result = parseAndValidateResponse({
      raw: geminiResult.text,
      availableSelectors,
      captureMethod: designContext.captureMethod,
    });

    logAiAdvisorUsage({
      organizationId,
      findingId,
      model: MODEL_NAME,
      promptTokens: geminiResult.promptTokens,
      responseTokens: geminiResult.responseTokens,
      durationMs,
      outcome: result.options.length > 0 ? 'ok' : 'invalid_response',
    });

    return success({
      options: result.options,
      droppedCount: result.droppedCount,
      note: result.note ?? null,
      captureMethod: designContext.captureMethod,
      usage: {
        usedToday: rl.usedToday,
        remaining: rl.remaining,
        limit: AI_DAILY_LIMIT,
      },
    });
  } catch (error) {
    return mapRouteError(error);
  }
}

/**
 * Selectors the AI may target: CTA + form + heading `cssSelector` values
 * that are present and non-empty. Headings carry selectors as of the
 * structural-snapshot upgrade that paired with PR #84's advisor expansion —
 * needed for insert-shaped findings (return-visit-thrash, help-seeking-spike,
 * hesitation-pattern) whose prescription anchors a new block above a heading.
 * Without heading selectors the advisor would have to paraphrase those into
 * text-replace on the nearest CTA, which doesn't implement the prescription.
 */
function collectAllowedSelectors(data: PageSnapshotData): string[] {
  const out = new Set<string>();
  for (const cta of data.ctas ?? []) {
    if (cta.cssSelector && cta.cssSelector.length > 0) out.add(cta.cssSelector);
  }
  for (const form of data.forms ?? []) {
    if (form.cssSelector && form.cssSelector.length > 0) out.add(form.cssSelector);
  }
  for (const heading of data.headings ?? []) {
    if (heading.cssSelector && heading.cssSelector.length > 0) out.add(heading.cssSelector);
  }
  return [...out];
}

/**
 * Structured copy critique — Ring 3 / Layer F capture module (handover §12.C).
 *
 * Once `captureVisualSignals` extracts the page's hero copy verbatim, this
 * module makes a single Gemini 2.5 Flash call per page to produce a
 * structured critique of that copy. The output feeds three deterministic
 * Layer F rules:
 *   - `vague-claim-detected` — fires when `specificity < 0.4`
 *   - `proof-missing`        — fires on landing/home/pricing with zero
 *                              proof signals identified
 *   - `cta-verb-mismatch`    — fires when the CTA verb does not align
 *                              with the page type
 *
 * Trust model mirrors `captureVisualSignals` exactly:
 *   - Structured-output mode + strict schema validation.
 *   - Validator rejects malformed / mistyped fields.
 *   - Fail-soft: any error returns `null` and downstream rules degrade
 *     gracefully (they emit nothing rather than fire on bad data).
 *   - Capture-time, cached on `snapshot.data.copyCritique`. The rules
 *     themselves are pure deterministic functions over that cached
 *     structure — no per-rule LLM calls.
 *
 * Why one call instead of three: a single page already supplies all the
 * input (hero block + CTA inventory + page type). Combining the three
 * critiques into one prompt is ~3× cheaper, with no loss of quality
 * (the underlying model already reads everything it needs to score each
 * dimension). See `aiAdvisor.ts` for the same one-call multi-output
 * pattern in the advisor surface.
 *
 * Cost envelope: ~$0.001/page × `visionPagesLimit` (3 by default in the
 * public-audit funnel). Identical to the vision-pass budget — the same
 * pages get vision + copy critique.
 */

import type { PageType, VisualHeroBlock } from '@/lib/phase2/snapshots/types';
import { OPENAI_CHAT_ENDPOINT, OPENAI_FAST_MODEL, extractChatText } from '@/lib/ai/openai';

export const COPY_CRITIQUE_MODEL = OPENAI_FAST_MODEL;

export interface CopyCritique {
  /**
   * 0..1 measure of how specific the hero claim is. < 0.4 means the
   * claim is vague enough that a visitor cannot tell what the product
   * does. Examples: "Empower your team" → low. "Cut SOC2 audits from
   * 80 hours to 6 hours" → high.
   */
  specificity: number;
  /**
   * Vague phrases the model identified in the hero copy. Each entry is
   * a verbatim substring from the hero block. Empty when specificity is
   * already high.
   */
  vagueTerms: string[];
  /**
   * Suggested rewrites for the vague claims — 0 to 3 strings. PMs choose
   * which (if any) to test. Empty when there's no vagueness to fix.
   */
  suggestedRewrites: string[];
  /**
   * Proof signals the model detected in the hero + supporting paragraphs.
   * Examples: 'customer logo', 'specific metric', 'security badge',
   * 'named testimonial', 'press mention'. An empty array on a
   * home/landing/pricing page is what fires `proof-missing`.
   */
  proofSignals: string[];
  /**
   * Whether the primary CTA verb aligns with the page type. A "Book a
   * demo" CTA on a docs page is mismatched; a "Get started" CTA on a
   * pricing page is aligned. `null` when no CTA was observed.
   */
  ctaAlignment: {
    matches: boolean;
    /** Verbs the model thinks would fit better, ranked. */
    suggestedVerbs: string[];
  } | null;
  /** ISO timestamp of when the critique was captured. */
  capturedAt: string;
  /** Model + endpoint version that produced the signal. */
  modelVersion: string;
}

export interface CaptureCopyCritiqueArgs {
  url: string;
  /** Hero block extracted by `captureVisualSignals`. Required. */
  heroBlock: VisualHeroBlock;
  /** Best-guess primary CTA label. Used to score `ctaAlignment`. */
  primaryCtaText: string | null;
  /** Page type from the vision pass. Used to score `ctaAlignment`. */
  pageType: PageType;
}

export interface CaptureCopyCritiqueDeps {
  fetch?: typeof fetch;
  apiKey?: string | null;
  now?: () => Date;
}

const COPY_CRITIQUE_PROMPT = `You are a B2B SaaS landing-page reviewer. You will receive a page's hero block, primary CTA, and a page-type label. Return ONLY JSON matching this schema, no prose, no markdown:
{
  "specificity": number,
  "vagueTerms": string[],
  "suggestedRewrites": string[],
  "proofSignals": string[],
  "ctaAlignment": { "matches": boolean, "suggestedVerbs": string[] } | null
}

Rules:
- "specificity": 0..1 — how specific is the hero claim? 0.0 = "Empower your team" / "Build better products" (no signal what it does). 1.0 = "Cut SOC2 audits from 80 hours to 6 hours" (specific outcome, specific metric). 0.4 is the threshold a reviewer expects from any landing page.
- "vagueTerms": verbatim substrings from the hero (headline + subheadline + firstParagraph) that contribute to low specificity. Empty when specificity >= 0.4.
- "suggestedRewrites": up to 3 concrete rewrites that would specify what the product does, in the same register as the original copy. Each must be a complete, ready-to-paste alternative — not a description of what to change.
- "proofSignals": each entry is one observed signal: "named customer logo", "specific metric", "press mention", "security badge", "named testimonial", "ratings/review score", "team credentials". Only entries the hero copy explicitly contains.
- "ctaAlignment": if a "Primary CTA" line is provided, score whether its verb fits the page type. Returns null when no CTA was provided. "matches: true" when the verb is appropriate for the page type (e.g. "Get started" / "Start free trial" on a pricing or signup page; "Read more" / "View docs" on a docs page; "Contact us" on a support page). "suggestedVerbs": up to 3 better verb alternatives, with the CTA's noun preserved when possible.
- All strings must be plain text — no markdown, no quotes, no HTML.
- Never invent text not present in the input. If the hero block is empty (all fields null), return specificity 0, empty arrays, ctaAlignment null.`;

/**
 * Capture structured copy critique for one page. Returns `null` when:
 *   - `OPENAI_API_KEY` is not set.
 *   - `heroBlock` has no readable text (headline/subheadline/firstParagraph all null).
 *   - The Gemini call fails (network, rate limit, model error).
 *   - The model output cannot be parsed as valid JSON.
 *   - The parsed JSON does not match the schema.
 *
 * Never throws. Callers must `?? undefined` the result when writing to
 * the snapshot row.
 */
export async function captureCopyCritique(
  args: CaptureCopyCritiqueArgs,
  deps: CaptureCopyCritiqueDeps = {},
): Promise<CopyCritique | null> {
  const fetchImpl = deps.fetch ?? fetch;
  // Treat `null` as "explicitly disabled" (tests use this to assert the
  // no-key short-circuit). Only fall through to `process.env` when the
  // caller did not pass the field at all (`undefined`). This is the same
  // semantic as a normal feature-flag override.
  const apiKey =
    deps.apiKey === undefined ? process.env.OPENAI_API_KEY ?? null : deps.apiKey;
  const now = deps.now ?? (() => new Date());

  if (!apiKey) return null;

  // Skip the LLM call when there's nothing to critique. A page that the
  // vision pass couldn't see (firstParagraph null + subheadline null +
  // headline null) has no hero copy — emitting `vague-claim-detected`
  // on an empty hero would be a finding about a captured artifact, not
  // about the page.
  const hasAnyHero =
    !!(args.heroBlock.headline?.trim() ||
       args.heroBlock.subheadline?.trim() ||
       args.heroBlock.firstParagraph?.trim());
  if (!hasAnyHero) return null;

  const promptInput = buildPromptInput(args);

  let resp: Response;
  try {
    resp = await fetchImpl(OPENAI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: COPY_CRITIQUE_MODEL,
        messages: [{ role: 'user', content: COPY_CRITIQUE_PROMPT + '\n\n' + promptInput }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.warn('[captureCopyCritique] fetch failed', {
      url: args.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!resp.ok) {
    console.warn('[captureCopyCritique] OpenAI API error', {
      url: args.url,
      status: resp.status,
    });
    return null;
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return null;
  }

  const rawText = extractChatText(body);
  if (!rawText) return null;

  const parsed = safeJsonParse(rawText);
  if (!parsed) return null;

  const validated = validateCopyCritique(parsed);
  if (!validated) return null;

  return {
    ...validated,
    capturedAt: now().toISOString(),
    modelVersion: COPY_CRITIQUE_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests.
// ---------------------------------------------------------------------------

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Build the structured input section appended to the system prompt. */
export function buildPromptInput(args: CaptureCopyCritiqueArgs): string {
  const { heroBlock, primaryCtaText, pageType } = args;
  const lines: string[] = [];
  lines.push(`Page type: ${pageType}`);
  if (heroBlock.headline) lines.push(`Headline: ${heroBlock.headline}`);
  if (heroBlock.subheadline) lines.push(`Subheadline: ${heroBlock.subheadline}`);
  if (heroBlock.firstParagraph) lines.push(`First paragraph: ${heroBlock.firstParagraph}`);
  if (primaryCtaText) lines.push(`Primary CTA: ${primaryCtaText}`);
  else lines.push('Primary CTA: (none observed)');
  return lines.join('\n');
}

type ValidatedCritique = Omit<CopyCritique, 'capturedAt' | 'modelVersion'>;

/**
 * Validate the model's JSON output against the `CopyCritique` schema.
 * Returns the validated object stripped of unknown fields, or `null`
 * when validation fails. Exported for tests.
 */
export function validateCopyCritique(raw: unknown): ValidatedCritique | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const specificity = numberInUnit(r.specificity);
  if (specificity === null) return null;

  const vagueTerms = validateStringArray(r.vagueTerms, { maxLen: 200, maxCount: 10 });
  if (vagueTerms === null) return null;

  const suggestedRewrites = validateStringArray(r.suggestedRewrites, { maxLen: 500, maxCount: 5 });
  if (suggestedRewrites === null) return null;

  const proofSignals = validateStringArray(r.proofSignals, { maxLen: 200, maxCount: 12 });
  if (proofSignals === null) return null;

  const ctaAlignment = validateCtaAlignment(r.ctaAlignment);
  if (ctaAlignment === undefined) return null;

  return {
    specificity,
    vagueTerms,
    suggestedRewrites,
    proofSignals,
    ctaAlignment,
  };
}

function validateStringArray(
  raw: unknown,
  bounds: { maxLen: number; maxCount: number },
): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > bounds.maxCount) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > bounds.maxLen) return null;
    out.push(trimmed);
  }
  return out;
}

function validateCtaAlignment(
  raw: unknown,
): CopyCritique['ctaAlignment'] | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.matches !== 'boolean') return undefined;
  const suggestedVerbs = validateStringArray(r.suggestedVerbs, { maxLen: 100, maxCount: 5 });
  if (suggestedVerbs === null) return undefined;
  return { matches: r.matches, suggestedVerbs };
}

function numberInUnit(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < -0.05 || raw > 1.05) return null;
  return Math.max(0, Math.min(1, raw));
}

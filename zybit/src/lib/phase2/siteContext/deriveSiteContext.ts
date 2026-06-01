/**
 * Derive SiteContext for an audited site — deterministic priors enriched by one
 * cheap LLM call, fail-soft to the priors, fail-soft to `null`.
 *
 * Flow:
 *   1. `deriveIndustry()` (pure, no network) gives a coarse industry prior.
 *   2. One `OPENAI_FAST_MODEL` call refines industry + infers businessModel /
 *      conversionGoal / audience / brandVoice from page signals, anchored on the
 *      prior. Structured output + strict validator.
 *   3. Declared onboarding values (industry / conversionGoal) override inferred.
 *   4. If the LLM is unavailable or fails, we keep the heuristic industry (still
 *      enough to specialise the copy-critique persona). If even that is empty and
 *      nothing was declared, return `null` so the caller uses today's baseline.
 *
 * The caller is responsible for the flag gate (`isSiteContextEnabled`) — this
 * function is pure-ish and always safe to call.
 */

import {
  OPENAI_FAST_MODEL,
  callOpenAIChat,
  resolveOpenAIKey,
  type OpenAIFetcher,
} from '@/lib/ai/openai';
import { deriveIndustry } from '@/lib/audit/deriveIndustry';
import type {
  BusinessModel,
  ConversionGoal,
  SiteContext,
  SiteIndustry,
} from './types';

export const SITE_CONTEXT_MODEL = OPENAI_FAST_MODEL;

const INDUSTRIES: SiteIndustry[] = ['saas', 'ecommerce', 'fintech', 'healthtech', 'media', 'other'];
const BUSINESS_MODELS: BusinessModel[] = [
  'subscription',
  'transactional',
  'lead-gen',
  'marketplace',
  'advertising',
  'unknown',
];
const CONVERSION_GOALS: ConversionGoal[] = [
  'start-free-trial',
  'book-demo',
  'contact-sales',
  'purchase',
  'create-account',
  'subscribe',
  'request-quote',
  'download',
  'unknown',
];

const TEXT_MAX = 80;

export interface SiteContextSignals {
  title?: string | null;
  description?: string | null;
  headings?: string[];
  heroHeadline?: string | null;
  heroSubheadline?: string | null;
  ctaVocabulary?: string[];
}

export interface DeriveSiteContextInput {
  url: string;
  /** Declared onboarding values — always take precedence over inference. */
  declared?: { industry?: string | null; conversionGoal?: string | null } | null;
  signals: SiteContextSignals;
}

export interface DeriveSiteContextDeps {
  fetcher?: OpenAIFetcher;
  /** `null` disables the LLM path (heuristic-only); `undefined` reads env. */
  apiKey?: string | null;
  now?: () => Date;
  model?: string;
}

/**
 * Returns a SiteContext, or `null` when there is genuinely nothing to say
 * (no heuristic industry, no LLM result, no declared values). Never throws.
 */
export async function deriveSiteContext(
  input: DeriveSiteContextInput,
  deps: DeriveSiteContextDeps = {},
): Promise<SiteContext | null> {
  const now = deps.now ?? (() => new Date());
  const apiKey = resolveOpenAIKey(deps.apiKey);

  // 1. Deterministic prior.
  const heuristicIndustry = deriveIndustry(input.url, {
    title: input.signals.title ?? null,
    description: input.signals.description ?? null,
    headings: input.signals.headings ?? [],
  });

  // Declared values (normalised to our enums where possible).
  const declaredIndustry = coerceIndustry(input.declared?.industry) ?? null;
  const declaredGoal = coerceGoal(input.declared?.conversionGoal) ?? null;

  // 2. LLM enrichment (fail-soft).
  const llm = apiKey
    ? await callModel(input, heuristicIndustry, apiKey, deps).catch(() => null)
    : null;

  // 3. Merge. Declared > LLM > heuristic.
  const industry: SiteIndustry =
    declaredIndustry ?? llm?.industry ?? heuristicIndustry ?? 'other';
  const conversionGoal: ConversionGoal = declaredGoal ?? llm?.conversionGoal ?? 'unknown';
  const businessModel: BusinessModel = llm?.businessModel ?? 'unknown';
  const audience = llm?.audience ?? null;
  const brandVoice = llm?.brandVoice ?? null;

  const hasDeclared = !!(declaredIndustry || declaredGoal);
  const hasInferred = !!llm || heuristicIndustry !== null;

  // Nothing useful to add over baseline.
  if (!hasDeclared && !hasInferred) return null;
  if (
    !hasDeclared &&
    !llm &&
    heuristicIndustry === null
  ) {
    return null;
  }

  const source: SiteContext['source'] = hasDeclared
    ? llm
      ? 'hybrid'
      : 'declared'
    : 'inferred';

  // Confidence: declared is certain; LLM reports its own; heuristic-only is low.
  const confidence = hasDeclared
    ? llm
      ? Math.max(0.7, llm.confidence)
      : 1
    : llm
      ? llm.confidence
      : 0.3;

  return {
    industry,
    businessModel,
    conversionGoal,
    audience,
    brandVoice,
    source,
    confidence,
    capturedAt: now().toISOString(),
    modelVersion: llm ? deps.model ?? SITE_CONTEXT_MODEL : 'heuristic',
  };
}

// ---------------------------------------------------------------------------
// LLM call + validation — exported pieces for tests.
// ---------------------------------------------------------------------------

interface LlmSiteContext {
  industry: SiteIndustry;
  businessModel: BusinessModel;
  conversionGoal: ConversionGoal;
  audience: string | null;
  brandVoice: string | null;
  confidence: number;
}

async function callModel(
  input: DeriveSiteContextInput,
  prior: SiteIndustry | null,
  apiKey: string,
  deps: DeriveSiteContextDeps,
): Promise<LlmSiteContext | null> {
  const prompt = buildSiteContextPrompt(input, prior);
  const { text } = await callOpenAIChat({
    prompt,
    apiKey,
    model: deps.model ?? SITE_CONTEXT_MODEL,
    json: true,
    maxTokens: 512,
    ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
  });
  return validateSiteContext(safeParse(text));
}

export function buildSiteContextPrompt(
  input: DeriveSiteContextInput,
  prior: SiteIndustry | null,
): string {
  const s = input.signals;
  const lines: string[] = [];
  if (s.title) lines.push(`Title: ${s.title}`);
  if (s.description) lines.push(`Meta description: ${s.description}`);
  if (s.heroHeadline) lines.push(`Hero headline: ${s.heroHeadline}`);
  if (s.heroSubheadline) lines.push(`Hero subheadline: ${s.heroSubheadline}`);
  if (s.headings?.length) lines.push(`Headings: ${s.headings.slice(0, 10).join(' | ')}`);
  if (s.ctaVocabulary?.length) lines.push(`CTA labels: ${s.ctaVocabulary.slice(0, 12).join(' | ')}`);

  return [
    'You are classifying a website for a conversion-optimization audit. From the',
    'signals below, infer the business context. Return ONLY JSON, no prose, no markdown:',
    '{',
    `  "industry": ${INDUSTRIES.map((i) => `"${i}"`).join(' | ')},`,
    `  "businessModel": ${BUSINESS_MODELS.map((b) => `"${b}"`).join(' | ')},`,
    `  "conversionGoal": ${CONVERSION_GOALS.map((g) => `"${g}"`).join(' | ')},`,
    '  "audience": string | null,',
    '  "brandVoice": string | null,',
    '  "confidence": number',
    '}',
    '',
    'Rules:',
    `- A heuristic pre-classified the industry as "${prior ?? 'unknown'}". Trust it unless the copy clearly contradicts it.`,
    '- "conversionGoal" is the SINGLE primary action this page is built to drive. Infer it from the CTA labels and page copy. Use "unknown" only when there is genuinely no signal.',
    '- "audience": the target customer in <= 8 words (e.g. "engineering teams at mid-market SaaS", "home cooks"). null when unclear. Never invent specifics.',
    '- "brandVoice": the tone in <= 6 words (e.g. "technical, precise, no-nonsense", "warm, playful, casual"). null when unclear.',
    '- "confidence": your 0..1 self-assessment of the inferred fields overall.',
    '- Pick the closest enum value. Use "other"/"unknown" rather than guessing wildly.',
    '',
    'SIGNALS:',
    lines.length ? lines.join('\n') : '(none — classify from the URL/industry prior only)',
  ].join('\n');
}

function safeParse(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Validate the model output. Unknown enum values coerce to the safe default
 * (`other` / `unknown`) rather than rejecting the whole object — one bad field
 * shouldn't throw away usable inference. Returns `null` only when the payload is
 * not an object or confidence is missing/out of range.
 */
export function validateSiteContext(raw: unknown): LlmSiteContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const confidence = numberInUnit(r.confidence);
  if (confidence === null) return null;

  return {
    industry: coerceIndustry(r.industry) ?? 'other',
    businessModel: coerceBusinessModel(r.businessModel) ?? 'unknown',
    conversionGoal: coerceGoal(r.conversionGoal) ?? 'unknown',
    audience: cleanText(r.audience),
    brandVoice: cleanText(r.brandVoice),
    confidence,
  };
}

function coerceIndustry(raw: unknown): SiteIndustry | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return (INDUSTRIES as string[]).includes(v) ? (v as SiteIndustry) : null;
}

function coerceBusinessModel(raw: unknown): BusinessModel | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return (BUSINESS_MODELS as string[]).includes(v) ? (v as BusinessModel) : null;
}

function coerceGoal(raw: unknown): ConversionGoal | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return (CONVERSION_GOALS as string[]).includes(v) ? (v as ConversionGoal) : null;
}

function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length === 0 || t.toLowerCase() === 'null') return null;
  return t.slice(0, TEXT_MAX);
}

function numberInUnit(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < -0.05 || raw > 1.05) return null;
  return Math.max(0, Math.min(1, raw));
}

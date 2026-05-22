/**
 * Zybit-144 — Pure prompt builder, response parser, and Gemini client for
 * the AI Variant Advisor.
 *
 * Doctrine:
 *   - The AI proposes; the PM approves. This module never persists, never
 *     launches; it returns options the route hands to the UI.
 *   - The AI is constrained to `VariantModification[]` instances with
 *     selectors that exist in the snapshot's allowlist. Anything else is
 *     dropped, not surfaced.
 *   - Spec called for the `@google/generative-ai` SDK. We use the Gemini
 *     REST endpoint via `fetch` instead — same model, no extra dep, easier
 *     to inject a stub in tests. Functionally equivalent.
 */

import type { VariantModification } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisorFinding {
  ruleId: string;
  prescription: {
    whatToChange: string;
    whyItWorks: string;
    experimentVariantDescription: string;
  };
}

export interface AdvisorDesignContext {
  captureMethod: 'full' | 'structural';
  designTokens: Record<string, unknown> | null;
  computedStyles: Record<string, unknown> | null;
  cssSystem: string | null;
  screenshotUrl: string | null;
}

export interface AdvisorSnapshotContext {
  /** CSS selectors the AI may target — gathered from CTAs + forms. */
  availableSelectors: string[];
  /** Text content of CTAs, for copy register. */
  ctaVocabulary: string[];
}

export interface AdvisorOption {
  label: string;
  modifications: VariantModification[];
  confidence: 'high' | 'low';
}

export interface AdvisorResult {
  options: AdvisorOption[];
  /** Number of raw modifications dropped because they failed validation. */
  droppedCount: number;
  /** Set when fewer than 3 valid options survived validation. */
  note?: string;
}

export const MODEL_NAME = 'gemini-2.0-flash';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildPrompt(args: {
  finding: AdvisorFinding;
  design: AdvisorDesignContext;
  snapshot: AdvisorSnapshotContext;
}): string {
  const { finding, design, snapshot } = args;

  const degraded =
    design.captureMethod === 'structural'
      ? '\nNote: computed styles unavailable. Base CSS on design tokens and site patterns.'
      : '';

  return [
    'You are generating A/B test modifications for a production website.',
    '',
    'DESIGN SYSTEM (extracted from the real site):',
    JSON.stringify(design.designTokens ?? {}),
    '',
    `CSS FRAMEWORK: ${design.cssSystem ?? 'unknown'}`,
    `CAPTURE METHOD: ${design.captureMethod}${degraded}`,
    '',
    'KEY ELEMENT COMPUTED STYLES:',
    JSON.stringify(design.computedStyles ?? 'unavailable'),
    '',
    'CTA COPY REGISTER (samples from the site):',
    JSON.stringify(snapshot.ctaVocabulary),
    '',
    'FINDING:',
    `Rule: ${finding.ruleId}`,
    `What to change: ${finding.prescription.whatToChange}`,
    `Why it works: ${finding.prescription.whyItWorks}`,
    `Variant description: ${finding.prescription.experimentVariantDescription}`,
    '',
    'AVAILABLE SELECTORS (use ONLY these):',
    JSON.stringify(snapshot.availableSelectors),
    '',
    'MODIFICATION SCHEMA — output ONLY valid instances of these discriminated-union types:',
    JSON.stringify([
      { type: 'css-inject', selector: 'string', css: 'string' },
      { type: 'text-replace', selector: 'string', text: 'string' },
      { type: 'element-hide', selector: 'string' },
      { type: 'element-show', selector: 'string' },
      { type: 'attribute-set', selector: 'string', attr: 'string', value: 'string' },
    ]),
    '',
    'Generate exactly 3 different modification options that implement this finding.',
    'Each option must use selectors from the AVAILABLE SELECTORS list only.',
    'Return JSON in this exact shape (no markdown, no explanation):',
    '{"options":[{"label":"...","modifications":[...]},{"label":"...","modifications":[...]},{"label":"...","modifications":[...]}]}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing + validation
// ---------------------------------------------------------------------------

/** Per-modification shape check. Returns `null` if valid, else an error tag. */
function validateModification(
  raw: unknown,
  allowedSelectors: ReadonlySet<string>,
): VariantModification | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const type = m.type;
  const selector = typeof m.selector === 'string' ? m.selector : null;

  switch (type) {
    case 'css-inject':
      if (!selector || typeof m.css !== 'string' || m.css.length === 0) return null;
      if (!allowedSelectors.has(selector)) return null;
      return { type, selector, css: m.css };
    case 'text-replace':
      if (!selector || typeof m.text !== 'string' || m.text.length === 0) return null;
      if (!allowedSelectors.has(selector)) return null;
      return { type, selector, text: m.text };
    case 'element-hide':
    case 'element-show':
      if (!selector) return null;
      if (!allowedSelectors.has(selector)) return null;
      return { type, selector };
    case 'attribute-set':
      if (!selector || typeof m.attr !== 'string' || typeof m.value !== 'string') return null;
      if (m.attr.length === 0) return null;
      if (!allowedSelectors.has(selector)) return null;
      return { type, selector, attr: m.attr, value: m.value };
    // `element-reorder` is omitted from the AI surface intentionally — it
    // takes child indexes the model would have to invent, which is exactly
    // the failure mode the selector allowlist is designed to prevent.
    default:
      return null;
  }
}

/**
 * Parse the raw Gemini text into an `AdvisorResult`. Strips markdown
 * fences if present (the model occasionally adds them despite the
 * "no markdown" instruction). Drops modifications that fail validation;
 * an option with at least one surviving modification is kept.
 */
export function parseAndValidateResponse(args: {
  raw: string;
  availableSelectors: readonly string[];
  captureMethod: 'full' | 'structural';
}): AdvisorResult {
  const allowed = new Set(args.availableSelectors);
  const confidence: 'high' | 'low' = args.captureMethod === 'full' ? 'high' : 'low';

  const cleaned = args.raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { options: [], droppedCount: 0, note: 'AI response was not valid JSON.' };
  }

  const root = parsed as Record<string, unknown>;
  const rawOptions = Array.isArray(root.options) ? root.options : null;
  if (!rawOptions) {
    return { options: [], droppedCount: 0, note: 'AI response missing `options` array.' };
  }

  let droppedCount = 0;
  const options: AdvisorOption[] = [];

  for (let i = 0; i < rawOptions.length; i++) {
    const opt = rawOptions[i] as Record<string, unknown> | null;
    if (!opt || typeof opt !== 'object') {
      droppedCount += 1;
      continue;
    }
    const rawMods = Array.isArray(opt.modifications) ? opt.modifications : [];
    const validMods: VariantModification[] = [];
    for (const m of rawMods) {
      const valid = validateModification(m, allowed);
      if (valid) validMods.push(valid);
      else droppedCount += 1;
    }
    if (validMods.length === 0) continue;
    const rawLabel = typeof opt.label === 'string' ? opt.label.trim() : '';
    options.push({
      label: rawLabel.length > 0 ? rawLabel : `Option ${options.length + 1}`,
      modifications: validMods,
      confidence,
    });
  }

  const result: AdvisorResult = { options, droppedCount };
  if (options.length < 3) {
    result.note =
      options.length === 0
        ? 'No valid options — the AI returned modifications that did not pass schema or selector validation.'
        : `Returned ${options.length} of 3 options — the others were dropped during validation.`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Gemini REST client
// ---------------------------------------------------------------------------

export interface GeminiCallResult {
  text: string;
  promptTokens: number | null;
  responseTokens: number | null;
}

export type GeminiFetcher = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetcher: GeminiFetcher = (url, init) =>
  fetch(url, init) as unknown as ReturnType<GeminiFetcher>;

export async function callGeminiFlash(args: {
  prompt: string;
  apiKey: string;
  fetcher?: GeminiFetcher;
}): Promise<GeminiCallResult> {
  const fetcher = args.fetcher ?? defaultFetcher;
  const response = await fetcher(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(args.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: args.prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return {
    text,
    promptTokens: body.usageMetadata?.promptTokenCount ?? null,
    responseTokens: body.usageMetadata?.candidatesTokenCount ?? null,
  };
}

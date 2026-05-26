/**
 * Structured vision capture — Ring 2 of the audit-endpoint hardening.
 *
 * Where `visionPass.ts` produces a 2-sentence narrative observation that
 * enriches the email, this module produces structured `VisualSignals` that
 * downstream rules consume as if they were any other parser output. The
 * LLM call lives at capture time, is cached on the snapshot row, and runs
 * once per audit per page. Rules stay pure deterministic functions; the
 * model is just a more capable parser.
 *
 * What it closes (handover §12.A):
 *   - Unnamed-CTA root cause: vision identifies icon-only "Get started"
 *     buttons and gives them a semantic label. `heroHierarchyInversion`
 *     reads `visualPrimaryCta.text` when its own CTA text is empty.
 *   - Page-type context (`pageType`): a docs page shouldn't get the same
 *     `nav-dispersion` threshold as a pricing page. (Each rule reading
 *     it for threshold modulation is per-rule follow-up work; the signal
 *     lives here.)
 *   - Hero copy verbatim: input for the Layer F AI copy critique rules
 *     (`vague-claim-detected`, `proof-missing`, `cta-verb-mismatch`).
 *
 * Trust model mirrors `aiAdvisor.ts`: structured-output mode, schema
 * validation, fail-soft. A model that hallucinates returns null rather
 * than poisoning rules with garbage.
 */

import type {
  PageType,
  VisualCtaSignal,
  VisualHeroBlock,
  VisualSignals,
} from '@/lib/phase2/snapshots/types';

export const VISION_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const VALID_PAGE_TYPES: ReadonlySet<PageType> = new Set([
  'home',
  'landing',
  'pricing',
  'signup',
  'checkout',
  'docs',
  'about',
  'blog',
  'support',
  'legal',
  'unknown',
]);

export interface CaptureVisualSignalsArgs {
  /** Used only for the prompt — the screenshot is the actual input. */
  url: string;
  domain: string;
  /** Above-fold JPEG buffer at the captured viewport. */
  screenshot: Buffer;
}

export interface CaptureVisualSignalsDeps {
  /** Override-able for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Override-able for tests. Defaults to `process.env.GEMINI_API_KEY`. */
  apiKey?: string | null;
  /** Override-able for tests so the result is deterministic. */
  now?: () => Date;
}

const VISION_PROMPT = `You are an objective UI observer. Look at the above-the-fold screenshot.
Return ONLY JSON matching this schema, no prose, no markdown:
{
  "visualPrimaryCta": { "text": string, "bbox": {"x": number, "y": number, "width": number, "height": number}, "confidence": number } | null,
  "visualSecondaryCta": { "text": string, "bbox": {"x": number, "y": number, "width": number, "height": number}, "confidence": number } | null,
  "pageType": "home" | "landing" | "pricing" | "signup" | "checkout" | "docs" | "about" | "blog" | "support" | "legal" | "unknown",
  "heroBlock": { "headline": string | null, "subheadline": string | null, "firstParagraph": string | null } | null
}

Rules:
- bbox coords are 0..1 normalized to the viewport (e.g. an element spanning the top-left quarter is {x:0, y:0, width:0.5, height:0.5}).
- "visualPrimaryCta.text" is the literal label your eye reads. If the button is icon-only with a visible word, return the word. If you cannot read a label, set the field to null. Never invent text.
- "pageType" picks the closest category. Use "unknown" if none fit.
- "heroBlock" extracts the headline (largest above-fold text), the subheadline (next-largest supporting text), and the first body paragraph if visible. Extract verbatim — do not paraphrase.
- "confidence" is your own 0..1 self-assessment for each CTA.
- Return null for fields you cannot identify with certainty.`;

/**
 * Capture structured vision signals for a single above-fold screenshot.
 * Returns `null` when:
 *   - `GEMINI_API_KEY` is not set (no API access).
 *   - The Gemini call fails (network, rate limit, model error).
 *   - The model output cannot be parsed as valid JSON.
 *   - The parsed JSON does not match the schema.
 *
 * Never throws. Callers must `?? undefined` the result when writing to
 * the snapshot row — `data.visualSignals` is optional by design.
 */
export async function captureVisualSignals(
  args: CaptureVisualSignalsArgs,
  deps: CaptureVisualSignalsDeps = {},
): Promise<VisualSignals | null> {
  const fetchImpl = deps.fetch ?? fetch;
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY ?? null;
  const now = deps.now ?? (() => new Date());

  if (!apiKey) return null;

  let resp: Response;
  try {
    const base64 = args.screenshot.toString('base64');
    resp = await fetchImpl(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
              { text: VISION_PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 1024,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.warn('[captureVisualSignals] fetch failed', {
      url: args.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!resp.ok) {
    console.warn('[captureVisualSignals] Gemini API error', {
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

  const rawText = extractText(body);
  if (!rawText) return null;

  const parsed = safeJsonParse(rawText);
  if (!parsed) return null;

  const validated = validateVisualSignals(parsed);
  if (!validated) return null;

  return {
    ...validated,
    capturedAt: now().toISOString(),
    modelVersion: VISION_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests.
// ---------------------------------------------------------------------------

interface GeminiBody {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function extractText(body: unknown): string | null {
  const b = body as GeminiBody;
  return b.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface RawVisualSignals {
  visualPrimaryCta: VisualCtaSignal | null;
  visualSecondaryCta: VisualCtaSignal | null;
  pageType: PageType;
  heroBlock: VisualHeroBlock | null;
}

/**
 * Validate the model's JSON output against the `VisualSignals` schema.
 * Returns the validated object stripped of unknown fields, or `null`
 * when validation fails. Exported for tests.
 */
export function validateVisualSignals(raw: unknown): RawVisualSignals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const visualPrimaryCta = validateCta(r.visualPrimaryCta);
  // Primary may be null but the field must be present.
  if (visualPrimaryCta === undefined) return null;

  const visualSecondaryCta = validateCta(r.visualSecondaryCta);
  if (visualSecondaryCta === undefined) return null;

  const pageType = validatePageType(r.pageType);
  if (pageType === null) return null;

  const heroBlock = validateHeroBlock(r.heroBlock);
  if (heroBlock === undefined) return null;

  return { visualPrimaryCta, visualSecondaryCta, pageType, heroBlock };
}

/**
 * Returns the validated CTA, `null` when the input is explicitly null, or
 * `undefined` when the input is malformed (which makes the whole signals
 * payload invalid). The three-state return lets the caller distinguish
 * "model said no CTA here" from "model returned garbage".
 */
function validateCta(raw: unknown): VisualCtaSignal | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;

  if (typeof r.text !== 'string' || r.text.trim().length === 0) return undefined;
  if (r.text.length > 200) return undefined;

  const bbox = r.bbox as Record<string, unknown> | undefined;
  if (!bbox || typeof bbox !== 'object') return undefined;
  const x = numberInUnit(bbox.x);
  const y = numberInUnit(bbox.y);
  const width = numberInUnit(bbox.width);
  const height = numberInUnit(bbox.height);
  if (x === null || y === null || width === null || height === null) return undefined;

  const confidence = numberInUnit(r.confidence);
  if (confidence === null) return undefined;

  return {
    text: r.text.trim(),
    bbox: { x, y, width, height },
    confidence,
  };
}

function validatePageType(raw: unknown): PageType | null {
  if (typeof raw !== 'string') return null;
  return VALID_PAGE_TYPES.has(raw as PageType) ? (raw as PageType) : 'unknown';
}

function validateHeroBlock(raw: unknown): VisualHeroBlock | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    headline: typeof r.headline === 'string' && r.headline.length <= 500 ? r.headline.trim() : null,
    subheadline:
      typeof r.subheadline === 'string' && r.subheadline.length <= 500 ? r.subheadline.trim() : null,
    firstParagraph:
      typeof r.firstParagraph === 'string' && r.firstParagraph.length <= 2000
        ? r.firstParagraph.trim()
        : null,
  };
}

function numberInUnit(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // Slightly relax bounds so a model that returns 1.02 isn't rejected — clamp.
  if (raw < -0.05 || raw > 1.05) return null;
  return Math.max(0, Math.min(1, raw));
}

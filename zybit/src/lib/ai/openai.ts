/**
 * Shared OpenAI client for every AI call in Zybit.
 *
 * Replaces the per-file Gemini REST integrations (removed 2026-05). Every
 * text / vision / image-edit call now routes through this module so the
 * model registry, key resolution, and request shape live in one place.
 *
 * Design constraints carried over from the Gemini integration:
 *   - REST via `fetch` (no SDK dependency) with an injectable `fetcher` so
 *     unit tests can stub responses without network.
 *   - Returns `{ text, promptTokens, responseTokens }` for cost logging.
 *   - Callers own fail-soft: this client throws on network error / non-2xx;
 *     capture-time callers catch and return `null` so rules degrade
 *     gracefully.
 *
 * Model selection (researched May 2026 — see DOCTRINE "AI providers"):
 *   - Reasoning / quality-sensitive (variant advisor, audit fix advisor):
 *     `gpt-5.4` — strong structured output + vision at production cost.
 *   - Capture-time classification / extraction (copy critique, visual
 *     signals, vision caption, screenshot quality gate, site classifier):
 *     `gpt-5.4-mini` — adequate for schema-bound extraction at a fraction of
 *     the cost; these run per-page so cost dominates.
 *   - Image edit / inpaint: `gpt-image-1` via the Images Edits endpoint.
 *
 * Override any model at runtime with the matching env var below.
 */

export const OPENAI_REASONING_MODEL = process.env.OPENAI_REASONING_MODEL || 'gpt-5.4';
export const OPENAI_FAST_MODEL = process.env.OPENAI_FAST_MODEL || 'gpt-5.4-mini';
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

export const OPENAI_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_IMAGE_EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits';

/**
 * Resolve the OpenAI API key. Treats an explicitly-passed `null` as
 * "disabled" (tests use this to assert the no-key short-circuit) and only
 * falls through to the env var when the override is `undefined`.
 */
export function resolveOpenAIKey(override?: string | null): string | null {
  if (override === undefined) return process.env.OPENAI_API_KEY ?? null;
  return override;
}

// Minimal structural type so a `fetch` stub (or the real `fetch`) satisfies
// the contract without pulling DOM lib types into call sites.
export type OpenAIFetcher = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetcher: OpenAIFetcher = (url, init) =>
  fetch(url, init) as unknown as ReturnType<OpenAIFetcher>;

export interface OpenAICallResult {
  text: string;
  promptTokens: number | null;
  responseTokens: number | null;
}

export interface OpenAIImageInput {
  /** Base64-encoded image payload (no data: prefix). */
  base64: string;
  /** e.g. `image/png`, `image/jpeg`. */
  mimeType: string;
}

interface ChatBody {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Single text / vision call against the Chat Completions API.
 *
 * - `json: true` requests strict JSON output (`response_format`), matching
 *   the old Gemini `responseMimeType: 'application/json'` behavior.
 * - Pass `image` to send a vision request (text + image content parts).
 * - `temperature` is omitted from the request unless provided — the gpt-5.x
 *   reasoning family rejects non-default temperatures, so callers that don't
 *   need it should leave it unset.
 *
 * Throws on network error or non-2xx so callers can decide fail-soft policy.
 */
export async function callOpenAIChat(args: {
  prompt: string;
  apiKey: string;
  model?: string;
  image?: OpenAIImageInput | null;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  fetcher?: OpenAIFetcher;
  signal?: AbortSignal;
}): Promise<OpenAICallResult> {
  const fetcher = args.fetcher ?? defaultFetcher;
  const model = args.model ?? OPENAI_FAST_MODEL;

  const content: unknown = args.image
    ? [
        { type: 'text', text: args.prompt },
        {
          type: 'image_url',
          image_url: { url: `data:${args.image.mimeType};base64,${args.image.base64}` },
        },
      ]
    : args.prompt;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
  };
  if (args.json) body.response_format = { type: 'json_object' };
  if (args.maxTokens !== undefined) body.max_completion_tokens = args.maxTokens;
  if (args.temperature !== undefined) body.temperature = args.temperature;

  const response = await fetcher(OPENAI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Bearer token in the Authorization header — never the URL — so the
      // key never lands in access logs or breadcrumbs.
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    ...(args.signal ? { signal: args.signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: HTTP ${response.status}`);
  }

  const parsed = (await response.json()) as ChatBody;
  return {
    text: parsed.choices?.[0]?.message?.content ?? '',
    promptTokens: parsed.usage?.prompt_tokens ?? null,
    responseTokens: parsed.usage?.completion_tokens ?? null,
  };
}

/**
 * Extract the trimmed text from a Chat Completions response body. Exported so
 * call sites that own their own `fetch` (for status-specific logging) can
 * share the parse without duplicating the optional-chain.
 */
export function extractChatText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as ChatBody;
  return b.choices?.[0]?.message?.content?.trim() ?? null;
}

// Image edit / inpaint uses the multipart Images Edits endpoint
// (`OPENAI_IMAGE_EDIT_ENDPOINT` + `OPENAI_IMAGE_MODEL`); the implementation
// lives in `src/lib/audit/fixPreview/visionInpaint.ts`, the only image-edit
// caller, so its injectable test fetcher can drive the multipart request.
//
// Note: unlike the old Gemini image model, `gpt-image-1` does a soft-mask
// full recreation rather than pixel-level mask replacement, so brand fidelity
// is good-but-not-guaranteed. The fix-preview pipeline keeps a Tier 3
// annotated-before fallback for the cases where it drifts.

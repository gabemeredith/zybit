/**
 * Screenshot quality gate for the audit before/after fix-preview pipeline.
 *
 * The Browserless route()-intercept render occasionally produces a "before"
 * screenshot that is unfit to email a prospect:
 *   - login / paywall wall instead of the real page,
 *   - blank or still-loading frame (spinner / skeleton),
 *   - broken layout — duplicated or overlapping nav, content clipped to a
 *     sliver, hero collapsed on top of itself.
 *
 * `isLikelyBlankFrame` (renderBeforeAfter.ts) catches the all-white case by
 * pixel ratio, but a login wall or a half-rendered nav is visually "busy" and
 * sails straight through. This module asks Gemini to make the semantic call a
 * pixel heuristic can't: "is this a clean, fully-rendered page we can show, or
 * should we suppress it?" The orchestrator gates the before render on the
 * verdict; a `render: false` finding ships without any screenshot row (the
 * email card still renders title / evidence / what-to-change).
 *
 * Trust model mirrors `captureVisualSignals.ts`: structured-output mode,
 * strict validation, fail-soft. Any failure (no key, API error, unparseable
 * response) returns `render: true` so the gate degrades to the pre-gate
 * behavior rather than silently dropping every preview when the model is
 * unreachable. Operators can hard-disable the gate without a redeploy by
 * setting `AUDIT_SCREENSHOT_GATE_DISABLED=1`.
 */

import { OPENAI_CHAT_ENDPOINT, OPENAI_FAST_MODEL, extractChatText } from '@/lib/ai/openai';

const QUALITY_GATE_MODEL = OPENAI_FAST_MODEL;

/** Categorical issue the model assigns when a screenshot is unfit to email. */
export type ScreenshotIssue =
  | 'ok'
  | 'login_gated'
  | 'blank'
  | 'loading'
  | 'broken_layout';

export interface ScreenshotVerdict {
  /** True → safe to email. False → suppress the screenshot for this finding. */
  render: boolean;
  issue: ScreenshotIssue;
}

export interface AssessScreenshotArgs {
  findingId: string;
  /** Raw PNG bytes of the rendered "before" screenshot. */
  buffer: Buffer;
}

export interface AssessScreenshotDeps {
  /** Override-able for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Override-able for tests. Defaults to `process.env.OPENAI_API_KEY`. */
  apiKey?: string | null;
}

const VALID_ISSUES: ReadonlySet<ScreenshotIssue> = new Set<ScreenshotIssue>([
  'ok',
  'login_gated',
  'blank',
  'loading',
  'broken_layout',
]);

// Fail-soft default — when we can't get a verdict we render, matching the
// behavior before the gate existed. A missing screenshot is worse than the
// occasional bad one slipping through during a model-provider outage.
const RENDER_ANYWAY: ScreenshotVerdict = { render: true, issue: 'ok' };

const QUALITY_PROMPT = `You are screening a website screenshot before it is emailed to a prospect in a "before / after" comparison. Decide whether this screenshot is fit to show.

Return ONLY JSON matching this schema, no prose, no markdown:
{ "usable": boolean, "issue": "ok" | "login_gated" | "blank" | "loading" | "broken_layout" }

Set "usable": false ONLY when the screenshot is clearly unfit to show, and pick the matching issue:
- "login_gated": the page is behind a login / signup / paywall / cookie or consent wall instead of showing real content.
- "blank": the frame is essentially empty — white/blank with no meaningful content.
- "loading": the page is mid-load — a spinner, skeleton placeholder, or progress indicator dominates the frame.
- "broken_layout": the layout is clearly broken — duplicated or overlapping navigation, unstyled raw HTML, content clipped to a thin sliver, or elements stacked on top of each other.

Otherwise set "usable": true and "issue": "ok". A normal, fully-rendered marketing or product page is usable even if it is plain or sparse. When in doubt, prefer "usable": true — only flag screenshots that are obviously unfit.`;

/**
 * Ask the model whether a rendered screenshot is fit to email. Never throws.
 * Returns `{ render: true, issue: 'ok' }` on any failure so the caller
 * degrades to the pre-gate behavior.
 */
export async function assessScreenshotQuality(
  args: AssessScreenshotArgs,
  deps: AssessScreenshotDeps = {},
): Promise<ScreenshotVerdict> {
  if (process.env.AUDIT_SCREENSHOT_GATE_DISABLED === '1') return RENDER_ANYWAY;

  const fetchImpl = deps.fetch ?? fetch;
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY ?? null;
  if (!apiKey) return RENDER_ANYWAY;

  let resp: Response;
  try {
    const base64 = args.buffer.toString('base64');
    resp = await fetchImpl(OPENAI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Bearer key in header (not URL) so it never lands in Vercel access logs.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QUALITY_GATE_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: QUALITY_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 256,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.warn('[screenshotQualityGate] fetch failed', {
      findingId: args.findingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return RENDER_ANYWAY;
  }

  if (!resp.ok) {
    console.warn('[screenshotQualityGate] OpenAI API error', {
      findingId: args.findingId,
      status: resp.status,
    });
    return RENDER_ANYWAY;
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return RENDER_ANYWAY;
  }

  const rawText = extractText(body);
  if (!rawText) return RENDER_ANYWAY;

  const verdict = parseVerdict(rawText);
  if (!verdict) return RENDER_ANYWAY;

  if (!verdict.render) {
    console.warn('[screenshotQualityGate] suppressing screenshot', {
      findingId: args.findingId,
      issue: verdict.issue,
      model: QUALITY_GATE_MODEL,
    });
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests.
// ---------------------------------------------------------------------------

function extractText(body: unknown): string | null {
  return extractChatText(body);
}

/**
 * Parse + validate the model's JSON. Returns a verdict, or `null` when the
 * output is unparseable / malformed (caller treats null as render-anyway).
 * Exported for tests.
 */
export function parseVerdict(rawText: string): ScreenshotVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.usable !== 'boolean') return null;

  const issue: ScreenshotIssue = VALID_ISSUES.has(r.issue as ScreenshotIssue)
    ? (r.issue as ScreenshotIssue)
    : r.usable
      ? 'ok'
      : 'broken_layout';

  return { render: r.usable, issue };
}

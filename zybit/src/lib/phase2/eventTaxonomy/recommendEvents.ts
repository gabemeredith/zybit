/**
 * Event-taxonomy recommender (behavioral axis of LLM context enrichment).
 *
 * The audit's behavioral rules can only get as smart as a site's event taxonomy
 * allows. This module answers "given this site's funnel and conversion goal,
 * what PostHog events should it instrument?" — turning the audit into advice on
 * *what to measure*, not just what's on the page.
 *
 * AI-engineering contract (mirrors captureCopyCritique):
 *   - structured output + strict validator + fail-soft to `null`.
 *   - `alreadyTracked` is computed DETERMINISTICALLY (we match the recommended
 *     name against the events the site already fires) — never trusted from the
 *     model. The LLM proposes; deterministic code decides what's new.
 *   - grounded in observed page types + funnel paths + the (optional) SiteContext
 *     goal; the model is told to recommend only events the funnel justifies.
 *
 * This is advisory context, not a rule input — it never changes whether a
 * finding fires. Caller gates on `isSiteContextEnabled()`.
 */

import {
  OPENAI_FAST_MODEL,
  callOpenAIChat,
  resolveOpenAIKey,
  type OpenAIFetcher,
} from '@/lib/ai/openai';
import type { SiteContext } from '@/lib/phase2/siteContext';

export const EVENT_TAXONOMY_MODEL = OPENAI_FAST_MODEL;

export type EventPriority = 'high' | 'medium' | 'low';

export interface RecommendedEvent {
  /** snake_case event name, e.g. `checkout_step_viewed`. */
  name: string;
  /** When the event should fire (one short phrase). */
  trigger: string;
  /** Why it matters for conversion measurement (one short phrase). */
  why: string;
  priority: EventPriority;
  /** Computed deterministically: is the site already firing this event? */
  alreadyTracked: boolean;
}

export interface EventTaxonomyRecommendation {
  events: RecommendedEvent[];
  capturedAt: string;
  modelVersion: string;
}

export interface RecommendEventsInput {
  /** Business context — goal/industry sharpen the recommendations. May be null. */
  siteContext: SiteContext | null;
  /** Observed page types across the crawl (e.g. ['home','pricing','checkout']). */
  pageTypes: string[];
  /** Observed funnel paths (e.g. ['/', '/pricing', '/checkout']). */
  funnelPaths: string[];
  /** Event types the site already fires (canonical phase1_events `type`s). */
  currentEvents: string[];
}

export interface RecommendEventsDeps {
  fetcher?: OpenAIFetcher;
  apiKey?: string | null;
  now?: () => Date;
  model?: string;
}

const PRIORITIES: EventPriority[] = ['high', 'medium', 'low'];
const NAME_MAX = 60;
const TEXT_MAX = 120;
const MAX_EVENTS = 12;

/** Normalize an event name for the already-tracked match (case/sep-insensitive). */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Returns recommended events, or `null` when the LLM is unavailable/fails or the
 * funnel is too thin to say anything. Never throws.
 */
export async function recommendEvents(
  input: RecommendEventsInput,
  deps: RecommendEventsDeps = {},
): Promise<EventTaxonomyRecommendation | null> {
  const now = deps.now ?? (() => new Date());
  const apiKey = resolveOpenAIKey(deps.apiKey);
  if (!apiKey) return null;
  if (input.pageTypes.length === 0 && input.funnelPaths.length === 0) return null;

  let text: string;
  try {
    ({ text } = await callOpenAIChat({
      prompt: buildEventTaxonomyPrompt(input),
      apiKey,
      model: deps.model ?? EVENT_TAXONOMY_MODEL,
      json: true,
      maxTokens: 900,
      ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
    }));
  } catch {
    return null;
  }

  const events = validateEvents(safeParse(text), input.currentEvents);
  if (events === null) return null;

  return {
    events,
    capturedAt: now().toISOString(),
    modelVersion: deps.model ?? EVENT_TAXONOMY_MODEL,
  };
}

export function buildEventTaxonomyPrompt(input: RecommendEventsInput): string {
  const goal = input.siteContext?.conversionGoal ?? 'unknown';
  const industry = input.siteContext?.industry ?? 'unknown';
  return [
    'You are a product analytics engineer. Given a site\'s funnel and the events it',
    'already fires, recommend the PostHog events it should instrument so a conversion',
    'audit can measure funnel drop-off. Return ONLY JSON, no prose, no markdown:',
    '{ "events": [ { "name": string, "trigger": string, "why": string, "priority": "high" | "medium" | "low" } ] }',
    '',
    'Rules:',
    '- "name": snake_case, specific to a funnel step (e.g. "checkout_shipping_viewed",',
    '  "pricing_plan_selected"). Not vague ("user_action").',
    '- Recommend ONLY events the observed funnel justifies. Prefer the steps between',
    `  the entry page and the conversion goal (${goal}). Max ${MAX_EVENTS} events.`,
    '- "trigger": when it fires, <= 12 words. "why": the drop-off it reveals, <= 14 words.',
    '- "priority": high = directly measures the primary conversion path; medium = a',
    '  supporting step; low = nice-to-have.',
    '- Do NOT restate events already tracked unless a more granular version is needed.',
    '',
    `INDUSTRY: ${industry}`,
    `CONVERSION GOAL: ${goal}`,
    `OBSERVED PAGE TYPES: ${input.pageTypes.join(', ') || '(none)'}`,
    `OBSERVED FUNNEL PATHS: ${input.funnelPaths.slice(0, 20).join(', ') || '(none)'}`,
    `ALREADY TRACKED EVENTS: ${input.currentEvents.slice(0, 40).join(', ') || '(none)'}`,
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
 * Validate the model output and stamp `alreadyTracked` deterministically against
 * the site's current events. Returns `null` only for a non-object payload or a
 * missing/!array `events`. Drops malformed individual entries.
 */
export function validateEvents(raw: unknown, currentEvents: string[]): RecommendedEvent[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const list = (raw as Record<string, unknown>).events;
  if (!Array.isArray(list)) return null;

  const tracked = new Set(currentEvents.map(normalizeName));
  const out: RecommendedEvent[] = [];
  for (const entry of list) {
    if (out.length >= MAX_EVENTS) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = cleanField(e.name, NAME_MAX);
    const trigger = cleanField(e.trigger, TEXT_MAX);
    const why = cleanField(e.why, TEXT_MAX);
    if (!name || !trigger || !why) continue;
    const priority = typeof e.priority === 'string' && (PRIORITIES as string[]).includes(e.priority)
      ? (e.priority as EventPriority)
      : 'medium';
    out.push({
      name,
      trigger,
      why,
      priority,
      alreadyTracked: tracked.has(normalizeName(name)),
    });
  }
  return out;
}

function cleanField(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length === 0 ? null : t.slice(0, max);
}

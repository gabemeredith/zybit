/**
 * Pairwise LLM-as-judge for Layer B prose.
 *
 * Given two write-ups of the SAME finding (one template, one LLM — but the
 * judge is told neither which is which nor that one is a machine), pick the
 * better one for a PM. Pairwise, not absolute 1-10 scoring: LLMs are far more
 * reliable at "A or B?" than at calibrated scores.
 *
 * Design choices that matter for trust:
 *   - The judge is a DIFFERENT model family from the generator (judge =
 *     OpenAI reasoning model; generator = Gemini), so it isn't grading its own
 *     house style (self-preference bias).
 *   - The caller runs each pair in BOTH orders and only counts a win when the
 *     judge agrees both ways — that cancels position bias. See runEval.
 *   - Numeric grounding is already enforced upstream (verifyOutputAgainstFacts),
 *     so the judge scores QUALITY: actionability, specificity, clarity/voice —
 *     not whether the numbers are real.
 */

import {
  callOpenAIChat,
  resolveOpenAIKey,
  OPENAI_REASONING_MODEL,
  type OpenAIFetcher,
} from '@/lib/ai/openai';

export interface JudgeProse {
  summary: string;
  whatToChange?: string;
}

export interface JudgeInput {
  ruleId: string;
  pathRef: string | null;
  /** Blind: A and B; the caller decides which slot holds template vs LLM. */
  a: JudgeProse;
  b: JudgeProse;
}

export type JudgeWinner = 'A' | 'B' | 'tie';

export interface JudgeVerdict {
  winner: JudgeWinner;
  reason: string;
}

function sanitize(s: string): string {
  return s.replace(/[<>]/g, '');
}

export function buildJudgePrompt(input: JudgeInput): string {
  const block = (p: JudgeProse): string =>
    `summary: ${sanitize(p.summary)}\n  whatToChange: ${sanitize(p.whatToChange ?? '(none)')}`;
  return [
    'You are evaluating two write-ups of the SAME website conversion-audit',
    'finding, for a product manager. Pick the better one. Judge ONLY on:',
    '  1. Actionability — proposes a concrete change to ship as an A/B variant,',
    '     not vague advice or research ("run user interviews").',
    '  2. Specificity — names the element/page and the exact change.',
    '  3. Clarity & fit — concise, PM-readable, reads like it was written for',
    '     this site, no filler or hedging.',
    'Both write-ups are already fact-checked, so do NOT reward or penalize',
    'numbers — judge how well it is phrased and how shippable the fix is.',
    '',
    `FINDING: ${sanitize(input.ruleId)}${input.pathRef ? ` on ${sanitize(input.pathRef)}` : ''}`,
    '',
    'WRITE-UP A:',
    `  ${block(input.a)}`,
    '',
    'WRITE-UP B:',
    `  ${block(input.b)}`,
    '',
    'Output JSON only, no markdown: {"winner": "A" | "B" | "tie", "reason": "one short sentence"}.',
    'Use "tie" only when they are genuinely equivalent.',
  ].join('\n');
}

export function parseJudgeVerdict(raw: string): JudgeVerdict | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const winner = root.winner;
  if (winner !== 'A' && winner !== 'B' && winner !== 'tie') return null;
  const reason = typeof root.reason === 'string' ? root.reason.trim().slice(0, 300) : '';
  return { winner, reason };
}

export interface JudgeOpts {
  apiKey?: string | null;
  fetcher?: OpenAIFetcher;
  model?: string;
}

/** Returns the verdict, or `null` when the judge is unavailable / unparseable. */
export async function runJudge(input: JudgeInput, opts?: JudgeOpts): Promise<JudgeVerdict | null> {
  const apiKey = resolveOpenAIKey(opts?.apiKey);
  if (!apiKey) return null;
  try {
    const { text } = await callOpenAIChat({
      prompt: buildJudgePrompt(input),
      apiKey,
      model: opts?.model ?? OPENAI_REASONING_MODEL,
      json: true,
      ...(opts?.fetcher ? { fetcher: opts.fetcher } : {}),
    });
    return parseJudgeVerdict(text);
  } catch {
    return null;
  }
}

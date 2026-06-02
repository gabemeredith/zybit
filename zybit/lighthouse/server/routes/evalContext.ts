/**
 * Context A/B eval routes — the "is SiteContext noticeably better?" surface.
 *
 *   POST /lighthouse/api/eval/context   { url, maxPages?, visionPagesLimit? }
 *       → 202 { runId }. Runs the baseline + enriched audits in the background;
 *         the GUI polls GET /lighthouse/api/runs/:runId and reads `evalComparison`.
 *   POST /lighthouse/api/eval/verdict   { url, key, variant, verdict }
 *       → { ok, scoreboard }. Records a human valid/invalid judgment.
 *   GET  /lighthouse/api/eval/verdicts?url=…
 *       → { verdicts, scoreboard }.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { runContextComparison } from '../../lib/eval/contextComparison';
import { createVerdictStore, type Variant, type Verdict } from '../../lib/eval/verdictStore';
import { requireAuth } from '../auth';
import { readJsonBody } from '../http';
import { runLogStore } from '../logCapture';
import { appendProgress, completeEvalRun, createRun, failRun } from '../runs';

const store = createVerdictStore();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function postEvalContext(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'bad_json' });
  }
  const p = (body ?? {}) as { url?: unknown; maxPages?: unknown; visionPagesLimit?: unknown };
  const url = typeof p.url === 'string' ? p.url.trim() : '';
  if (!url) return json(res, 400, { error: 'missing_url' });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return json(res, 400, { error: 'invalid_url', detail: url });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json(res, 400, { error: 'unsupported_protocol', detail: parsed.protocol });
  }

  const maxPages =
    typeof p.maxPages === 'number' && Number.isFinite(p.maxPages)
      ? Math.max(1, Math.min(20, Math.floor(p.maxPages)))
      : 8;
  const visionPagesLimit =
    typeof p.visionPagesLimit === 'number' && Number.isFinite(p.visionPagesLimit)
      ? Math.max(0, Math.min(10, Math.floor(p.visionPagesLimit)))
      : 3;

  const state = createRun(`context-eval: ${url}`);

  void runLogStore.run({ runId: state.runId }, async () => {
    try {
      const comparison = await runContextComparison({
        url,
        maxPages,
        visionPagesLimit,
        onProgress: (event) => appendProgress(state.runId, event),
      });
      completeEvalRun(state.runId, comparison);
    } catch (err) {
      failRun(state.runId, err);
    }
  });

  json(res, 202, { runId: state.runId });
}

const VARIANTS: Variant[] = ['baseline', 'enriched'];
const VERDICTS: Verdict[] = ['valid', 'invalid'];

export async function postEvalVerdict(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'bad_json' });
  }
  const p = (body ?? {}) as { url?: unknown; key?: unknown; variant?: unknown; verdict?: unknown };
  const url = typeof p.url === 'string' ? p.url.trim() : '';
  const key = typeof p.key === 'string' ? p.key : '';
  const variant = p.variant as Variant;
  const verdict = p.verdict as Verdict;
  if (!url || !key || !VARIANTS.includes(variant) || !VERDICTS.includes(verdict)) {
    return json(res, 400, { error: 'invalid_verdict' });
  }

  store.record({ url, key, variant, verdict });
  json(res, 200, { ok: true, scoreboard: store.scoreboard(url) });
}

export function getEvalVerdicts(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const target = url.searchParams.get('url') ?? '';
  if (!target) return json(res, 400, { error: 'missing_url' });
  json(res, 200, { verdicts: store.listForUrl(target), scoreboard: store.scoreboard(target) });
}

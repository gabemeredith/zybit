/**
 * URL-audit route — `POST /lighthouse/api/audit-url`.
 *
 * Body: `{ url: string; maxPages?: number }`.
 * Mirrors the generate route: kicks `runUrlAudit` off in the background and
 * returns a runId the GUI polls via `GET /lighthouse/api/runs/:runId`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { runUrlAudit } from '../../lib/runner/runUrlAudit';
import { requireAuth } from '../auth';
import { readJsonBody } from '../http';
import { runLogStore } from '../logCapture';
import { appendProgress, completeRun, createRun, failRun } from '../runs';

function badRequest(res: ServerResponse, error: string, detail?: string): void {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify(detail ? { error, detail } : { error }));
}

export async function postAuditUrl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    return badRequest(res, 'bad_json');
  }
  const params = (body ?? {}) as {
    url?: unknown;
    maxPages?: unknown;
    layerB?: unknown;
    layerBDeriveFacts?: unknown;
  };
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (!url) return badRequest(res, 'missing_url');
  const layerB = typeof params.layerB === 'boolean' ? params.layerB : undefined;
  const layerBDeriveFacts =
    typeof params.layerBDeriveFacts === 'boolean' ? params.layerBDeriveFacts : undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return badRequest(res, 'invalid_url', url);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return badRequest(res, 'unsupported_protocol', parsed.protocol);
  }

  const maxPages =
    typeof params.maxPages === 'number' && Number.isFinite(params.maxPages)
      ? Math.max(1, Math.min(40, Math.floor(params.maxPages)))
      : 20;

  const state = createRun(url);

  // Background — do NOT await. The caller polls /lighthouse/api/runs/:runId.
  // Bind the run id through the async chain so the pipeline's `console` output
  // (incl. every LLM call) is captured for the developer log panel.
  void runLogStore.run({ runId: state.runId }, async () => {
    try {
      const result = await runUrlAudit({
        url,
        maxPages,
        onProgress: (event) => appendProgress(state.runId, event),
        ...(typeof layerB === 'boolean' ? { layerB } : {}),
        ...(layerBDeriveFacts ? { layerBDeriveFacts } : {}),
      });
      completeRun(state.runId, result);
    } catch (err) {
      failRun(state.runId, err);
    }
  });

  res.writeHead(202, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ runId: state.runId }));
}

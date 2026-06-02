/**
 * Eval route — `POST /lighthouse/api/eval` body `{ runId }`.
 *
 * Runs the pairwise judge over a completed run's Layer B prose pairs and
 * returns the EvalReport (per-finding winner + reason + win-rate). Synchronous:
 * the judge is a handful of calls; the GUI shows a "judging…" state while it
 * awaits. Used by the Lighthouse Layer B panel's "judge & calibrate" flow.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { runEval } from '@/lib/phase2/layerB/eval/runEval';
import { requireAuth } from '../auth';
import { readJsonBody } from '../http';
import { getRun } from '../runs';

export async function postEval(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_json' }));
    return;
  }

  const runId = typeof (body as { runId?: unknown })?.runId === 'string'
    ? (body as { runId: string }).runId
    : '';
  const run = runId ? getRun(runId) : undefined;
  const layerB = run?.result?.layerB;
  if (!layerB) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_layerb_telemetry', detail: 'run has no Layer B prose to judge' }));
    return;
  }

  try {
    const report = await runEval(layerB);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(report));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'eval_failed', detail: err instanceof Error ? err.message : String(err) }));
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getScenario } from '../../lib/scenarios';
import { runScenario } from '../../lib/runner/runScenario';
import type { EventSinkMode } from '../../lib/types';
import { requireAuth } from '../auth';
import {
  appendProgress,
  completeRun,
  createRun,
  failRun,
  getRun,
} from '../runs';

async function readJsonBody(req: IncomingMessage, maxBytes = 16 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function badRequest(res: ServerResponse, error: string, detail?: string): void {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify(detail ? { error, detail } : { error }));
}

export async function postGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    badRequest(res, 'bad_json');
    return;
  }
  const params = (body ?? {}) as {
    scenarioId?: unknown;
    sessions?: unknown;
    mode?: unknown;
  };
  const scenarioId = typeof params.scenarioId === 'string' ? params.scenarioId : '';
  const sessions =
    typeof params.sessions === 'number' && Number.isFinite(params.sessions)
      ? Math.max(1, Math.min(10_000, Math.floor(params.sessions)))
      : 0;
  const mode: EventSinkMode = params.mode === 'posthog' ? 'posthog' : 'direct';

  if (!scenarioId) return badRequest(res, 'missing_scenarioId');
  if (sessions <= 0) return badRequest(res, 'invalid_sessions');

  const scenario = getScenario(scenarioId);
  if (!scenario) return badRequest(res, 'unknown_scenario', scenarioId);

  const state = createRun(scenarioId);

  // Background — do NOT await. The caller polls /api/runs/:runId for progress.
  void (async () => {
    try {
      const result = await runScenario({
        scenario,
        sessions,
        mode,
        onProgress: (event) => appendProgress(state.runId, event),
      });
      completeRun(state.runId, result);
    } catch (err) {
      failRun(state.runId, err);
    }
  })();

  res.writeHead(202, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ runId: state.runId }));
}

export function getRunById(runId: string, req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;
  const state = getRun(runId);
  if (!state) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown_run' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(state));
}

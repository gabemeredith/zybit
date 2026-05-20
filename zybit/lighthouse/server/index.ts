/**
 * Lighthouse http server entrypoint.
 *
 * Run from the app root (`zybit/`):
 *   npx tsx --env-file=lighthouse/.env lighthouse/server/index.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getMe, postAuth, postLogout } from './routes/auth';
import { getRunById, postGenerate } from './routes/generate';
import { getScenarios } from './routes/scenarios';
import { isStaticRequest, serveStatic } from './static';

const PORT = Number.parseInt(process.env.LIGHTHOUSE_PORT ?? '3001', 10);

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'lighthouse' }));
  },
  'POST /api/auth': postAuth,
  'POST /api/logout': postLogout,
  'GET /api/me': getMe,
  'GET /api/scenarios': getScenarios,
  'POST /api/generate': postGenerate,
};

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

const RUN_PATH = /^\/api\/runs\/([\w-]+)$/;

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const key = `${method} ${url.pathname}`;
  try {
    const handler = routes[key];
    if (handler) {
      await handler(req, res);
      return;
    }
    const runMatch = method === 'GET' ? RUN_PATH.exec(url.pathname) : null;
    if (runMatch) {
      getRunById(runMatch[1], req, res);
      return;
    }
    const staticPath = isStaticRequest(method, url.pathname);
    if (staticPath !== null && (await serveStatic(staticPath, res))) {
      return;
    }
    notFound(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal', message }));
  }
});

server.listen(PORT, () => {
  console.log(`lighthouse listening on http://localhost:${PORT}/lighthouse`);
});

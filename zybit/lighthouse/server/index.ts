/**
 * Lighthouse http server entrypoint.
 *
 * Run from the app root (`zybit/`):
 *   npx tsx --env-file=lighthouse/.env lighthouse/server/index.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getMe, postAuth, postLogout } from './routes/auth';
import { postAuditUrl } from './routes/auditUrl';
import { getRunById, postGenerate } from './routes/generate';
import { postImpersonateStart } from './routes/impersonate';
import { getScenarios } from './routes/scenarios';
import { resolveStaticPath, serveStatic } from './static';
// Side-effect imports: each scenario file calls registerScenario at module load.
import '../lib/scenarios/acmebank';
import '../lib/scenarios/wovenbasics';
import '../lib/scenarios/kilnandclay';
import '../lib/scenarios/northwind';

const PORT = Number.parseInt(process.env.LIGHTHOUSE_PORT ?? '3001', 10);

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'lighthouse' }));
  },
  'POST /lighthouse/api/auth': postAuth,
  'POST /lighthouse/api/logout': postLogout,
  'GET /lighthouse/api/me': getMe,
  'GET /lighthouse/api/scenarios': getScenarios,
  'POST /lighthouse/api/generate': postGenerate,
  'POST /lighthouse/api/audit-url': postAuditUrl,
  'POST /lighthouse/api/impersonate/start': postImpersonateStart,
};

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

const RUN_PATH = /^\/lighthouse\/api\/runs\/([\w-]+)$/;

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
    // Don't let unknown /lighthouse/api/* requests fall through to the
    // static handler (which would try to read web/api/... off disk).
    if (url.pathname.startsWith('/lighthouse/api/')) {
      notFound(res);
      return;
    }
    const staticPath = resolveStaticPath(method, url.pathname);
    if (staticPath !== null && (await serveStatic(staticPath, res))) {
      return;
    }
    notFound(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[lighthouse] ${method} ${url.pathname} threw:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal', message }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`lighthouse listening on http://localhost:${PORT}/lighthouse`);
});

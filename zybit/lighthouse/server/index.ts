/**
 * Lighthouse http server entrypoint.
 *
 * Run from the app root (`zybit/`):
 *   npx tsx --env-file=lighthouse/.env lighthouse/server/index.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { installLogCapture } from './logCapture';
import { getMe, postAuth, postLogout } from './routes/auth';
import { postAuditUrl } from './routes/auditUrl';
import { getDataMeta, getDataRows } from './routes/data';
import { getRunById, postGenerate } from './routes/generate';
import { postEval } from './routes/evalRun';
import { getEvalVerdicts, postEvalContext, postEvalVerdict } from './routes/evalContext';
import { postImpersonateStart } from './routes/impersonate';
import { getScenarios } from './routes/scenarios';
import { resolveStaticPath, serveStatic } from './static';
// Side-effect imports: each scenario file calls registerScenario at module load.
import '../lib/scenarios/acmebank';
import '../lib/scenarios/wovenbasics';
import '../lib/scenarios/kilnandclay';
import '../lib/scenarios/northwind';
import '../lib/scenarios/verdant';
import '../lib/scenarios/plotandpatio';
import '../lib/scenarios/quilltax';

// Refuse to start in a production-like environment. Lighthouse is a local dev
// tool — its routes mint real sessions and expose the database (incl. customer
// PII) behind only an admin password. It is never part of the Vercel deploy,
// so this is belt-and-suspenders against someone running it on a hosted box.
// Override with LIGHTHOUSE_ALLOW_PROD=1 if you really mean it.
if (
  process.env.LIGHTHOUSE_ALLOW_PROD !== '1' &&
  (process.env.VERCEL || process.env.NODE_ENV === 'production')
) {
  console.error(
    '[lighthouse] refusing to start in a production environment ' +
      '(VERCEL / NODE_ENV=production). Set LIGHTHOUSE_ALLOW_PROD=1 to override.',
  );
  process.exit(1);
}

// Tap `console` before anything runs so the developer log panel captures the
// pipeline's structured output (and every LLM call) per run.
installLogCapture();

const PORT = Number.parseInt(process.env.LIGHTHOUSE_PORT ?? '3001', 10);
// Bind loopback-only so the dev server is never reachable off the local
// machine, regardless of where it's launched.
const HOST = process.env.LIGHTHOUSE_HOST ?? '127.0.0.1';

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
  'POST /lighthouse/api/eval': postEval,
  'POST /lighthouse/api/eval/context': postEvalContext,
  'POST /lighthouse/api/eval/verdict': postEvalVerdict,
  'GET /lighthouse/api/eval/verdicts': getEvalVerdicts,
  'POST /lighthouse/api/audit-url': postAuditUrl,
  'POST /lighthouse/api/impersonate/start': postImpersonateStart,
  'GET /lighthouse/api/data/meta': getDataMeta,
  'GET /lighthouse/api/data/rows': getDataRows,
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

server.listen(PORT, HOST, () => {
  console.log(`lighthouse listening on http://${HOST}:${PORT}/lighthouse`);
});

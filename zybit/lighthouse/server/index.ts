/**
 * Lighthouse http server entrypoint.
 *
 * Step 1: only the /health route exists. Auth + routes get layered on in
 * subsequent steps.
 *
 * Run from repo root:
 *   npx tsx lighthouse/server/index.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number.parseInt(process.env.LIGHTHOUSE_PORT ?? '3001', 10);

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

const routes: Record<string, Handler> = {
  'GET /health': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'lighthouse' }));
  },
};

function notFound(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const key = `${method} ${url.pathname}`;
  const handler = routes[key];
  try {
    if (handler) {
      await handler(req, res);
    } else {
      notFound(req, res);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal', message }));
  }
});

server.listen(PORT, () => {
  console.log(`lighthouse listening on http://localhost:${PORT}`);
});

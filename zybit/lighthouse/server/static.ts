/**
 * Tiny static file server for lighthouse/web/.
 *
 * Resolves only files inside the web/ directory; refuses anything else.
 * Map of extension → content type kept narrow on purpose — we only ship
 * html/js/css/json/svg/png/ico in Lighthouse.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..', 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function serveStatic(
  relPath: string,
  res: ServerResponse,
): Promise<boolean> {
  const safeRel = relPath.replace(/^\/+/, '');
  const full = path.resolve(WEB_ROOT, safeRel);
  if (!full.startsWith(WEB_ROOT + path.sep) && full !== WEB_ROOT) {
    return false;
  }
  let body: Buffer;
  try {
    body = await readFile(full);
  } catch {
    return false;
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

export function isStaticRequest(method: string, pathname: string): string | null {
  if (method !== 'GET') return null;
  if (pathname === '/' || pathname === '/lighthouse' || pathname === '/lighthouse/') {
    return 'index.html';
  }
  if (pathname.startsWith('/lighthouse/')) {
    return pathname.slice('/lighthouse/'.length);
  }
  return null;
}

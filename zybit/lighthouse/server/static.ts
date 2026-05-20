/**
 * Tiny static file server for lighthouse/web/ and lighthouse/fake-sites/.
 *
 * - /, /lighthouse, /lighthouse/* → web/ (the GUI).
 * - /fake-sites/<slug>/<path> → fake-sites/<slug>/<path> (synthetic
 *   sites Lighthouse serves itself, e.g. the acmebank smoke scenario).
 *
 * Path-traversal guard via path.resolve + startsWith. Directory roots
 * are looked up by mount prefix in MOUNTS.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..', 'web');
const FAKE_SITES_ROOT = path.resolve(__dirname, '..', 'fake-sites');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

interface ResolvedStatic {
  root: string;
  /** Relative path from the root, no leading slash. May resolve to a directory; serveStatic appends index.html. */
  relPath: string;
}

export function resolveStaticPath(method: string, pathname: string): ResolvedStatic | null {
  if (method !== 'GET') return null;
  if (pathname === '/' || pathname === '/lighthouse' || pathname === '/lighthouse/') {
    return { root: WEB_ROOT, relPath: 'index.html' };
  }
  if (pathname.startsWith('/lighthouse/')) {
    return { root: WEB_ROOT, relPath: pathname.slice('/lighthouse/'.length) };
  }
  if (pathname === '/fake-sites' || pathname === '/fake-sites/') {
    return null; // no index for the mount root
  }
  if (pathname.startsWith('/fake-sites/')) {
    const tail = pathname.slice('/fake-sites/'.length);
    // Treat trailing-slash requests (e.g. /fake-sites/acmebank/) as index.html.
    if (tail === '' || tail.endsWith('/')) {
      return { root: FAKE_SITES_ROOT, relPath: `${tail}index.html` };
    }
    return { root: FAKE_SITES_ROOT, relPath: tail };
  }
  return null;
}

export async function serveStatic(
  resolved: ResolvedStatic,
  res: ServerResponse,
): Promise<boolean> {
  const safeRel = resolved.relPath.replace(/^\/+/, '');
  let full = path.resolve(resolved.root, safeRel);
  if (!full.startsWith(resolved.root + path.sep) && full !== resolved.root) {
    return false;
  }
  let body: Buffer;
  try {
    body = await readFile(full);
  } catch {
    // For requests like /fake-sites/acmebank/pricing (no extension), try
    // both `<rel>.html` and `<rel>/index.html` before giving up.
    const htmlAttempt = `${full}.html`;
    const indexAttempt = path.join(full, 'index.html');
    for (const candidate of [htmlAttempt, indexAttempt]) {
      if (!candidate.startsWith(resolved.root + path.sep)) continue;
      try {
        body = await readFile(candidate);
        full = candidate;
        break;
      } catch {
        /* try next */
      }
    }
    // @ts-expect-error `body` may still be unassigned if both fallbacks failed.
    if (!body) return false;
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

/**
 * Auth routes:
 *   POST /lighthouse/api/auth    body: { password }   → set session cookie
 *   POST /lighthouse/api/logout                       → clear session cookie
 *   GET  /lighthouse/api/me                           → { authenticated: boolean }
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildLogoutCookie,
  buildSessionCookie,
  checkPassword,
  isAuthenticated,
} from '../auth';

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

export async function postAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_json' }));
    return;
  }
  const password =
    body && typeof body === 'object' && 'password' in body
      ? String((body as Record<string, unknown>).password ?? '')
      : '';
  if (!checkPassword(password)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_password' }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': buildSessionCookie(),
  });
  res.end(JSON.stringify({ ok: true }));
}

export function postLogout(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': buildLogoutCookie(),
  });
  res.end(JSON.stringify({ ok: true }));
}

export function getMe(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ authenticated: isAuthenticated(req) }));
}

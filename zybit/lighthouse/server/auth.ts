/**
 * Lighthouse password gate.
 *
 * Single shared password (LIGHTHOUSE_PASSWORD env). On successful POST
 * /api/auth, we set a signed cookie:
 *
 *   lighthouse_session = <expiresMs>.<hmacHex>
 *
 * where hmacHex = HMAC-SHA256(LIGHTHOUSE_PASSWORD, expiresMs).
 *
 * On every request that needs auth, we re-verify the HMAC against the
 * current password and check that expiresMs is in the future. If the
 * password env changes, all existing cookies invalidate.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const COOKIE_NAME = 'lighthouse_session';
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getPassword(): string {
  const pw = process.env.LIGHTHOUSE_PASSWORD;
  if (!pw || pw.length < 1) {
    throw new Error(
      'LIGHTHOUSE_PASSWORD env var is required. Set it in lighthouse/.env.',
    );
  }
  return pw;
}

function sign(payload: string): string {
  return createHmac('sha256', getPassword()).update(payload).digest('hex');
}

function verify(payload: string, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkPassword(provided: string): boolean {
  const expected = getPassword();
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildSessionCookie(): string {
  const expiresMs = Date.now() + COOKIE_TTL_MS;
  const payload = String(expiresMs);
  const value = `${payload}.${sign(payload)}`;
  const expires = new Date(expiresMs).toUTCString();
  return `${COOKIE_NAME}=${value}; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax`;
}

export function buildLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function isAuthenticated(req: IncomingMessage): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 0) return false;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!verify(payload, signature)) return false;
  const expiresMs = Number.parseInt(payload, 10);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) return false;
  return true;
}

export function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (isAuthenticated(req)) return true;
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
  return false;
}

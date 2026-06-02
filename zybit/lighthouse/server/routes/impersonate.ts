/**
 * Lighthouse impersonation route — mints a real Zybit zb_session cookie
 * for the synthetic PM user that provisionLighthouseSite created for a
 * scenario. The browser sends this cookie on requests to the Next app
 * (:3000) too, because cookies on `localhost` ignore port — so the
 * embedded iframe in the Lighthouse UI loads /app/* as that user.
 *
 * Local-dev only. The cookie is set without a Domain attribute so it
 * scopes to host `localhost`. In production the Zybit app would live on
 * a different host and a separate signed-handoff endpoint would be
 * needed; we don't deploy Lighthouse anywhere yet.
 *
 * Side effect: clicking "Open as PM" overwrites any real zb_session the
 * operator has on localhost in another tab. Acceptable for a two-dev
 * internal tool — log back in if you had a real session running.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { appUsers } from '@/lib/db/schema';
import { createSession, SESSION_COOKIE, SESSION_DAYS } from '@/lib/auth/session';
import { lighthouseUserIdFor } from '../../lib/seeder/orgSite';
import { requireAuth } from '../auth';
import { readJsonBody } from '../http';

const LIGHTHOUSE_SITE_PREFIX = 'lighthouse_site_';

function jsonError(res: ServerResponse, status: number, error: string, detail?: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(detail ? { error, detail } : { error }));
}

function buildZbSessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  // Mirror sessionCookieOptions from src/lib/auth/session.ts but format
  // as a raw Set-Cookie header (the Next app uses cookies().set()).
  // No Domain attribute → browser scopes to host `localhost`.
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export async function postImpersonateStart(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAuth(req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonError(res, 400, 'bad_json');
  }
  const params = (body ?? {}) as { siteId?: unknown; redirectPath?: unknown };
  const siteId = typeof params.siteId === 'string' ? params.siteId : '';
  const redirectPath =
    typeof params.redirectPath === 'string' && params.redirectPath.startsWith('/app/')
      ? params.redirectPath
      : '/app/loop';
  if (!siteId) return jsonError(res, 400, 'missing_siteId');
  if (!siteId.startsWith(LIGHTHOUSE_SITE_PREFIX)) {
    return jsonError(res, 400, 'not_a_lighthouse_site', siteId);
  }
  const slug = siteId.slice(LIGHTHOUSE_SITE_PREFIX.length);
  if (!slug) return jsonError(res, 400, 'invalid_siteId', siteId);

  const userId = lighthouseUserIdFor(slug);

  // Make sure the synthetic user row exists. Without it, getSessionUser
  // would inner-join on app_users and return null — minting a cookie
  // for a non-existent user produces a confusing "logged out" loop in
  // the iframe instead of a clear error here.
  const db = getDb();
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!user) {
    return jsonError(
      res,
      404,
      'synthetic_user_missing',
      `run a scenario for "${slug}" first so the synthetic user is provisioned`,
    );
  }

  const token = await createSession(userId);
  const base = process.env.ZYBIT_APP_BASE_URL ?? 'http://localhost:3000';
  const embedUrl = `${base.replace(/\/$/, '')}${redirectPath}?siteId=${encodeURIComponent(siteId)}`;

  res.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': buildZbSessionCookie(token),
  });
  res.end(JSON.stringify({ ok: true, embedUrl }));
}

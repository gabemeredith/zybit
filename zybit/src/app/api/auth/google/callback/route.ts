import { NextRequest, NextResponse, after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accessRequests, appUsers } from '@/lib/db/schema';
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getGoogleConfig,
  OAUTH_STATE_COOKIE,
} from '@/lib/auth/google';
import { createSession, sessionCookieOptions } from '@/lib/auth/session';
import { Resend } from 'resend';

export const runtime = 'nodejs';

function clearState(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/' });
  return response;
}

export async function GET(request: NextRequest) {
  const config = getGoogleConfig();
  if (!config) {
    return NextResponse.redirect(new URL('/sign-in?error=google-unavailable', request.url));
  }

  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  // State must be present on both sides and match — defeats CSRF / replayed
  // callbacks. Also covers Google's `error` param (user denied) since `code`
  // will be absent.
  if (!code || !state || !cookieState || state !== cookieState) {
    return clearState(NextResponse.redirect(new URL('/sign-in?error=google-failed', request.url)));
  }

  // Guard the external token exchange + userinfo fetch: a network timeout or
  // malformed JSON from Google would otherwise throw and surface a generic 500
  // instead of a graceful "try again" redirect.
  let info: Awaited<ReturnType<typeof fetchGoogleUserInfo>> = null;
  try {
    const accessToken = await exchangeGoogleCode(config, code);
    if (accessToken) info = await fetchGoogleUserInfo(accessToken);
  } catch (err) {
    console.error('[google/callback] OAuth exchange failed:', err);
  }

  if (!info || !info.emailVerified) {
    return clearState(NextResponse.redirect(new URL('/sign-in?error=google-failed', request.url)));
  }

  const db = getDb();

  // Resolve to an approved user. Match on google_sub first (a returning Google
  // user), then fall back to email (first Google login for an approved user who
  // set up via the email path) and link the sub.
  const [byGoogle] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.googleSub, info.sub), eq(appUsers.status, 'approved')))
    .limit(1);

  let userId = byGoogle?.id ?? null;

  if (!userId) {
    const [byEmail] = await db
      .select({ id: appUsers.id, googleSub: appUsers.googleSub })
      .from(appUsers)
      .where(and(eq(appUsers.email, info.email), eq(appUsers.status, 'approved')))
      .limit(1);
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== info.sub) {
        // The account is already bound to a DIFFERENT Google identity. We
        // reached the email fallback only because the sub lookup missed, so a
        // verified-email match here would let a second Google account hijack
        // the binding. Refuse the Google path; they can still use password.
        return clearState(
          NextResponse.redirect(new URL('/sign-in?error=google-mismatch', request.url)),
        );
      }
      userId = byEmail.id;
      // First Google login for an approved user who set up via the email path:
      // link the sub. (If it were already set to info.sub the byGoogle lookup
      // would have matched, so here it is always null.)
      if (!byEmail.googleSub) {
        await db
          .update(appUsers)
          .set({ googleSub: info.sub, authProvider: 'google' })
          .where(eq(appUsers.id, byEmail.id));
      }
    }
  }

  if (!userId) {
    // Not an approved user. If they're a known pending lead, say so; otherwise
    // point them at the request-access front door.
    const [pending] = await db
      .select({ status: accessRequests.status })
      .from(accessRequests)
      .where(and(eq(accessRequests.email, info.email), eq(accessRequests.status, 'pending')))
      .limit(1);
    const notice = pending ? 'pending' : 'no-account';
    return clearState(
      NextResponse.redirect(new URL(`/sign-in?notice=${notice}`, request.url)),
    );
  }

  const sessionToken = await createSession(userId);
  const response = NextResponse.redirect(new URL('/app', request.url));
  response.cookies.set(sessionCookieOptions.name, sessionToken, {
    httpOnly: sessionCookieOptions.httpOnly,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
    path: sessionCookieOptions.path,
    maxAge: sessionCookieOptions.maxAge,
  });
  after(async () => {
    const key = process.env.RESEND_API_KEY;
    const to = process.env.INTAKE_NOTIFY_EMAIL ?? 'asad@getzybit.com';
    if (!key) return;
    try {
      await new Resend(key).emails.send({
        from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>',
        to,
        subject: `[Zybit] Google login — ${info.email}`,
        html: `<p style="font-family:sans-serif;font-size:15px"><strong>${info.email}</strong> just signed in via Google.</p>`,
      });
    } catch { /* best-effort */ }
  });
  return clearState(response);
}

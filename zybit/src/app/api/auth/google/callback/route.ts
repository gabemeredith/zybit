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
import { upsertAccessRequest } from '@/lib/auth/accessRequests';
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
    // Not an approved user. Approval is a deliberate human act — we don't grant
    // platform access on Google sign-in alone (we need to verify they actually
    // own the site/domain they want to onboard). Treat the Google sign-in as a
    // lead: upsert into the access_requests queue if not already there, then
    // notify the founder + send the user a "we'll be in touch" confirmation.
    const [existing] = await db
      .select({ status: accessRequests.status })
      .from(accessRequests)
      .where(eq(accessRequests.email, info.email))
      .limit(1);

    const isNewLead = !existing;
    if (isNewLead) {
      try {
        await upsertAccessRequest({
          email: info.email,
          source: 'google_oauth',
        });
      } catch (err) {
        console.error('[google/callback] access_request upsert failed:', err);
      }
    }

    // Notify founder + confirm to user — fire-and-forget. Only for NEW leads,
    // so a returning unapproved user clicking "Continue with Google" repeatedly
    // doesn't spam the inbox.
    if (isNewLead) {
      const userEmail = info.email;
      const userName = info.name;
      after(async () => {
        const key = process.env.RESEND_API_KEY;
        if (!key) return;
        const resend = new Resend(key);
        const from = process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>';
        const founder = process.env.INTAKE_NOTIFY_EMAIL ?? 'asad@getzybit.com';
        try {
          await resend.emails.send({
            from,
            to: founder,
            subject: `[Zybit] New Google sign-up — ${userEmail}`,
            html: `<p style="font-family:sans-serif;font-size:15px"><strong>${userEmail}</strong>${userName ? ` (${userName})` : ''} just signed up via Google. Approve in /admin.</p>`,
          });
        } catch { /* best-effort */ }
        try {
          await resend.emails.send({
            from,
            to: userEmail,
            subject: 'Thanks for signing up — Zybit',
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
                <p style="font-size:14px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6B6B6B;margin:0 0 24px">Zybit</p>
                <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0 0 16px;color:#111">Thanks${userName ? `, ${userName.split(' ')[0]}` : ''}.</h1>
                <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px">
                  We got your sign-up. Zybit is a closed pilot — we onboard every customer 1:1 so we can verify the site you want analysed and tune the setup with you.
                </p>
                <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px">
                  I'll reach out personally in the next day or two to set up a short call. If you want to grab a slot now, you can book one here: <a href="https://calendly.com/asad-getzybit/30min" style="color:#111;font-weight:600">calendly.com/asad-getzybit/30min</a>.
                </p>
                <p style="font-size:13px;color:#6B6B6B;margin:24px 0 0">— Asad, Zybit</p>
              </div>
            `,
          });
        } catch { /* best-effort */ }
      });
    }

    return clearState(
      NextResponse.redirect(new URL('/sign-in?notice=pending', request.url)),
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

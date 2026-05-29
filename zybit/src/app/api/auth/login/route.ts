import { NextResponse, after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accessRequests, appUsers } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, sessionCookieOptions } from '@/lib/auth/session';
import { checkAuthRateLimit, LOGIN_EMAIL_LIMIT } from '@/lib/auth/rateLimit';
import { Resend } from 'resend';

// node:crypto (scrypt) + drizzle require the Node runtime.
export const runtime = 'nodejs';

const GENERIC_ERROR = 'Incorrect email or password.';
// Humane copy for known-but-not-yet-approved leads (closed-pilot tradeoff:
// this confirms the email is a known lead — see the enumeration note in
// docs/sprints/onboarding-redesign.md). Unknown emails stay generic.
const PENDING_MESSAGE = "We haven't approved you yet — we'll be in touch soon.";
const NO_PASSWORD_MESSAGE =
  "You haven't set a password yet. Use the link in your welcome email, or continue with Google.";

function extractIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: Request) {
  let email: string;
  let password: string;
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }
    if (typeof body.password !== 'string' || body.password.length === 0) {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const ip = extractIp(request);
  const rateLimit = await checkAuthRateLimit(email, ip, { emailLimit: LOGIN_EMAIL_LIMIT });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const db = getDb();
  const [user] = await db
    .select({
      id: appUsers.id,
      status: appUsers.status,
      passwordHash: appUsers.passwordHash,
    })
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);

  if (user && user.status === 'approved') {
    if (!user.passwordHash) {
      return NextResponse.json(
        { code: 'no-password', error: NO_PASSWORD_MESSAGE },
        { status: 403 },
      );
    }
    if (await verifyPassword(password, user.passwordHash)) {
      const token = await createSession(user.id);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(sessionCookieOptions.name, token, {
        httpOnly: sessionCookieOptions.httpOnly,
        secure: sessionCookieOptions.secure,
        sameSite: sessionCookieOptions.sameSite,
        path: sessionCookieOptions.path,
        maxAge: sessionCookieOptions.maxAge,
      });
      // Notify founder — fire-and-forget after response is sent.
      after(async () => {
        const key = process.env.RESEND_API_KEY;
        const to = process.env.INTAKE_NOTIFY_EMAIL ?? 'asad@getzybit.com';
        if (!key) return;
        try {
          await new Resend(key).emails.send({
            from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>',
            to,
            subject: `[Zybit] Login — ${email}`,
            html: `<p style="font-family:sans-serif;font-size:15px"><strong>${email}</strong> just signed in.</p>`,
          });
        } catch { /* best-effort */ }
      });
      return response;
    }
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  // No approved user. If this email is a known pending lead, surface the
  // humane "not approved yet" message. Otherwise stay generic.
  const [pending] = await db
    .select({ status: accessRequests.status })
    .from(accessRequests)
    .where(and(eq(accessRequests.email, email), eq(accessRequests.status, 'pending')))
    .limit(1);

  if (pending) {
    return NextResponse.json({ code: 'pending', error: PENDING_MESSAGE }, { status: 403 });
  }

  return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
}

import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { appUsers } from '@/lib/db/schema';
import { signSetPasswordToken } from '@/lib/auth/setPasswordToken';
import { sendWelcomeEmail } from '@/lib/email/welcomeEmail';
import { checkAuthRateLimit } from '@/lib/auth/rateLimit';

// node:crypto (HMAC) + drizzle + Resend require the Node runtime.
export const runtime = 'nodejs';

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://getzybit.com').replace(/\/$/, '');
}

function extractIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// Generic OK to prevent email enumeration.
const GENERIC_OK = { message: 'If that email has an approved account without a password, a set-up link is on its way.' };

export async function POST(request: Request) {
  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const ip = extractIp(request);
  const rateLimit = await checkAuthRateLimit(email, ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const db = getDb();
  const [user] = await db
    .select({ id: appUsers.id, passwordHash: appUsers.passwordHash })
    .from(appUsers)
    .where(and(eq(appUsers.email, email), eq(appUsers.status, 'approved')))
    .limit(1);

  // Only send if approved and genuinely has no password — don't let this
  // become a reset vector for users who already have one.
  if (user && !user.passwordHash) {
    try {
      const token = signSetPasswordToken(email);
      await sendWelcomeEmail({
        email,
        setPasswordUrl: `${appBaseUrl()}/set-password?token=${encodeURIComponent(token)}`,
        googleSignInUrl: `${appBaseUrl()}/api/auth/google/start`,
      });
    } catch (err) {
      console.error('[auth/resend-setup] email send failed:', err);
    }
  }

  return NextResponse.json(GENERIC_OK);
}

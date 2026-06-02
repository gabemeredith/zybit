import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createMagicLink } from '@/lib/auth/session';
import { checkAuthRateLimit } from '@/lib/auth/rateLimit';

function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://getzybit.com').replace(/\/$/, '');
}

function extractIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

const GENERIC_OK = { message: "If that email is approved, a sign-in link is on its way." };

export async function POST(request: Request) {
  let email: string;
  try {
    const body = await request.json() as { email?: unknown };
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
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const token = await createMagicLink(email);

  // Always return the same response regardless of whether the email exists,
  // to prevent account enumeration.
  if (!token) return NextResponse.json(GENERIC_OK);

  const baseUrl = getBaseUrl();
  const link = `${baseUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>',
      to: email,
      subject: 'Your Zybit sign-in link',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <p style="font-size:14px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6B6B6B;margin:0 0 24px">Zybit</p>
          <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.03em;margin:0 0 16px;color:#111">Sign in to Zybit</h1>
          <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 28px">
            Click the button below to sign in. This link expires in 15 minutes and can only be used once.
          </p>
          <a href="${link}" style="display:inline-block;background:#111;color:#FAFAF8;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;border:2px solid #111">
            Sign in to Zybit
          </a>
          <p style="font-size:12px;color:#6B6B6B;margin:28px 0 0;line-height:1.6">
            If you didn't request this link, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[auth/request-link] email send failed:', err);
    // Still return OK — don't reveal email delivery failures to the caller.
  }

  return NextResponse.json(GENERIC_OK);
}

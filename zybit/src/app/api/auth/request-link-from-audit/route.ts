import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { Resend } from 'resend';
import { getDb } from '@/lib/db/client';
import { createMagicLink } from '@/lib/auth/session';
import { checkAuthRateLimit } from '@/lib/auth/rateLimit';
import { verifyAuditSignupParam } from '@/lib/audit/cookies';

// node:crypto via Resend SDK + drizzle pool require Node runtime.
export const runtime = 'nodejs';

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_BASE_URL ??
    'https://getzybit.com'
  ).replace(/\/$/, '');
}

function extractIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function redirectToAudit(auditId: string, query: string): NextResponse {
  return NextResponse.redirect(`${appBaseUrl()}/audit/${auditId}?${query}`, { status: 302 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const email = req.nextUrl.searchParams.get('e');
  const auditId = req.nextUrl.searchParams.get('a');
  const sig = req.nextUrl.searchParams.get('s');

  if (!email || !auditId || !sig) {
    return NextResponse.json({ error: 'missing-params' }, { status: 400 });
  }
  if (!verifyAuditSignupParam(email, auditId, sig)) {
    return NextResponse.json({ error: 'bad-signature' }, { status: 400 });
  }

  // Confirm the audit row exists and the email actually matches what was
  // submitted — defense-in-depth against a leaked secret being used to
  // request links for arbitrary email/auditId pairs.
  const db = getDb();
  const result = await db.execute<{ id: string; email: string }>(sql`
    SELECT id, email FROM public_audits WHERE id = ${auditId} LIMIT 1
  `);
  const audit = result.rows[0];
  if (!audit || audit.email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: 'audit-not-found' }, { status: 400 });
  }

  const ip = extractIp(req);
  const limit = await checkAuthRateLimit(email, ip);
  if (!limit.allowed) {
    return redirectToAudit(auditId, 'signin=rate-limited');
  }

  const token = await createMagicLink(email);
  if (!token) {
    // User isn't provisioned (fail-soft path from confirm/route.ts triggered,
    // or status='revoked'). Surface that to the user instead of silently
    // succeeding — the /audit/[id] page reads ?signin=no-account.
    return redirectToAudit(auditId, 'signin=no-account');
  }

  const link = `${appBaseUrl()}/api/auth/callback?token=${encodeURIComponent(token)}`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@getzybit.com>',
      to: email,
      subject: 'Your Zybit sign-in link',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
          <p style="font-size:14px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6B6B6B;margin:0 0 24px">Zybit</p>
          <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.03em;margin:0 0 16px;color:#111">Sign in to Zybit</h1>
          <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 28px">
            Click the button below to sign in and see your audit findings in the dashboard. This link expires in 15 minutes and can only be used once.
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
    console.error('[auth/request-link-from-audit] email send failed', {
      auditId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Still redirect — don't reveal email-delivery failures.
  }

  const params = new URLSearchParams({ signin: 'sent', email });
  return redirectToAudit(auditId, params.toString());
}

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { isPersonalEmail } from '@/lib/audit/personalEmailDomains';
import { validatePublicUrl } from '@/lib/audit/urlValidator';
import { checkPublicAuditRateLimit, checkDailyBudget } from '@/lib/audit/publicAuditRateLimit';
import { runStructuralAudit } from '@/lib/intake/structuralAudit';
import { sendAuditConfirmationEmail } from '@/lib/email/auditConfirmationEmail';

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

function extractEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Kill-switch: allow disabling via env var without a deploy
  if (process.env.PUBLIC_AUDIT_ENABLED === '0') {
    return NextResponse.json({ error: 'Audit requests are paused.' }, { status: 503 });
  }

  let body: { url?: string; email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { url: rawUrl, email: rawEmail, role } = body ?? {};

  // ── Input validation ─────────────────────────────────────────────────────

  if (!rawUrl || typeof rawUrl !== 'string') {
    return NextResponse.json({ error: 'url is required.' }, { status: 400 });
  }
  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  }
  if (!role || typeof role !== 'string') {
    return NextResponse.json({ error: 'role is required.' }, { status: 400 });
  }

  const email = rawEmail.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  if (isPersonalEmail(email)) {
    return NextResponse.json(
      {
        error:
          'The audit report is built for product teams — work email required. ' +
          'Personal addresses (Gmail, etc.) can\'t open a conversation about your funnel.',
      },
      { status: 400 },
    );
  }

  // ── SSRF — validate the URL before any network access ───────────────────

  const validation = await validatePublicUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }
  const { url: parsedUrl } = validation;
  const targetHost = parsedUrl.hostname.replace(/^www\./, '');
  const domain = targetHost;

  // ── Rate limits ─────────────────────────────────────────────────────────

  const ip = clientIp(req);
  const emailDomain = extractEmailDomain(email);

  const rateLimit = await checkPublicAuditRateLimit({ ip, email, emailDomain, targetHost });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: rateLimit.reason },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds
          ? { 'Retry-After': String(rateLimit.retryAfterSeconds) }
          : {},
      },
    );
  }

  const budget = await checkDailyBudget();
  if (!budget.allowed) {
    return NextResponse.json({ error: budget.reason }, { status: 429 });
  }

  // ── Quick structural audit (teaser finding) ──────────────────────────────
  // ~5-10 seconds. Gives the user a real finding before they confirm.

  const structuralResult = await runStructuralAudit(parsedUrl.toString());
  const teaserFinding =
    structuralResult.status === 'ok' ? structuralResult.finding : null;

  // ── Persist audit row ────────────────────────────────────────────────────

  const db = getDb();
  const auditId = `pub_${randomBytes(12).toString('hex')}`;

  await db.execute(sql`
    INSERT INTO public_audits (id, email, domain, url, role, status, ip, teaser_finding, submitted_at)
    VALUES (
      ${auditId},
      ${email},
      ${domain},
      ${parsedUrl.toString()},
      ${role},
      'pending',
      ${ip},
      ${teaserFinding ? JSON.stringify(teaserFinding) : null},
      now()
    )
  `);

  // ── Verification token ───────────────────────────────────────────────────

  const tokenRaw = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(tokenRaw).digest('hex');
  const tokenId = `tok_${randomBytes(8).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  await db.execute(sql`
    INSERT INTO audit_tokens (id, audit_id, token_hash, expires_at)
    VALUES (${tokenId}, ${auditId}, ${tokenHash}, ${expiresAt})
  `);

  // ── Confirmation email ───────────────────────────────────────────────────

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_BASE_URL ??
    'https://getzybit.com';

  const confirmationUrl = `${appUrl}/api/audit/public/confirm?token=${tokenRaw}`;
  const unsubscribeUrl = `${appUrl}/audit/unsubscribe?token=${tokenHash}`;

  const expiresHuman = `${utcDateString()} at 11:59 PM UTC (24 hours from now)`;

  await sendAuditConfirmationEmail({
    domain,
    recipientEmail: email,
    confirmationUrl,
    expiresAtHuman: expiresHuman,
    unsubscribeUrl,
  });

  return NextResponse.json({
    auditId,
    domain,
    teaserFinding,
  });
}

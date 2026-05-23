import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import { getDb } from '@/lib/db/client';

type TokenRow = {
  id: string;
  audit_id: string;
  expires_at: string;
  consumed_at: string | null;
};

type AuditRow = {
  id: string;
  status: string;
  email: string;
  domain: string;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return htmlError('Invalid or missing confirmation token.');
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const db = getDb();

  // Look up token
  const tokenResult = await db.execute<TokenRow>(sql`
    SELECT id, audit_id, expires_at, consumed_at
    FROM audit_tokens
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `);

  const row = tokenResult.rows[0] as TokenRow | undefined;
  if (!row) {
    return htmlError('Confirmation link not found. It may have already been used.');
  }

  if (row.consumed_at) {
    // Already confirmed — redirect to the audit page if we can find it
    return redirectToAudit(row.audit_id);
  }

  if (new Date(row.expires_at) < new Date()) {
    return htmlError('This confirmation link has expired. Request a new audit to get a fresh one.');
  }

  // Look up audit
  const auditResult = await db.execute<AuditRow>(sql`
    SELECT id, status, email, domain FROM public_audits WHERE id = ${row.audit_id} LIMIT 1
  `);
  const audit = auditResult.rows[0] as AuditRow | undefined;
  if (!audit) {
    return htmlError('Audit record not found.');
  }

  if (audit.status !== 'pending') {
    // Already triggered — just redirect
    return redirectToAudit(audit.id);
  }

  // Consume token + mark audit as running atomically
  await db.execute(sql`
    UPDATE audit_tokens SET consumed_at = now() WHERE id = ${row.id}
  `);
  await db.execute(sql`
    UPDATE public_audits SET status = 'running', confirmed_at = now()
    WHERE id = ${audit.id} AND status = 'pending'
  `);

  // Kick off the pipeline asynchronously. The confirm endpoint responds
  // immediately; the run endpoint does the heavy lifting (45-90s) and sends
  // the report email when done.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_BASE_URL ??
    'https://getzybit.com';
  const cronSecret = process.env.FORGE_CRON_SECRET ?? '';
  const runUrl = `${appUrl}/api/audit/public/run`;
  const auditId = audit.id;

  after(async () => {
    try {
      await fetch(runUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ auditId }),
      });
    } catch {
      // Non-fatal: the run endpoint will be retried when the client polls
    }
  });

  return redirectToAudit(audit.id);
}

function redirectToAudit(auditId: string): NextResponse {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_BASE_URL ??
    'https://getzybit.com';
  return NextResponse.redirect(`${appUrl}/audit/${auditId}`, { status: 302 });
}

function htmlError(message: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Confirmation error — Zybit</title>
  <style>
    body { margin: 0; padding: 60px 24px; background: #EFEEE9; font-family: -apple-system, BlinkMacSystemFont, Inter, sans-serif; }
    .card { max-width: 480px; margin: 0 auto; background: #FAFAF8; border: 2px solid #111; box-shadow: 6px 6px 0 #111; padding: 32px 28px; }
    h1 { margin: 0 0 16px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #111; }
    p { margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #444; }
    a { display: inline-block; padding: 12px 24px; background: #111; color: #FAFAF8; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Something went wrong</h1>
    <p>${message}</p>
    <a href="/audit">Request a new audit →</a>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

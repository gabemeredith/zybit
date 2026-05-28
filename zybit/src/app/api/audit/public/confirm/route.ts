import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import { getDb } from '@/lib/db/client';
import { auditCookieOptions, signAuditCookie } from '@/lib/audit/cookies';

// node:crypto + after() require the Node runtime — pin so an Edge default
// flip can't break this route silently.
export const runtime = 'nodejs';

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
  role: string;
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
    return redirectToAudit(row.audit_id, { setCookie: false });
  }

  if (new Date(row.expires_at) < new Date()) {
    return htmlError('This confirmation link has expired. Request a new audit to get a fresh one.');
  }

  // Look up audit
  const auditResult = await db.execute<AuditRow>(sql`
    SELECT id, status, email, domain, role FROM public_audits WHERE id = ${row.audit_id} LIMIT 1
  `);
  const audit = auditResult.rows[0] as AuditRow | undefined;
  if (!audit) {
    return htmlError('Audit record not found.');
  }

  if (audit.status !== 'pending') {
    // Already triggered — just redirect.
    return redirectToAudit(audit.id, { setCookie: false });
  }

  // Atomic token consumption — only the first concurrent caller wins the row.
  // neon-http doesn't support db.transaction, so we rely on a conditional
  // UPDATE … RETURNING to dedupe instead.
  const consumed = await db.execute(sql`
    UPDATE audit_tokens SET consumed_at = now()
    WHERE id = ${row.id} AND consumed_at IS NULL
    RETURNING id
  `);
  if ((consumed.rows as unknown[]).length === 0) {
    // Concurrent click already consumed this token — redirect without re-dispatching.
    return redirectToAudit(audit.id, { setCookie: false });
  }

  const auditUpdate = await db.execute(sql`
    UPDATE public_audits SET status = 'running', confirmed_at = now()
    WHERE id = ${audit.id} AND status = 'pending'
    RETURNING id
  `);
  if ((auditUpdate.rows as unknown[]).length === 0) {
    // Status changed under us (race with another path) — don't dispatch a second run.
    return redirectToAudit(audit.id, { setCookie: false });
  }

  // Auto-provision an approved appUsers row + organization for this email so
  // the report-email signup CTA can drop them straight into the dashboard.
  // Fail-soft: if either insert errors, the audit still runs and the user
  // still gets the report. The signup CTA falls back to the existing
  // request-link flow which will surface "no account" and let them request
  // access manually.
  await autoProvisionUser(audit.email, audit.domain, audit.id, audit.role);

  // Kick off the pipeline asynchronously. The confirm endpoint responds
  // immediately; the run endpoint does the heavy lifting (45-90s) and sends
  // the report email when done. Using req.nextUrl.origin so preview deploys
  // hit themselves rather than the production host.
  const cronSecret = process.env.FORGE_CRON_SECRET ?? '';
  const runUrl = new URL('/api/audit/public/run', req.nextUrl.origin).toString();
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
      // Dispatch failed — the audit is stuck in 'running' until an operator
      // re-fires /api/audit/public/run with this auditId. There is no
      // automatic retry; the status poller only reads state, it doesn't
      // re-trigger the pipeline.
    }
  });

  return redirectToAudit(audit.id, { setCookie: true });
}

// `setCookie` is intentionally required at the call site: the audit
// confirmation cookie binds /api/audit/public/status to a single auditId,
// so overwriting it from "already consumed" / "already triggered" /
// concurrent-dedupe branches would clobber a different in-flight audit's
// cookie. Only the success path that just provisioned the user gets it.
function redirectToAudit(
  auditId: string,
  opts: { setCookie: boolean },
): NextResponse {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_BASE_URL ??
    'https://getzybit.com';
  const response = NextResponse.redirect(`${appUrl}/audit/${auditId}`, { status: 302 });
  if (opts.setCookie) {
    response.cookies.set({
      ...auditCookieOptions,
      value: signAuditCookie(auditId),
    });
  }
  return response;
}

async function autoProvisionUser(
  email: string,
  domain: string,
  auditId: string,
  roleTitle: string,
): Promise<void> {
  const db = getDb();
  try {
    // Skip everything if the user already exists — they keep their existing
    // org. Cheaper than catching a unique-constraint violation downstream.
    const existing = await db.execute<{ id: string }>(sql`
      SELECT id FROM app_users WHERE email = ${email} LIMIT 1
    `);
    if (existing.rows.length > 0) return;

    // Org + user in a single CTE — neon-http has no transaction support, but
    // a single statement is atomic per Postgres semantics. If the user
    // INSERT fails (e.g. unique-conflict on email from a race), the org
    // is still committed. That's tolerable per the fail-soft contract:
    // worst case is one orphaned organizations row.
    const orgId = randomUUID();
    const userId = randomUUID();
    await db.execute(sql`
      WITH new_org AS (
        INSERT INTO organizations (id, name)
        VALUES (${orgId}, ${domain})
        RETURNING id
      )
      INSERT INTO app_users (id, email, organization_id, role, role_title, source, source_audit_id)
      SELECT ${userId}, ${email}, new_org.id, 'admin', ${roleTitle}, 'public_audit', ${auditId}
      FROM new_org
      ON CONFLICT (email) DO NOTHING
    `);
  } catch (err) {
    // Log auditId only — operators can join back to the audit row in psql /
    // /admin/ops to recover the email. Keeps PII out of platform access logs,
    // matching the privacy posture in request-link-from-audit/route.ts.
    console.error('[audit/confirm] auto-provision failed', {
      auditId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

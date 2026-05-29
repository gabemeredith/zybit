import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db/client';
import { accessRequests, appUsers, organizations } from '@/lib/db/schema';
import { verifyAdminCookie, ADMIN_COOKIE } from '@/lib/auth/adminSession';
import { signSetPasswordToken } from '@/lib/auth/setPasswordToken';
import { sendWelcomeEmail } from '@/lib/email/welcomeEmail';

// node:crypto + drizzle + Resend require the Node runtime.
export const runtime = 'nodejs';

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? 'https://getzybit.com').replace(/\/$/, '');
}

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select({
      id: accessRequests.id,
      email: accessRequests.email,
      domain: accessRequests.domain,
      roleTitle: accessRequests.roleTitle,
      analyticsTool: accessRequests.analyticsTool,
      source: accessRequests.source,
      status: accessRequests.status,
      stripePaymentLink: accessRequests.stripePaymentLink,
      notes: accessRequests.notes,
      requestedAt: accessRequests.requestedAt,
      reviewedAt: accessRequests.reviewedAt,
    })
    .from(accessRequests)
    .orderBy(accessRequests.requestedAt);
  return NextResponse.json({ requests: rows });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: { id?: unknown; action?: unknown; orgName?: unknown; stripePaymentLink?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!id || !['approve', 'reject', 'save-payment-link'].includes(action)) {
    return NextResponse.json({ error: 'Missing id or valid action.' }, { status: 400 });
  }

  const db = getDb();
  const [req] = await db
    .select({
      id: accessRequests.id,
      email: accessRequests.email,
      domain: accessRequests.domain,
      roleTitle: accessRequests.roleTitle,
      source: accessRequests.source,
      status: accessRequests.status,
    })
    .from(accessRequests)
    .where(eq(accessRequests.id, id))
    .limit(1);

  if (!req) {
    return NextResponse.json({ error: 'Access request not found.' }, { status: 404 });
  }

  const stripePaymentLink =
    typeof body.stripePaymentLink === 'string' && body.stripePaymentLink.trim()
      ? body.stripePaymentLink.trim()
      : null;

  if (action === 'save-payment-link') {
    await db
      .update(accessRequests)
      .set({ stripePaymentLink })
      .where(eq(accessRequests.id, id));
    return NextResponse.json({ ok: true, stripePaymentLink });
  }

  if (action === 'reject') {
    await db
      .update(accessRequests)
      .set({ status: 'rejected', reviewedAt: new Date(), reviewedBy: 'admin' })
      .where(eq(accessRequests.id, id));
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // action === 'approve' — mint org + approved user, then send the welcome
  // email with the set-password link. Idempotent on email: if an approved user
  // already exists we just mark the request invited.
  const orgName =
    typeof body.orgName === 'string' && body.orgName.trim()
      ? body.orgName.trim()
      : req.domain ?? req.email;

  const [existing] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.email, req.email))
    .limit(1);

  if (!existing) {
    const orgId = `org_${randomUUID().replace(/-/g, '')}`;
    const userId = randomUUID();
    await db.batch([
      db.insert(organizations).values({ id: orgId, name: orgName }).onConflictDoNothing(),
      db.insert(appUsers).values({
        id: userId,
        email: req.email,
        organizationId: orgId,
        role: 'admin',
        status: 'approved',
        roleTitle: req.roleTitle ?? null,
        source: req.source,
      }),
    ]);
  } else {
    // Re-approving a previously-revoked or existing user: ensure approved.
    await db.update(appUsers).set({ status: 'approved' }).where(eq(appUsers.id, existing.id));
  }

  await db
    .update(accessRequests)
    .set({
      status: 'invited',
      reviewedAt: new Date(),
      reviewedBy: 'admin',
      ...(stripePaymentLink ? { stripePaymentLink } : {}),
    })
    .where(eq(accessRequests.id, id));

  // Send the welcome email with the one-time set-password link. Fail-soft: the
  // user is provisioned regardless; the operator can resend if mail fails.
  let emailSent = true;
  try {
    const token = signSetPasswordToken(req.email);
    await sendWelcomeEmail({
      email: req.email,
      setPasswordUrl: `${appBaseUrl()}/set-password?token=${encodeURIComponent(token)}`,
      googleSignInUrl: `${appBaseUrl()}/api/auth/google/start`,
    });
  } catch (err) {
    emailSent = false;
    console.error('[admin/access-requests] welcome email failed', {
      requestId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true, status: 'invited', emailSent });
}

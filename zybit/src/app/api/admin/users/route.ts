import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { Resend } from 'resend';
import { getDb } from '@/lib/db/client';
import { appUsers, organizations } from '@/lib/db/schema';
import { verifyAdminCookie, ADMIN_COOKIE } from '@/lib/auth/adminSession';
import { createMagicLink } from '@/lib/auth/session';

function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://getzybit.com').replace(/\/$/, '');
}

async function requireAdmin(request: NextRequest): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const db = getDb();
  const users = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      organizationId: appUsers.organizationId,
      role: appUsers.role,
      status: appUsers.status,
      createdAt: appUsers.createdAt,
    })
    .from(appUsers)
    .orderBy(appUsers.createdAt);
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let email: string, orgName: string;
  try {
    const body = await request.json() as { email?: unknown; orgName?: unknown };
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
    orgName = typeof body.orgName === 'string' && body.orgName.trim()
      ? body.orgName.trim()
      : email;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const db = getDb();

  // Check for duplicate email
  const [existing] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: 'A user with that email already exists.' }, { status: 409 });
  }

  // Create org + user
  const orgId = `org_${randomUUID().replace(/-/g, '')}`;
  const userId = randomUUID();

  await db.batch([
    db.insert(organizations).values({ id: orgId, name: orgName }).onConflictDoNothing(),
    db.insert(appUsers).values({
      id: userId,
      email,
      organizationId: orgId,
      role: 'member',
      status: 'approved',
    }),
  ]);

  // Send invite email with a ready-to-use sign-in link.
  try {
    const token = await createMagicLink(email);
    if (token) {
      const link = `${getBaseUrl()}/api/auth/callback?token=${encodeURIComponent(token)}`;
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>',
        to: email,
        subject: "You've been invited to Zybit",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <p style="font-size:14px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6B6B6B;margin:0 0 24px">Zybit</p>
            <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.03em;margin:0 0 16px;color:#111">You're in.</h1>
            <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 28px">
              Your Zybit account is ready. Click the button below to sign in — this link expires in 15 minutes.
            </p>
            <a href="${link}" style="display:inline-block;background:#111;color:#FAFAF8;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;border:2px solid #111">
              Sign in to Zybit
            </a>
            <p style="font-size:12px;color:#6B6B6B;margin:28px 0 0;line-height:1.6">
              If you didn't expect this, you can safely ignore this email.
            </p>
          </div>
        `,
      });
    }
  } catch (err) {
    console.error('[admin/users] invite email failed:', err);
  }

  return NextResponse.json({ userId, orgId, email });
}

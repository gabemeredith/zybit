import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { appUsers } from '@/lib/db/schema';
import { hashPassword, isAcceptablePassword } from '@/lib/auth/password';
import { verifySetPasswordToken } from '@/lib/auth/setPasswordToken';
import { createSession, sessionCookieOptions } from '@/lib/auth/session';

// node:crypto (scrypt) + drizzle require the Node runtime.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let token: string;
  let password: string;
  try {
    const body = (await request.json()) as { token?: unknown; password?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
    }
    if (typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
    }
    token = body.token;
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!isAcceptablePassword(password)) {
    return NextResponse.json(
      { error: 'Password must be between 8 and 200 characters.' },
      { status: 400 },
    );
  }

  const email = verifySetPasswordToken(token);
  if (!email) {
    return NextResponse.json(
      { error: 'This link is invalid or has expired. Ask us for a fresh one.' },
      { status: 400 },
    );
  }

  const db = getDb();
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.email, email), eq(appUsers.status, 'approved')))
    .limit(1);

  // The token verified but no approved user exists — don't leak which case it
  // is; the link simply can't be used yet.
  if (!user) {
    return NextResponse.json(
      { error: 'This link is invalid or has expired. Ask us for a fresh one.' },
      { status: 400 },
    );
  }

  await db
    .update(appUsers)
    .set({ passwordHash: hashPassword(password), authProvider: 'password' })
    .where(eq(appUsers.id, user.id));

  // Sign them straight in — first password set should land in /app, not bounce
  // back to a login screen.
  const sessionToken = await createSession(user.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieOptions.name, sessionToken, {
    httpOnly: sessionCookieOptions.httpOnly,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
    path: sessionCookieOptions.path,
    maxAge: sessionCookieOptions.maxAge,
  });
  return response;
}

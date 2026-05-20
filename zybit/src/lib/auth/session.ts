import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { appUsers, authMagicLinks, authSessions } from '@/lib/db/schema';


export const SESSION_COOKIE = 'zb_session';
export const SESSION_DAYS = 30;
export const MAGIC_LINK_MINUTES = 15;

export type SessionUser = {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
};

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createMagicLink(email: string): Promise<string | null> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.email, normalized), eq(appUsers.status, 'approved')))
    .limit(1);
  if (!user) return null;

  // Invalidate any existing valid tokens for this email before issuing a new one.
  // Ensures only one active magic link exists per email at a time.
  await db
    .delete(authMagicLinks)
    .where(
      and(
        eq(authMagicLinks.email, normalized),
        gt(authMagicLinks.expiresAt, new Date()),
        isNull(authMagicLinks.consumedAt)
      )
    );

  const token = generateToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_MINUTES * 60 * 1000);
  await db.insert(authMagicLinks).values({
    id: randomUUID(),
    email: normalized,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

export async function consumeMagicLink(token: string): Promise<string | null> {
  const db = getDb();
  const tokenHash = hashToken(token);
  const now = new Date();

  const [link] = await db
    .update(authMagicLinks)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authMagicLinks.tokenHash, tokenHash),
        gt(authMagicLinks.expiresAt, now),
        isNull(authMagicLinks.consumedAt)
      )
    )
    .returning({ email: authMagicLinks.email });
  if (!link) return null;

  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.email, link.email), eq(appUsers.status, 'approved')))
    .limit(1);
  if (!user) return null;

  return createSession(user.id);
}

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await getDb().insert(authSessions).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      userId: authSessions.userId,
      email: appUsers.email,
      organizationId: appUsers.organizationId,
      role: appUsers.role,
    })
    .from(authSessions)
    .innerJoin(appUsers, eq(authSessions.userId, appUsers.id))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        gt(authSessions.expiresAt, now),
        eq(appUsers.status, 'approved')
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await getDb()
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(token)));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await getDb().delete(authSessions).where(eq(authSessions.userId, userId));
}

export const sessionCookieOptions = {
  name: SESSION_COOKIE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_DAYS * 86400,
};

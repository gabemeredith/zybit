import { cookies } from 'next/headers';
import { getSessionUser } from './session';

export type ServerAuthResult =
  | { ok: true; orgId: string; userId: string; email: string; role: string }
  | { ok: false; reason: 'unauthenticated' };

export async function getServerAuth(): Promise<ServerAuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get('zb_session')?.value;
  if (!token) return { ok: false, reason: 'unauthenticated' };

  const user = await getSessionUser(token);
  if (!user) return { ok: false, reason: 'unauthenticated' };

  return { ok: true, orgId: user.organizationId, userId: user.userId, email: user.email, role: user.role };
}

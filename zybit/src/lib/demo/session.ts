/**
 * Mint a `zb_session` for the demo synthetic PM user.
 *
 * The synthetic user (`DEMO_USER_ID`) is provisioned by
 * `provisionLighthouseSite` during the audit run, with default
 * `status='approved'` and `role='member'`, so a session minted here
 * passes `getServerAuth()` exactly like a real magic-link session.
 *
 * The user row may not exist if the seed hasn't run yet — callers must
 * trigger the seed first and only sign in once the row is in place.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { appUsers } from '@/lib/db/schema';
import { createSession } from '@/lib/auth/session';
import { DEMO_USER_ID } from './constants';

export async function ensureDemoUserAndMintSession(): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, DEMO_USER_ID))
    .limit(1);
  if (rows.length === 0) return null;
  return createSession(DEMO_USER_ID);
}

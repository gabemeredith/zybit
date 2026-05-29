import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

export type AccessRequestSource = 'request_form' | 'public_audit';

export interface UpsertAccessRequestInput {
  email: string;
  source: AccessRequestSource;
  domain?: string | null;
  roleTitle?: string | null;
  analyticsTool?: string | null;
}

/**
 * Upsert a pending lead into the single access-request queue.
 *
 * Keyed on email (unique) so a re-request — the form a second time, or
 * confirming another audit — updates the existing row rather than piling up
 * duplicates. We only refresh `requested_at` + the supplied profile fields and
 * COALESCE so a later sparse request (e.g. a bare audit confirm) doesn't blank
 * out richer data captured earlier. An already-invited/rejected row is left in
 * its terminal status (we don't silently reopen a decided lead) but its
 * profile fields and requested_at still refresh so the operator sees renewed
 * interest.
 *
 * Returns the row id. Throws on DB error — callers decide whether to fail-soft.
 */
export async function upsertAccessRequest(
  input: UpsertAccessRequestInput,
): Promise<string> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const id = randomUUID();

  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO access_requests (id, email, domain, role_title, analytics_tool, source, status)
    VALUES (
      ${id}, ${email}, ${input.domain ?? null}, ${input.roleTitle ?? null},
      ${input.analyticsTool ?? null}, ${input.source}, 'pending'
    )
    ON CONFLICT (email) DO UPDATE SET
      domain = COALESCE(EXCLUDED.domain, access_requests.domain),
      role_title = COALESCE(EXCLUDED.role_title, access_requests.role_title),
      analytics_tool = COALESCE(EXCLUDED.analytics_tool, access_requests.analytics_tool),
      source = EXCLUDED.source,
      requested_at = now()
    RETURNING id
  `);

  return result.rows[0]?.id ?? id;
}

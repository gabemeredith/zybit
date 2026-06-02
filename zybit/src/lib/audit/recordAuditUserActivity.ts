/**
 * Post-audit write-through for the public-audit funnel.
 *
 * After `/api/audit/public/run` finishes the pipeline and persists findings,
 * this updates the user that was auto-provisioned for the audit:
 *   1. Stamps `app_users.last_audit_at` = generatedAt.
 *   2. Sets `app_users.industry` if (and only if) the derived industry is
 *      non-null AND the column is currently NULL. Never overwrites an
 *      existing classification.
 *   3. Inserts one `app_user_rules_fired` row per finding so we can later
 *      surface "rules found on your site" in onboarding + power
 *      industry-level benchmarking.
 *
 * Fail-soft: any error is logged and swallowed. The audit report email and
 * the user's audit page render normally regardless — this is metadata, not
 * a customer-visible path.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import type { Industry } from './deriveIndustry';

export interface AuditFiredRule {
  /** The persisted finding id from zybit_findings — null if not joinable. */
  findingId: string | null;
  ruleId: string;
}

export interface RecordAuditUserActivityInput {
  /** `public_audits.id`. Used to look up the auto-provisioned user. */
  auditId: string;
  /** `zybit_sites.id` for the audit. */
  siteId: string;
  /** Rules that fired in this audit run. Order doesn't matter. */
  firedRules: AuditFiredRule[];
  /** ISO timestamp of the audit run completion. */
  generatedAt: Date;
  /** May be null when the URL gave no deterministic signal. */
  industry: Industry | null;
  /** The role the user selected on the /audit form (e.g. "Founder / CEO"). */
  roleTitle: string | null;
}

type UserRow = { id: string; organization_id: string; industry: string | null; role_title: string | null };

/**
 * Atomic post-audit profile + rules-fired write. Idempotent on user
 * (`last_audit_at` is just overwritten); the rules-fired insert uses fresh
 * ids per call, so re-running an audit will append rows rather than
 * deduplicate — that's intentional, we want a full audit-run history.
 */
export async function recordAuditUserActivity(
  input: RecordAuditUserActivityInput,
): Promise<void> {
  const db = getDb();
  try {
    // Look up the user auto-provisioned by /api/audit/public/confirm. If
    // missing, the audit was triggered without the funnel (e.g. an operator
    // re-fired /run directly) — fail silently.
    const userResult = await db.execute<UserRow>(sql`
      SELECT id, organization_id, industry, role_title
      FROM app_users
      WHERE source_audit_id = ${input.auditId}
      LIMIT 1
    `);
    const user = userResult.rows[0];
    if (!user) return;

    const shouldSetIndustry = input.industry !== null && user.industry === null;
    const shouldSetRoleTitle = input.roleTitle !== null && user.role_title === null;

    // Update profile fields. Both industry and role_title are set only once
    // (never overwritten) so an operator's manual correction is preserved.
    await db.execute(sql`
      UPDATE app_users
      SET
        last_audit_at = ${input.generatedAt.toISOString()},
        industry = CASE
          WHEN ${shouldSetIndustry} AND industry IS NULL THEN ${input.industry}
          ELSE industry
        END,
        role_title = CASE
          WHEN ${shouldSetRoleTitle} AND role_title IS NULL THEN ${input.roleTitle}
          ELSE role_title
        END
      WHERE id = ${user.id}
    `);

    if (input.firedRules.length === 0) return;

    // Bulk-insert the rules-fired rows. Schema requires user_id, org_id,
    // site_id, rule_id NOT NULL; finding_id is nullable. We build the
    // VALUES list as a single statement so it's one round-trip.
    const rows = input.firedRules.map(r => ({
      id: randomUUID(),
      userId: user.id,
      orgId: user.organization_id,
      siteId: input.siteId,
      findingId: r.findingId,
      ruleId: r.ruleId,
      firedAt: input.generatedAt.toISOString(),
    }));

    // Drizzle's sql.join keeps each row parameterized — no string concat.
    const valuesSql = sql.join(
      rows.map(
        r => sql`(${r.id}, ${r.userId}, ${r.orgId}, ${r.siteId}, ${r.findingId}, ${r.ruleId}, ${r.firedAt})`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      INSERT INTO app_user_rules_fired
        (id, user_id, org_id, site_id, finding_id, rule_id, fired_at)
      VALUES ${valuesSql}
    `);
  } catch (err) {
    // Keep the log shape consistent with autoProvisionUser in
    // /api/audit/public/confirm so operators see one diagnostic surface.
    console.error('[audit/run] record-user-activity failed', {
      auditId: input.auditId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

-- Audit funnel: track which users were auto-provisioned from a public audit.
--
-- `source` is a free-text origin tag (e.g. 'public_audit'); we expect a small
-- vocabulary but don't enforce a CHECK constraint so future origins
-- ('beta_invite', 'self_signup', etc.) can be added without a migration.
--
-- `source_audit_id` references public_audits(id) so /admin/ops can join users
-- back to the audit that brought them in. NULL for all existing users.

ALTER TABLE "app_users"
  ADD COLUMN IF NOT EXISTS "source" text,
  ADD COLUMN IF NOT EXISTS "source_audit_id" text;
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_users_source_audit_idx"
  ON "app_users" ("source_audit_id");

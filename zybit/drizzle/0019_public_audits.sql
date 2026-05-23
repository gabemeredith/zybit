-- Public URL-audit lead-magnet tables (Phase B).
--
-- public_audits        — one row per submitted audit request
-- audit_tokens         — single-use email-verification tokens (double opt-in)
-- public_audit_budget  — daily global spend counter ($25/day cap)
-- public_audit_rate_limits — multi-dim sliding-window counters (same pattern as auth_rate_limits)

CREATE TABLE IF NOT EXISTS "public_audits" (
  "id"            text PRIMARY KEY,
  "email"         text NOT NULL,
  "domain"        text NOT NULL,
  "url"           text NOT NULL,
  "role"          text NOT NULL,
  -- 'pending' → 'running' → 'done' | 'failed'
  "status"        text NOT NULL DEFAULT 'pending',
  "ip"            text NOT NULL,
  "teaser_finding" jsonb,
  "findings"      jsonb,
  "pages_scanned" integer,
  "total_findings" integer,
  "cost_usd"      numeric(12,4) NOT NULL DEFAULT '0',
  "error"         text,
  "submitted_at"  timestamptz NOT NULL DEFAULT now(),
  "confirmed_at"  timestamptz,
  "completed_at"  timestamptz
);
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_audits_email_idx"  ON "public_audits" ("email");
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_audits_domain_idx" ON "public_audits" ("domain");
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_audits_status_idx" ON "public_audits" ("status");

-->statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_tokens" (
  "id"          text PRIMARY KEY,
  "audit_id"    text NOT NULL,
  "token_hash"  text NOT NULL,
  "expires_at"  timestamptz NOT NULL,
  "consumed_at" timestamptz
);
-->statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_tokens_hash_idx"  ON "audit_tokens" ("token_hash");
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_tokens_audit_idx" ON "audit_tokens" ("audit_id");

-->statement-breakpoint
-- One row per UTC calendar day. Incremented by the run route; checked by
-- submit to enforce the $25/day hard cap.
CREATE TABLE IF NOT EXISTS "public_audit_budget" (
  "day_utc"  text PRIMARY KEY,
  "cost_usd" numeric(12,4) NOT NULL DEFAULT '0'
);

-->statement-breakpoint
-- Sliding-window rate-limit counters — same (key, window_start) shape as
-- auth_rate_limits so we can reuse the two-bucket approximation pattern.
CREATE TABLE IF NOT EXISTS "public_audit_rate_limits" (
  "key"          text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "count"        integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("key", "window_start")
);

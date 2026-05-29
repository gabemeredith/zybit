-- 0024: access-request queue + credential auth columns
--
-- Onboarding/login redesign (see docs/sprints/onboarding-redesign.md).
--
-- 1. `access_requests` is the single pending-lead queue. Every front-door
--    action — the "Request access" form and the free public audit — upserts a
--    row here with status='pending'. Approval is a deliberate human act in
--    /admin that mints an organizations + app_users row and flips the request
--    to 'invited'. Pending leads therefore live HERE, not in app_users, so
--    /app auth logic stays simple: a session always maps to an approved user
--    that already has an org.
--
--    `email` is uniquely indexed so re-requesting (form again, or confirming a
--    second audit) upserts the existing row instead of piling up duplicates.
--
-- 2. app_users gains credential columns so login is real:
--    - password_hash: scrypt hash (set after approval via the welcome email's
--      one-time set-password link). NULL until the user sets a password.
--    - auth_provider: 'password' | 'google' — which method the row last used.
--    - google_sub: stable Google account id (the OIDC `sub`), uniquely indexed
--      so a Google login resolves to exactly one app_users row.

CREATE TABLE IF NOT EXISTS access_requests (
  id                   text PRIMARY KEY,
  email                text NOT NULL,
  domain               text,
  role_title           text,
  analytics_tool       text,
  -- 'request_form' | 'public_audit'
  source               text NOT NULL,
  -- 'pending' | 'invited' | 'rejected'
  status               text NOT NULL DEFAULT 'pending',
  notes                text,
  stripe_payment_link  text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_at          timestamptz,
  reviewed_by          text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_email_idx ON access_requests (email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (status);
--> statement-breakpoint

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash text;
--> statement-breakpoint
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_provider text;
--> statement-breakpoint
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_sub text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS app_users_google_sub_idx ON app_users (google_sub);

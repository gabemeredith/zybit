-- 0022: user profile fields + per-user rule-fired tracking
--
-- Extends app_users with product-analytics-friendly profile fields
-- (industry auto-detected from audit, role_title for segmentation,
-- last_audit_at). Acquisition tracking lives on `app_users.source`
-- (added in the audit-funnel migration) — do not add a parallel
-- signup_source column here, it would overlap.
--
-- Adds app_user_rules_fired: a queryable log of which audit rules
-- have fired for a user so we can personalize the dashboard, track
-- engagement by rule category, and surface "rules that found things
-- on your site" in the onboarding flow.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role_title text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_audit_at timestamptz;

CREATE TABLE IF NOT EXISTS app_user_rules_fired (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  org_id      text NOT NULL,
  site_id     text NOT NULL,
  finding_id  text,
  rule_id     text NOT NULL,
  fired_at    timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_user_rules_fired_user_idx ON app_user_rules_fired(user_id);
CREATE INDEX IF NOT EXISTS app_user_rules_fired_rule_idx ON app_user_rules_fired(rule_id);
CREATE INDEX IF NOT EXISTS app_user_rules_fired_org_idx  ON app_user_rules_fired(org_id);
CREATE INDEX IF NOT EXISTS app_user_rules_fired_site_idx ON app_user_rules_fired(site_id);

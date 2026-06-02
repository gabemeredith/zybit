-- Zybit-148: per-org daily call counter for the AI Variant Advisor.
-- One row per (organization_id, day_utc YYYY-MM-DD). The advisor route
-- increments via INSERT ... ON CONFLICT DO UPDATE WHERE call_count < N
-- so denied calls do not consume budget.
CREATE TABLE IF NOT EXISTS "phase2_ai_advisor_usage" (
  "organization_id" text NOT NULL,
  "day_utc" text NOT NULL,
  "call_count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "phase2_ai_advisor_usage_pk" PRIMARY KEY ("organization_id", "day_utc")
);

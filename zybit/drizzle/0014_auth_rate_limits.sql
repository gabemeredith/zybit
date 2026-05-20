-- Zybit-115: per-email and per-IP rate limiting on /api/auth/request-link
-- Each row is a (key, window_start) pair tracking attempt count within a 10-minute window.
CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
  "key" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  CONSTRAINT "auth_rate_limits_pk" PRIMARY KEY ("key", "window_start")
);

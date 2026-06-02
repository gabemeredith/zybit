-- Zybit-141: full-fidelity design capture per (site, pathRef).
-- Stores screenshot URL (Vercel Blob), per-element computed styles, and
-- extracted design tokens. captureMethod = 'full' | 'structural' (degraded).
-- Read by the AI Variant Advisor (Zybit-144) and element picker (Zybit-146).
CREATE TABLE IF NOT EXISTS "phase2_site_design_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "site_id" text NOT NULL,
  "path_ref" text NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "capture_method" text NOT NULL CHECK ("capture_method" IN ('full', 'structural')),
  "screenshot_url" text,
  "computed_styles" jsonb,
  "design_tokens" jsonb,
  "css_system" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "phase2_site_design_snapshot_org_idx"
  ON "phase2_site_design_snapshot" ("organization_id");
CREATE INDEX IF NOT EXISTS "phase2_site_design_snapshot_site_idx"
  ON "phase2_site_design_snapshot" ("site_id");
CREATE UNIQUE INDEX IF NOT EXISTS "phase2_site_design_snapshot_site_path_idx"
  ON "phase2_site_design_snapshot" ("site_id", "path_ref");

-- Fix-preview before/after columns on findings.
--
-- Populated by `generateFixPreviews` (src/lib/audit/fixPreview/) during the
-- public-audit run. Three-tier quality ladder:
--   tier 1 — deterministic VariantModification[] applied to captured HTML,
--            then before/after rendered via Browserless. `fix_modifications`
--            carries the schema so the in-product dashboard can later replay.
--   tier 2 — vision inpaint via Gemini 2.5 Flash Image on the before
--            screenshot; `fix_modifications` is null.
--   tier 3 — existing annotated `screenshot_url` only; both new urls null.
--
-- Findings without a generated preview leave all four columns null and the
-- UI degrades to the legacy single annotated screenshot.

ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "screenshot_before_url" text;
ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "screenshot_after_url" text;
ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "fix_preview_tier" smallint;
ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "fix_modifications" jsonb;
ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "fix_preview_generated_at" timestamptz;

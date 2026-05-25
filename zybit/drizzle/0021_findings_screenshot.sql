-- Slice 2 step 2d — annotated-screenshot columns on findings.
--
-- Populated lazily by `renderFindingScreenshot` on first preview view.
-- screenshot_url           — Vercel Blob URL of the rendered + annotated PNG
-- screenshot_captured_at   — when the PNG was last (re)rendered

ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "screenshot_url" text;
ALTER TABLE "forge_findings" ADD COLUMN IF NOT EXISTS "screenshot_captured_at" timestamptz;

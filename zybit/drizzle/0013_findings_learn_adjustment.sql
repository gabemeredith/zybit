-- Layer 1 Learn (Zybit-093): persist learnAdjustment metadata on findings
-- so the backlog/detail UI can render the "↑/↓ N from past tests" pill and
-- "Past tests on your site" panel without recomputing at page-render time.
ALTER TABLE "forge_findings"
  ADD COLUMN IF NOT EXISTS "learn_adjustment" jsonb;

-- Discriminator for whether a finding's narrative fields (summary,
-- recommendation[], prescription) were written by the rule's templating
-- function or by Layer B (LLM orchestrator in `src/lib/phase2/layerB/`, OpenAI).
--
-- During the PR 1 pilot both paths coexist behind LLM_REFACTOR_ENABLED.
-- After PR 2 the templating path becomes the LLM fallback, so the column
-- still serves to flag findings whose prose came from the model vs the
-- deterministic stub-of-last-resort.
--
-- Backfilled to 'template' for all existing rows — every finding written
-- before this migration was templated by definition.

ALTER TABLE "forge_findings"
  ADD COLUMN IF NOT EXISTS "prose_source" text NOT NULL DEFAULT 'template';

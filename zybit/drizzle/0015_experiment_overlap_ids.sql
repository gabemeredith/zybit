-- Zybit-119: store overlapping experiment IDs at launch time for audit trail.
-- Overlap policy: allowed with mandatory acknowledgment (see DOCTRINE.md).
ALTER TABLE "forge_experiments"
  ADD COLUMN IF NOT EXISTS "overlapping_experiment_ids" jsonb;

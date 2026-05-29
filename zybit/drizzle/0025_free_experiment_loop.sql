-- Free-experiment loop foundation (docs/sprints/free-experiment-loop.md).
--
-- Two additive columns, both safe to apply with zero behaviour change for
-- existing orgs/experiments:
--
--   organizations.free_experiment_used_at — timestamp set the first time an
--     unpaid org launches its single free experiment (§6, hard cap of one
--     experiment per company). Null for every existing org, so the gate is
--     inert until the free on-ramp claims it. Lifetime, not per-period.
--
--   forge_experiments.preview_only — marks a projected preview experiment
--     (§5) that must never be served to real visitors. The proxy config query
--     excludes preview_only rows; defaults to false so all existing rows keep
--     serving exactly as before.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "free_experiment_used_at" timestamptz;
ALTER TABLE "forge_experiments" ADD COLUMN IF NOT EXISTS "preview_only" boolean NOT NULL DEFAULT false;

# Free-experiment loop — handoff note

**For:** the next agent picking this up. **Date:** 2026-05-29.
**Spec (read first):** [`free-experiment-loop.md`](./free-experiment-loop.md) — full rationale, the 5 locked decisions, and the 8-step build plan.

---

## Where to work

- **Worktree:** `/Users/gabemeredith/Code/Zybit/zybit/.claude/worktrees/feat+free-experiment-loop`
- **Branch:** `worktree-feat+free-experiment-loop` (app lives in the `zybit/` subdir).
- **First thing:** the worktree's `node_modules` is gitignored — run `npm install` in `zybit/` before `npx tsc` / `vitest` / `build` will work.
- **PR 106 (OpenAI migration + brutalist UI) is already merged into this branch** (merge `2ebe7aa`). Build against that code.

## The goal (one paragraph)

Repoint the public audit from a "free report" into the silent engine behind a **"Try one free experiment"** CTA aimed at PMs. A cold PM enters a URL → the audit manufactures a finding → they see a projected before/after + $ impact (honestly labelled) → land in the cockpit with the experiment + a loop-timeline entry → hit a hard wall at experiment #2 → upgrade unlocks real traffic.

## Locked decisions (don't relitigate)

1. Audit = invisible engine; hero CTA → "Try one free experiment".
2. Target PMs; reuse the role field already captured.
3. Free experiment runs on a **zero-install proxied preview** (no DNS/snippet).
4. The result is a **projected impact**, always labelled "projected — not yet measured" (before/after + lift% + $ range).
5. **Hard cap: one experiment per company (org)**, then upgrade.
6. **Paid signal = `organizations.stripe_subscription_id` is non-null** (no subscription = free on-ramp, gated to one experiment).
7. No-finding → starter experiment; SPA → "connect your data" pivot; error → retry then pivot.
8. **Auth timing is FLEXIBLE — a cofounder owns it.** Keep sign-in a *pluggable seam*: the projected-result render and the account-provision step must stay decoupled so either ordering drops in. Don't hard-wire it.

## What's done (committed, all verified: tsc + lint + tests + build green)

| Commit | Phase | What |
|---|---|---|
| `637b59e` | 1 | migration `0025` (`organizations.free_experiment_used_at`, `forge_experiments.preview_only`) + schema + `/api/proxy/config` excludes `preview_only` + pure `checkFreeExperimentGate` |
| `0ebbbbc` | 5 | One-free-per-org enforcement wired into **both** launch paths: `launchExperimentAction` (`src/app/app/findings/[id]/experiment/actions.ts`) and `POST /api/dashboard/experiments` (startImmediately). Helpers `loadFreeExperimentGate` / `claimFreeExperimentSlot` (atomic, race-safe). Demo org exempt. Returns `free_experiment_used` / 402 `FREE_EXPERIMENT_USED`. |
| `b31197a` | — | renumbered our migration `0024→0025` to avoid collision with PR 107's `0024_findings_prose_source.sql` |
| `601189c` | 2 | `src/lib/experiments/auditFindingBrief.ts` — `manufactureExperimentFromFinding` (per-kind templates) + `proposeFreeExperiment(url)` (runs audit, applies §3 fallbacks) |
| `8a9b0f3` | 3 | `src/lib/experiments/projectedImpact.ts` — `projectImpact()` (PM numbers + benchmark range → labelled projection) |
| `ae22eb9` | 4 | `src/lib/experiments/previewExperiment.ts` — `createPreviewExperiment` (persists a `previewOnly`, `status=completed`, never-started row; projection in `notes`) + `readPreviewProjectionNote`. `/app/loop` renders previewOnly experiments as a **"Proposed" → "Projected"** arc (lift range + basis note, no outcome row). `/app/experiments` + detail page get a "projected" badge + a Projected-impact card and hide the live-traffic affordances (DNS banner, status/record-results controls). Demo seed drops one projected preview so `/demo`'s loop shows the arc end-to-end. |

## What's left

- **Phase 4 — DONE (`ae22eb9`).** The cockpit now renders the projected arc. **Still un-wired:** nothing *creates* a preview experiment from a live URL yet — `createPreviewExperiment` is called by the demo seed only. The cold-URL funnel that calls `proposeFreeExperiment` → `projectImpact` → `createPreviewExperiment` for a real prospect is the funnel-orchestration glue (overlaps Phase 7/8). The §4 numbers micro-step still feeds `projectImpact`.
- **Phase 6:** the upgrade moment UI (plan display + upgrade CTA in `SettingsView.tsx` / cockpit; the locked-state card). Today the gate only surfaces a minimal `launchError` string in `ExperimentBriefCard.tsx`. **This overlaps the Stripe/upgrade work the founder said they'd take — coordinate before building.** Checkout already exists (`/api/billing/checkout`, `planId`).
- **Phase 7:** landing reframe — flip the CTA in `src/app/page.tsx` (currently "Run a free audit" at ~line 201) to "Try one free experiment"; route on the captured role; founder branch = same flow + "invite your PM" nudge. *Note `src/app/page.tsx` was restyled by PR 106 (now merged) — build on the brutalist classes.*
- **Phase 8:** end-to-end verify on a fresh cold URL.
- **The data-capture micro-step** for §4 (ask monthly revenue/visitors) is not built yet — it feeds `projectImpact`. Pull forward the onboarding revenue/AOV field.

## Conventions & gotchas

- **`npm run verify` (lint + tsc + test + build) must pass before any commit.** Per-step loop: review → test → run/verify → commit each step.
- **Migrations are hand-numbered SQL files** applied manually to Neon (the drizzle `_journal` is stale/unused). Latest is now `0025`. **`0025` has NOT been applied to any DB yet** — it's just the file. The new columns won't exist in a real DB until someone runs it.
- **Demo org (`DEMO_ORG_ID`) must stay exempt** from the gate — it stages several experiments by design.
- **PR 107 (`feat/llm-refactor`, draft) is the other agent's lane** — `src/lib/phase2/layerB/`, `lighthouse/`, `src/lib/phase2/rules/`, `parser.ts`, `runInsightsPipeline.ts`, and `forge_findings.prose_source`. Stay out of those files. `schema.ts` is shared but edits are in different tables (we: organizations/forge_experiments; 107: forge_findings) so they auto-merge.
- **Verification style:** the founder (Gabe) verifies by clicking a GUI and seeing output, not by reading test logs. **To see Phase 4: run `/demo`, then open `/app/loop`** — the seeded projected preview shows as a "Proposed" → "Projected" entry, and it appears on `/app/experiments` with a "projected" badge + Projected-impact card on its detail page.
- The proposal/projection/`preview_only` are now visible **in the cockpit** (Phase 4). What's still backend-only is the *cold-URL funnel entry* that mints a preview for a real prospect (Phase 7/8 glue).

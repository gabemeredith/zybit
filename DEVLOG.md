# Zybit — Dev Log

One entry per work session. Most recent at top. Captures decisions made, what shipped, blockers, and what's next. Meant for async handoff between engineers.

---

## 2026-05-30 (follow-up — docs archaeology cut)

**Session:** Core-refocus — cut documentation bloat
**Branch:** `claude/zybit-core-refocus-32VPy`

### What shipped

Removed **19 markdown files** of session/sprint archaeology — the lowest-risk
slice of the docs trim (no code coupling):

- **`docs/sprints/` (entire dir)** — sprint-0…5, `-R`/`_archive` variants,
  REMEDIATION, ROADMAP, pilot-readiness, operator-dashboard,
  onboarding-redesign, preview-system, posthog-from-zero, next-bets,
  url-audit-lead-magnet, sprint-3-deferred, niche-categorization-engine.
- **`docs/handover.md`** + **`docs/handover-fix-preview.md`** — stale
  point-in-time handoffs.

Session history is already captured here in DEVLOG; build state is in
`AGENTS.md`. Anything older is recoverable from git history.

### Dangling-reference cleanup

- Scrubbed the three clickable markdown links to deleted sprint docs from
  `DOCTRINE.md` (immediate-priorities list).
- Rewrote `docs/INDEX.md` to map only the surviving doc set (added a note
  explaining the sprint-log removal + where history now lives).
- Confirmed **zero** clickable links to deleted docs remain repo-wide, and
  no source code reads any of the removed files (grep-verified). Stale
  *code-span mentions* of old `docs/sprints/...` paths still sit inside a
  few `AGENTS.md` build-state cells + `ARCHITECTURE.md`/`curriculum.md`;
  these are plain text (not 404 links) and will be rewritten when their
  subsystems are cut in the behavioral pass.

### Not done (deferred to the behavioral-cut pass, by decision)

The overlapping strategy/subsystem docs (`pivot.md`,
`competitive-landscape.md`, `curriculum.md`, `PHASE2_EVIDENCE_MODEL.md`,
`phase2-rules-architecture.md`, `PHASE2_LIVE_TUNING_PLAYBOOK.md`,
`CAPTURE_RUNBOOK.md`, `fix-tn.md`, root `product_gap.md`) are the
fold/consolidate tier — several document the behavioral subsystem queued
for removal, so they get deleted **in the same commit as their code** to
avoid desync. Order agreed with operator: **cut first, then build** the
region-replace macro-structural feature.

### Verify

Docs-only change (+ INDEX rewrite, DOCTRINE link scrub). No source touched;
build/test state unchanged from the prior commit.

---

## 2026-05-30

**Session:** Core-refocus — first pass: cut clearly-dead legacy UI surfaces
**Branch:** `claude/zybit-core-refocus-32VPy`

### Why

Direction set with the operator: Zybit is too broad. Steer it back toward a
thin core — *find a small HTML/CSS/SEO issue → propose a small change → A/B
test it → measure* — for a customer's own site. This pass removes only the
**clearly-dead / non-customer-facing UI surfaces**; the riskier structural
cuts (behavioral-analytics subsystem, AI pipeline, billing) are deferred to
a planned pass.

### What shipped (deletions)

Removed five route trees that no customer-facing navigation points into,
plus one self-contained dead feature. Each was verified unreferenced before
removal (no external imports, no test references, all inbound links were
either among the deleted set or stale):

- **`/dashboard`** — was a redirect-only stub (`redirect('/audit')`).
- **`/phase1` + `/phase2` pages** — internal dev control panels (inline-style
  simulators), only cross-linked to each other and from `/docs`. **The
  `/api/phase1`, `/api/phase2` routes and `src/lib/phase1`, `src/lib/phase2`
  engines are untouched** — those are the live rules/insights engine.
- **`/docs`** — internal Phase-1 API reference page; nothing linked in.
- **`/discovery` feature** — secondary lead form. Removed the page,
  `/api/discovery/route.ts`, and `src/lib/discovery/schema.ts` together
  (closed loop — referenced only by each other + the middleware allowlist).
- Cleaned the now-dangling `/dashboard`, `/docs`, `/discovery`,
  `/api/discovery` entries from `PUBLIC_PREFIXES` in `src/proxy.ts`.

### Evidence gathered this session (for the next, riskier pass)

- **Behavioral analytics is severable from the HTML/CSS/SEO core.** Traced
  all 23 audit rules: **13 fire with zero live-user data** (7 structural
  Layer-E SEO/a11y + 3 Layer-F copy critique = pure snapshot; 3 design rules
  are hybrid and degrade gracefully to snapshot-only). The other **10
  (9 pain + 1 flow) require live events** and are the "differentiated moat,"
  not the lean core. Cutting PostHog/Segment/GA4 + phase1 events + rollups +
  flow-graph would drop 23→13 rules without touching the SEO/HTML/CSS engine.
  Candidate for the next pass — **not cut here** (operator asked to evaluate,
  not remove).
- Latent bug noted (out of scope): `src/components/dashboard/WelcomeState.tsx`
  (live, used by `CockpitView`) still links to `/dashboard/connect` +
  `/dashboard/settings`, which don't exist — should point at `/app/settings`.

### Verify

`npx tsc --noEmit` clean · `npm run lint` 0 errors (11 pre-existing warnings)
· `npm run build` clean (route manifest confirms the five trees are gone) ·
test suite **1342 passed / 2 skipped, 1 pre-existing env-dependent failure**
(`visionInpaint.test.ts > proceeds when model returns a large JPEG` — hangs
on a network upload path in envs with outbound network; documented in the
2026-05-29 entry, no audit/vision code touched this session).

### What's next

- Plan the riskier cuts: behavioral-analytics subsystem (the clean 23→13
  fault line above), then AI pipeline and billing if the refocus holds.
- Fix the `WelcomeState` stale `/dashboard/*` links → `/app/*`.

---

## 2026-05-29 (follow-up — deferred UI surfaces)

**Session:** Finish the brutalist pass on the deferred interaction-form surfaces
**Author:** —
**Branch:** `claude/dashboard-ui-experiments-Ovjyz`

### What shipped

- **Completed the brutalist conversion of every deferred surface** from the earlier session: `EvidencePanel`, `ExperimentBriefCard`, `ExperimentControls`, `ExperimentBuilderForm`, `AiAdvisorPanel`, `AnnotatedFindingPreview`, `SettingsView`, `OnboardingWizard`, `ProxySetupForm`, `/app/flow`, `/app/loop`, plus `FindingStatusActions` (was still soft-styled on every finding-detail page).
- **Two new shared primitives in `globals.css`** so the forms stay DRY: `.brut-action-ghost` (white square ink-outline button that fills on hover — secondary/cancel) and `.brut-input` (full-width square ink-bordered field, replaces the rounded soft inputs/textareas/selects).
- Mechanical pass applied consistently: removed all `rounded-*` (kept only on spinner loaders); `bg-white border border-black/[0.05] rounded-*` cards → `.brut-card`; section labels → `.brut-label`; status/type/severity pills → `.brut-badge`; primary buttons → `.brut-action`; soft alert banners (`border border-*-200 rounded-*`) → square left-accent bars (`border-l-4 border-*-300/500`); dividers → `border-t-[1.5px] border-black/[0.08]`; status dots and wizard step circles → square; progress/funnel bars → square with `border-[1.5px] border-[#111]`.
- No logic, prop types, handlers, copy, or imports changed — styling only.

### Verify

`npx tsc --noEmit` clean · `npm run lint` 0 errors (10 pre-existing warnings) · `npm run build` clean · test suite 1305 passed / 2 skipped, **1 pre-existing failure** (`visionInpaint.test.ts > proceeds when model returns a large JPEG`) that is environment-dependent — it stubs a fake `BLOB_READ_WRITE_TOKEN` and relies on `put()` failing fast; in an env with outbound network the request hangs to the 5s test timeout. Fails identically on the untouched baseline; unrelated to this UI work (no test/logic files touched).

Screenshots of the converted surfaces were captured via a throwaway `/showcase` dev route (real components + mock props, removed before commit).

---

## 2026-05-29

**Session:** Demo dashboard brutalist redesign + Gemini → OpenAI provider swap
**Author:** —
**Branch:** `claude/dashboard-ui-experiments-Ovjyz`

### What shipped

**1. Brutalist dashboard UI** — brought the demo-visible `/app` surfaces in line with the marketing site's brutalist language (ink-on-cream, square corners, 1.5px ink borders, hard offset shadows, monospace data register), replacing the default "SaaS" round-card / soft-shadow look.
- New `--font-mono` (JetBrains Mono) added in `layout.tsx` for data/labels/metrics.
- New reusable utilities in `globals.css`: `.brut-card`, `.brut-card-link`, `.brut-label`, `.brut-badge`, `.brut-tag`, `.brut-action`, `.mono-text`.
- Restyled: `AppShell` sidebar (square nav, mono uppercase labels, left-accent active state), `CockpitView` (stat cards, top-finding card, pipeline health, severity badges, alert banners → left-accent bars), findings list + finding detail, experiments list + experiment detail, `RunInsightsButton`.
- Rewrote the three demo components (`SeedingScreen`, `PostHogStream`, `HowTrackingWorks`) off hardcoded `-apple-system` system fonts + `borderRadius:16` onto the site font + brutalist Tailwind.
- **Deferred (now completed — see 2026-05-29 follow-up below):** deeper interaction-form components — `EvidencePanel`, `ExperimentBuilderForm`, `ExperimentControls`, `ExperimentBriefCard`, `AiAdvisorPanel`, `AnnotatedFindingPreview`, `ProxySetupForm`, `SettingsView`, `OnboardingWizard`, `/app/flow`, `/app/loop`.

**2. Gemini → OpenAI** — replaced every Gemini REST integration with one shared OpenAI client (`src/lib/ai/openai.ts`, 9 unit tests).
- Models (researched May 2026): `gpt-5.4` for reasoning/quality (variant advisor, audit fix advisor), `gpt-5.4-mini` for capture-time extraction + screenshot gate (copy critique, visual signals, vision caption, quality gate), `gpt-image-1` for Tier-2 inpaint. All overridable via `OPENAI_REASONING_MODEL` / `OPENAI_FAST_MODEL` / `OPENAI_IMAGE_MODEL`.
- Migrated call sites: `aiAdvisor.ts` (`callGeminiFlash` → `callAdvisorModel`), `captureCopyCritique.ts`, `captureVisualSignals.ts`, `visionPass.ts`, `auditFixAdvisor.ts`, `screenshotQualityGate.ts`, `visionInpaint.ts` (now multipart `/v1/images/edits`), and the `ai-suggest` route. Env gate `GEMINI_API_KEY` → `OPENAI_API_KEY`.
- Chat Completions shape: Bearer auth header, `response_format:{type:'json_object'}` for JSON, vision via `image_url` data URLs, `max_completion_tokens`, temperature omitted unless needed (gpt-5.x rejects non-default temps).
- Updated all affected test stubs (`candidates[].content.parts[].text` → `choices[].message.content`; inpaint → `data[].b64_json`). `.env.example` + `README` env table updated.

### Caveats / next

- **Not live-verified against the OpenAI API** (no key/network in this env). Model IDs + request shapes are correct-by-construction from the May-2026 docs; confirm with a real key before relying on production AI surfaces. `gpt-image-1` edits do soft-mask full recreation (not pixel-level), so Tier-2 inpaint brand fidelity is good-but-not-guaranteed — the existing no-op/blank guards + Tier-3 fallback cover drift.
- Legacy dev scripts (`scripts/probe-gemini.mjs`, `verify-gemini-inpaint.ts`, `live-fix-preview.ts`, `seed-demo.ts`) still reference `GEMINI_API_KEY` — not in the build/test path; update when next touched.
- Doc comments inside rule files still say "Gemini" (historical context); the canonical build-state note records the swap.

### Verify
`npx tsc --noEmit` clean, full suite 1306 passed / 2 skipped (live), `npm run build` clean, lint clean on touched files.

---

## 2026-05-22 (session 3)

**Session:** PRD Milestone 1 — Flow-graph advisory (all 5 scope items)
**Author:** —

### What shipped

- **Flow types** (`src/lib/phase2/flow/types.ts`) — `FlowNode`, `FlowEdge`, `FlowGraph` data contracts
- **Route normalization** (`normalizeRoute.ts`) — strips query/hash, collapses `:id` segments (digits/UUIDs/long hex), 8 tests
- **Flow graph derivation** (`deriveFlowGraph.ts`) — groups events by session, collapses consecutive same-route arrivals, computes nodes + edges with outbound share; capped at 40 nodes / 120 edges, 8 tests
- **Flow repository** (`repository.ts`) — `get`/`upsert` against `phase2_flow_graph` table (migration `0017`)
- **Migration `0017`** (`drizzle/0017_phase2_flow_graph.sql`) — `phase2_flow_graph` table with site-keyed upsert — **NOT YET APPLIED TO NEON**
- **`runInsightsPipeline`** updated — derives flow graph from the same windowed events, passes as `ctx.flowGraph` to audit rules, returns it in `RunInsightsResponse`
- **`insightsTrigger`** updated — caches the flow graph to DB (best-effort, `.catch(() => {})`) after each insights run
- **`flow-inter-step-dropoff` rule** (`src/lib/phase2/rules/flowInterStepDropoff.ts`) — 13th audit rule; identifies the mid-flow step losing the most sessions; excludes pure landing pages; emits `flow-funnel` snapshot diagram; 8 tests; wired into `ALL_AUDIT_RULES` + Layer 2 calibration
- **Layout engine** (`src/lib/phase2/flow/layout.ts`) — deterministic layered SVG layout via longest-path relaxation + cycle-breaking cap; `layoutFlowGraph(graph): FlowLayout`; cubic-bezier edge paths; 9 tests
- **`FlowGraphView` component** (`src/components/app/FlowGraphView.tsx`) — client SVG component; amber chokepoint highlight; depth columns; edge weight by transitions
- **`/app/flow` page** (`src/app/app/flow/page.tsx`) — server component; loads cached flow graph + open flow findings; handles missing DB table gracefully; empty states
- **AppShell** — "Flow" nav item added between Findings and Experiments
- **EvidencePanel** — `flow-funnel` rendering added alongside `form-funnel` (reuses `FormFunnel` function)

### Test count
592 tests across 53 files. All passing. `npm run verify` clean.

### Decisions made

- Flow graph derivation is a pure function over the same windowed events `runInsightsPipeline` already loads — no extra DB read.
- Repository writes are best-effort so they never block an insights run if migration `0017` isn't applied yet.
- `FlowGraphView` is a `"use client"` SVG component; no canvas, no layout library.
- Layout uses longest-path relaxation capped at `nodes.length` iterations to break cycles deterministically.
- `flow-funnel` diagram reuses the existing `FormFunnel` function in EvidencePanel — structurally identical.

### Blockers

- **Migration `0017` not applied to Neon.** The `/app/flow` page and flow graph caching will silently degrade (`.catch(() => null/[])`) until it's applied. Apply manually with `psql $DATABASE_URL < drizzle/0017_phase2_flow_graph.sql` or via the Drizzle migration runner.

### What's next

- Apply migration `0017` to Neon (needs explicit approval from operator)
- Operator dashboard (Zybit-156) — next highest-priority gap

---

## 2026-05-22 (session 2)

**Session:** Stripe round-trip verification, migrations 0014/0016, full sprint audit
**Author:** —

### What shipped

- **Migration 0016 applied to Neon** — `phase2_site_design_snapshot` (PR #58's
  table). Applied ahead of the merge so the cron writes don't throw; idempotent
  (`CREATE TABLE IF NOT EXISTS`). Table + 11 columns + 4 indexes + the
  `capture_method` CHECK constraint verified against `schema.ts`.
- **Migration 0014 applied to Neon** — `auth_rate_limits`. DB verification
  found it was **never applied**: the shipped Zybit-115 rate limiter
  (`rateLimit.ts`) queries this table and would have crashed at runtime on
  every `/api/auth/request-link` call. Applied with user approval.
- **Stripe full round-trip verified end-to-end** — 18/18 checks against the
  live test API + the real webhook handler + Neon, scoped to a throwaway org
  (the 4 existing orgs untouched, cleaned up after): checkout session +
  customer creation/persistence; webhook `checkout.session.completed` →
  `plan='growth'`; `customer.subscription.updated` → `plan='scale'`;
  `customer.subscription.deleted` → revert to `starter`; tampered signature →
  400; `checkPlanLimit` reads the webhook-written plan (starter blocks at 1
  site, growth allows). Clears the long-standing "Stripe action needed" item.

### Sprint audit (sprints 0–5)

- Full per-ticket re-audit: **38 real tickets — 22 done, 3 partial, 9 not
  built, 2 in open PR #58, 2 superseded.** `docs/sprints/REMEDIATION.md`
  rewritten as the definitive status doc; `ROADMAP.md` status table and
  `AGENTS.md` updated to match.
- Remaining: Zybit-127/128 (demo seed), 143/144/145/146/148 (Sprint 3 AI
  surface), 156 (operator dashboard), 165 (operator calibration view); partial
  118/124/147; 161/162 need a keep-superseded-or-build decision.
- **New ticket Zybit-149** added to Sprint 3 — client-side variant runtime:
  an injected, declarative DOM-mutation script (bucket read from the proxy
  cookie, `MutationObserver` re-apply, anti-flicker, nonce'd CSP) so
  experiments work on SPA pages and can express changes beyond the six simple
  server-side types (`element-insert`, `element-move`, `sequence`). It is the
  deployment-side counterpart to the Zybit-144 AI advisor — without it the
  advisor can propose richer variants than the engine can deploy. Schema stays
  declarative (no `eval`/raw JS) to preserve the deterministic, PM-approved
  doctrine. Spec in `docs/sprints/sprint-3.md`.

### Findings / blockers

- The Drizzle migration journal (`drizzle/meta/_journal.json`) is stale —
  lists only 0000–0002 though 0000–0016 are applied, and there is no
  `drizzle.__drizzle_migrations` table. Migrations have been applied manually.
  Reconcile before relying on `drizzle-kit migrate`.

### What's next

- Merge PR #59 → PR #58.
- Zybit-156 operator dashboard; then Sprint 3 proper (needs `GEMINI_API_KEY` +
  Vercel Blob tier).

---

## 2026-05-22

**Session:** Live Lighthouse verification, PR #58/#59 review, Zybit-123
**Author:** —

### What shipped

- **Zybit-123 — SPA-shell launch guard (re-scoped).** The ticketed spec
  (replace an onboarding SSR/SPA toggle) was obsolete — no such toggle exists
  and `fetcher.ts` already auto-detects SPAs for snapshots. The real live gap
  was in *Test*: the proxy detected an SPA shell (`handler.ts`) but only
  logged a warning, then served unmodified control HTML to variant traffic —
  a silent no-op experiment that pollutes outcome history. Shipped instead as
  a launch-time guard: `targetPageIsSpaShell` (new `spaGuard.ts`) fetches the
  target page and runs `isSpaHtml`; `launchExperimentAction` returns a
  `spa_warning`; `ExperimentBriefCard` shows a warn-and-acknowledge banner
  (mirrors the Zybit-119 overlap pattern). Fails open on fetch error. 4 tests.
  Suite: 46 files, 523 tests.

### Verification (first live run)

- **The Neon network-allowlist blocker is gone.** Every prior session logged
  "Neon host not in allowlist"; this session the host is reachable and
  `DATABASE_URL` is in the container env. Node 22 is present.
- Ran live Lighthouse end-to-end for **both** scenarios against Neon:
  AcmeBank (300 sessions → 1890 events → 2 findings → experiment +8.4% →
  Layer 2 calibrated `return-visit-thrash ×0.70`) and WovenBasics (300 →
  3635 events → 1 finding → +7.7% → calibrated). The full loop and Layer 2
  are now genuinely Lighthouse-verified, not just unit-verified.
- `npm run verify` green; app suite 519→523, Lighthouse suite 43.

### PR review

- **PR #58** (Sprint 3 Zybit-141/142 — design snapshot schema + writer):
  safe to merge — additive table, non-fatal cron writes. Apply migration
  `0016` to Neon after merge.
- **PR #59** (empty-selector → variant=control loophole): safe to merge —
  closes the sibling bug to Zybit-123 in the no-op-experiment family. Minor
  open item: launch gate doesn't `.trim()` DB-sourced selectors.

### What's next

- Merge #59 → #58, apply migration `0016`.
- Live Stripe round-trip (`STRIPE_SECRET_KEY` now in env — newly unblocked).
- Sprint 3 continues: Zybit-143 (token extraction) onward.

---

## 2026-05-21 (session 3)

**Session:** Sprint compliance audit, Zybit-157/154/155, Stripe verification, doc consolidation
**Author:** —

### What shipped (Sprint 4)

- **Zybit-154 — connector circuit breaker**: sync crons skip `disconnected` integrations (no more 30-min retry-forever); `POST /api/phase2/integrations/:id/resume` clears the breaker; red cockpit banner; `IntegrationStatus` widened to model `degraded`/`disconnected` (the breaker already wrote them).
- **Zybit-155 — cron failure email**: `withCronAlert` wraps all 5 cron routes; unhandled throw or 5xx → structured log + Resend ops alert. 3 tests.
- Test suite now 39 files, 458 tests.

### Stripe verification (Zybit-114)

- Stripe CLI v1.41.2 installed in-container; API key works; the code's pinned API version `2026-04-22.dahlia` confirmed valid against the live API.
- Full checkout→webhook→DB round-trip still **cannot run here** — the webhook's DB writes target Neon, which the container allowlist blocks (same blocker as Lighthouse). Needs a reachable env.

### Doc consolidation

- New `docs/sprints/REMEDIATION.md` — single source of truth: per-ticket audit (sprints 0–5), build plans for the Sprint 0/1/2 gaps and the entirely-unbuilt Sprint 3, and Sprint 4/5 status.
- `AGENTS.md` "Immediate build order" corrected — it had claimed "Sprint 0/1/2 merged"; sprints 1–2 are only partial, Sprint 3 unbuilt.

### What shipped (earlier this session)

- **Zybit-157 — GA4 "Identify/Propose only" measurement gap**:
  - New pure predicate `isGa4OnlyMeasurementGap` (`src/lib/phase2/connectors/measurementGrain.ts`) — true when every active integration on a site is GA4. Single source of truth, 8 unit tests.
  - Amber cockpit banner when GA4 is the only connector: findings work, but outcome measurement needs PostHog/Segment.
  - `computeAllOutcomes` now skips GA4-only sites with a `logger.warn` structured warning instead of running and producing 0-confidence noise.
  - Spec step 2 (onboarding note) skipped with justification: GA4 has no UI connection flow — it is API-only; onboarding offers PostHog/Segment exclusively. Documented in `sprint-4.md`.
  - Test suite: 38 files, 455 tests passing (was 447).

### Sprint compliance audit (sprints 0–3)

A file-existence + behavior audit against the sprint docs found significant documentation drift — several tickets claimed in `AGENTS.md` are not actually built:

- **Sprint 0:** mostly done. Built: Zybit-114, 115, 117, 119. Not built: Zybit-116 (Edge Config kill-switch write), Zybit-120 (E2E smoke test — `scripts/e2e-test.mjs` exists but is not the full-loop spec).
- **Sprint 1:** partial. Built: Zybit-121 (route is `api/selector-validate`, not `selectorMatcher.ts`), Zybit-122 (CSS detector). Not built: Zybit-125 (copy hints), Zybit-126 (PostHog bridge health probe), Zybit-127/128 (demo seed + synthetic outcomes). Zybit-124 (dead-state) partial — gate logic exists, no `InsightsDeadState` UI component.
- **Sprint 2:** partial. Zybit-134/137 partial; Zybit-133 (selector staleness cron), Zybit-135 (snapshot drift dashboard) not built.
- **Sprint 3:** entirely unbuilt — no design capture, no AI Variant Advisor, no element picker, no AI infra.

### Blockers

- **Stripe live round-trip cannot run in this container:** no `stripe` CLI installed, `STRIPE_SECRET_KEY` is not in the sandbox env (set in Vercel only), and the network allowlist blocks external hosts. Needs a reachable environment with stripe-cli + test keys.
- Live Lighthouse/DB run still blocked (Neon host not in allowlist) — verification via the 455-test unit suite.

### What's next

1. Connector circuit breaker (Zybit-154) — `consecutiveFailures` column already in `phase2_integrations`; wiring only.
2. Cron failure email (Zybit-155) — `withCronAlert` wrapper.
3. Live Stripe round-trip — needs stripe-cli + reachable endpoint.
4. Reconcile `AGENTS.md` claims with the audit above — stop claiming unbuilt Sprint 1–3 tickets as shipped.

---

## 2026-05-21 (session 2)

**Session:** Layer 2 PM surface, Lighthouse Layer 2 exercise, Axiom verification, readiness assessment
**Author:** —

### What shipped

- **Layer 2 PM-visible surface (Zybit-164 equivalent)**:
  - `AuditFinding.calibration` field: calibration receipt attached to each finding produced under an active calibration.
  - `learnAdjustment.calibration` persisted to `forge_findings` jsonb — no migration, extends existing column.
  - "Tuned" badge on findings backlog (violet = loosened, orange = tightened).
  - "Tuned for your site" panel on finding detail page: direction, multiplier, basis count.
  - LEARNED timeline entries now show a violet calibration note when the rule's threshold was tuned.
  - Loop page computes calibrations from loaded outcomes (pure function, one extra DB call via `createOutcomesRepository().listForSite()`).

- **Lighthouse Layer 2 exercise (step 4.6)**:
  - After step 4.5 creates a conclusive outcome, inserts 2 additional synthetic positive outcomes for the top finding's rule (if it's in `CALIBRATED_RULE_IDS`), bringing total to 3 (≥ `MIN_CONCLUSIVE_OUTCOMES`).
  - Runs the pipeline a second time to confirm calibration fires.
  - Reports `GenerateResult.layer2` — `calibrated`, `calibratedRuleCount`, `calibrationSummary`.
  - Layer 2 is now **Lighthouse-verified**, not just unit-verified.

- **Axiom drain verified and documented**:
  - Token confirmed working against `api.axiom.co` (token stored in Vercel env vars, not here).
  - Dataset `axiom-audit` confirmed writeable (ingest test: `ingested: 1, failed: 0`).
  - Action needed: set `AXIOM_DATASET=axiom-audit` in Vercel env vars. No code changes required.
  - README env var table updated with all required/optional env vars.

- **Sprint 4–5 cross-reference**: confirmed sprints 4–5 cover every missing gap. Zybit-153 (Axiom): just the env var. Zybit-154/155/156/157 all unbuilt — documented in AGENTS.md "What's needed before first customer" table.

- **`RunInsightsResponse.auditReport` type**: added `calibration?` to both `findings` and `diagnostics` inline types in `phase2/types.ts` so Lighthouse and any external consumer can read calibration data without type errors.

### Decisions made

- **Layer 2 surface is read-only / informational.** The calibration happened before the finding was produced; the badge is a receipt, not a prompt for action. The "Tuned" label is deliberate — it's the PM-readable version of "threshold multiplier ×0.87."
- **`learnAdjustment` jsonb extended, not a new column.** Both Layer 1 and Layer 2 live in the same column. `basedOnOutcomeIds` is always present (empty array when only Layer 2 fired) so existing detail-page array access never throws.
- **Lighthouse seeds exactly 2 extra outcomes** (not more). This is the minimum to reach the gate (1 from step 4.5 + 2 seeded = 3). Seeded rows are idempotent (`onConflictDoNothing`) and scoped to `lighthouse_site_*` so they can never touch real customer data.

### Blockers

- Live Lighthouse/DB run still blocked (Neon host not in allowlist). All verification is done via the unit test suite (447 tests) + the Lighthouse step 4.6 path code.

### What's next (in priority order for first real customer)

1. **Set `AXIOM_DATASET=axiom-audit` in Vercel** — 1 env var, unblocks observability immediately.
2. **Stripe live round-trip** (Zybit-040) — needs stripe-cli + test keys + reachable webhook endpoint.
3. **GA4 limitation amber banner** (Zybit-157, ~0.5d) — prevents silent no-outcome runs for GA4-only customers.
4. **Connector circuit breaker** (Zybit-154, ~2d).
5. **Cron failure email** (Zybit-155, ~1d) — `withCronAlert` wrapper.

---

## 2026-05-21

**Session:** Learn — Layer 2 (per-site rule-threshold calibration)
**Author:** —

### What shipped

- **Layer 2 calibration engine** (`zybit/src/lib/phase2/rules/ruleCalibration.ts`): pure `computeRuleCalibrations(outcomes)` aggregates a site's experiment outcomes **per `ruleId`** into a detection-floor multiplier. Per-outcome signal reuses Layer 1's shape (`clamp(liftPct, ±20) × confidence × 0.01`, guardrail breach −0.10); net signal clamped to ±0.30 → `multiplier = clamp(1 − netSignal, 0.7, 1.3)`. Gated at `MIN_CONCLUSIVE_OUTCOMES = 3` so one noisy result can't move detection.
- **11 of 12 rules calibrated** (`CALIBRATED_RULE_IDS`): each routes its single detection floor through `calibratedFloor` (lower-bound floors) or `calibratedCap` (upper-bound caps — `form-abandonment` submit rate, `nav-dispersion` Gini). Statistical sample-size guards are deliberately left uncalibrated. `hero-hierarchy-inversion` is exempt — its only gate is a sample-size minimum, not a signal floor (added on review of the architecture; see below).
- **Wired into `runInsightsPipeline`**: outcomes fetched once, feed both Layer 2 (`AuditRuleContext.calibration`, before rules run) and Layer 1 (`applyLearnRerank`, after). Active calibrations surface in `AuditRuleDiagnostic.calibration`.
- 23 new unit tests; `npm run verify` green (37 files, 446 tests).

### Decisions made

- **Per-`ruleId` aggregation, not per-path**: a rule's threshold is one module constant shared across pages, so there's nothing per-path to tune (Layer 1's path/modType cascade lives at the finding level).
- **No schema change**: calibration is computed on the fly from the same `zybit_experiment_outcomes` rows Layer 1 reads — deterministic, mirrors Layer 1's pattern.
- **Bounded ±30%** and gated, so calibration shifts sensitivity without ever firing on under-powered samples.

### Architecture review (post-implementation)

- **Lighthouse cannot exercise Layer 2.** `runScenario` deletes outcomes at step 0, runs insights once (step 4), then creates the experiment+outcome (step 4.5). The single insights pass always sees zero prior outcomes → calibration is always neutral. So Layer 2 is **unit-verified, not Lighthouse-verified**. To close this: a second insights pass after the outcome, or seed an outcome history before the first pass. Not wired yet.
- **Live Lighthouse run blocked here:** the container's network allowlist rejects the Neon host (HTTP 403 "Host not in allowlist"), so no live DB run was possible this session. Ran the 38 Lighthouse unit tests + 446 app tests green instead.
- **Removed an unprincipled calibration:** `hero-hierarchy-inversion` was calibrating `MIN_CTA_CLICKS`, a pure sample-size gate (the inversion is binary, no magnitude). That contradicts "don't calibrate sample-size guards" and could fire on under-powered data. Exempted it via `CALIBRATED_RULE_IDS`.
- **No PM-facing surface for Layer 2.** Findings appear/disappear with no "why." Conflicts with the "make learning visible" doctrine (cf. the Zybit-093 LEARNED-entry idea: "threshold now requires stronger signal"). Flagged for a product decision — not silently shipped as done.

### Blockers

- Live Lighthouse/DB e2e blocked by the environment network allowlist (Neon host not allowlisted).

### What's next

- Decide whether Layer 2 needs a PM-facing surface (LEARNED timeline entry / cockpit note) or whether silent recalibration is acceptable pre-pilot.
- If we want Lighthouse to verify Layer 2: add a second insights pass (or outcome seeding) to `runScenario`.
- Live Stripe round-trip verification (Zybit-040) still needs stripe-cli + test keys (can't run in sandbox).
- Layer 3 (cross-site priors) stays deferred until 50+ customers.

---

## 2026-05-20

**Session:** Architecture review + sprint scaffolding
**Author:** —

### Decisions made this session

**Visual element picker (Sprint 3):** DOM tree view + screenshot thumbnail. No iframe embedding — CORS and CSP are an unwinnable fight for this use case. Browserless screenshot stored in Vercel Blob; collapsible element tree alongside it; PM clicks element → selector populates → bounding-box highlight on thumbnail. 7 days of real work vs 12+ days of CSP fighting for a broken result.

**AI Variant Advisor degraded mode:** When Browserless is unavailable (bot protection, plan tier, cost budget), the AI advisor still runs using the structural snapshot only. `phase2_site_design_snapshot.captureMethod` field is `'structural'` in this case. The AI prompt includes this signal. UI shows "Visual confidence: limited — computed styles unavailable." This way customers whose sites block Browserless still get value from Sprint 3.

**Experiment collision policy:** Overlap allowed by default. A second experiment on the same page triggers a mandatory acknowledgment warning. `forge_experiments.overlappingExperimentIds: string[]` stored so outcomes can be flagged. Mutual exclusion (`exclusionGroup`) is a later feature.

**No AI in Identify phase:** Doctrine holds. 12 deterministic rules, same input = same output. AI is used only in the Propose phase (Sprint 3, Zybit-144) to generate variant modifications from design context. PM approves before anything deploys.

**GA4 limitation documented:** GA4 is aggregate-grain — cannot join to visitor assignment events for outcome measurement. Documented in onboarding and cockpit. PostHog or Segment required for the full loop.

### What was scaffolded

- `docs/sprints/ROADMAP.md` — full sprint arc with locked architectural decisions
- `docs/sprints/sprint-0.md` — fully detailed (Zybit-114 to 120)
- `docs/sprints/sprint-1.md` — fully detailed (Zybit-121 to 128)
- `docs/sprints/sprint-2.md` — brief (Zybit-133 to 137)
- `docs/sprints/sprint-3.md` — brief (Zybit-141 to 148)
- `docs/sprints/sprint-4.md` — brief (Zybit-153 to 157)
- `docs/sprints/sprint-5.md` — brief (Zybit-161 to 165)

### State of the codebase as of this session

All items from the previous sprint are shipped (GA4 connector, PostHog bridge, last-computed-at, guardrail visual, learn Layer 1, Stripe bug fixes). The core loop (Understand → Identify → Propose → Test → Measure → Learn Layer 1) is built. What remains is hardening, demo readiness, the AI advisor, and observability.

### What's next

Start Sprint 0. Suggested split:
- Engineer 1: Zybit-114 (Stripe), Zybit-116 (Edge Config kill-switch), Zybit-118 (snapshot cadence)
- Engineer 2: Zybit-115 (auth rate limiting), Zybit-117 (Browserless live test), Zybit-119 (experiment overlap)
- Zybit-120 (E2E smoke test) — begin in parallel with Sprint 1, does not gate Sprint 0

### Open questions (not blocking Sprint 0)

- Vercel Blob plan tier — needed for Sprint 3 (screenshot storage). Check if current plan includes Blob or if it needs to be added.
- Gemini API key (`GEMINI_API_KEY`) — needed for Sprint 3 Zybit-144 (AI Variant Advisor). Using `@google/generative-ai` SDK with `gemini-2.0-flash`. Add to Vercel env vars before Sprint 3 starts.
- Ops alerts go to `asad@getzybit.com` via Resend — verify this address is confirmed in the Resend sender domain before Sprint 4.

---

<!-- Template for future entries:

## YYYY-MM-DD

**Session:** [what this session was about]
**Author:** —

### What shipped
- 

### Decisions made
- 

### Blockers
- 

### What's next
- 

-->

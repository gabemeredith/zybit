<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Zybit — Agent Context

## What Zybit is

Zybit is a conversion intelligence platform for product managers. It runs a six-step loop: **Understand** (audit the product via page snapshots) → **Watch** (ingest real user behavioral data) → **Identify** (surface evidence-backed friction findings) → **Propose** (generate A/B prescriptions) → **Test** (deploy variants to production traffic via proxy) → **Learn** (feed outcomes back into the rule engine to improve future findings).

**Full product doctrine and build philosophy:** [`DOCTRINE.md`](./DOCTRINE.md) — read it before making any architectural decisions.

---

## Build conventions (non-negotiable)

- **Deterministic over generative.** Audit rules are pure functions — same input, same output. No LLM-generated numbers or invented evidence.
- **PM-first at every layer.** Every output (finding title, evidence summary, UI label) is for a product manager, not an engineer.
- **Every file has a purpose.** No scaffolding, no placeholders, no "we might need this later."
- **Third-party where it's better.** Auth = invite-only magic-link sessions in `src/lib/auth/` (Clerk was removed in `a786d37`). Email = Resend. Billing = Stripe. Headless browser = Browserless.io. Cron monitoring = Cronitor. Observability = Axiom. Do not rebuild what third parties do well.
- **Third-party where it's better.** Email = Resend. Billing = Stripe. Headless browser = Browserless.io. Cron monitoring = Cronitor. Observability = Axiom. Do not rebuild what third parties do well. (Auth is owned: invite-only magic-link system, no Clerk.)
- **`npm run verify` must pass** before any commit: lint + TypeScript + build.

---

## Codebase map

```
zybit/
  src/lib/phase2/flow/        — Flow-graph derivation, data model, layout engine (PRD Milestone 1)
  src/lib/phase2/rules/       — 19 audit rules (5 design + 7 pain + 1 flow + 6 structural); 72 test files in repo
  src/lib/phase2/connectors/  — PostHog (pull-sync) + Segment (webhook)
  src/lib/phase2/snapshots/   — Static HTML parse + visual-weight analysis
  src/lib/phase2/rollups/     — Event → InsightInput aggregation pipeline
  src/lib/phase1/             — Readiness scoring + legacy insights engine
  src/lib/auth/               — Invite-only magic-link auth + M2M API keys
  src/lib/billing/            — Stripe integration (plans, limits, usage metering)
  src/lib/experiments/        — Bucketing, HTML modifier, edge proxy (partial), AI Variant Advisor (`aiAdvisor.ts`) + per-org daily rate limit (`aiAdvisorRateLimit.ts`)
  src/lib/observability/      — Cronitor, error budget, structured logger
  src/lib/db/                 — Drizzle schema + Postgres client (Neon)
  src/app/api/phase1/         — Readiness + insights HTTP API
  src/app/api/phase2/         — Canonical events, insights run, connectors, snapshots
  src/app/api/dashboard/      — Findings and experiments CRUD
  src/app/api/billing/        — Stripe checkout, portal, usage, webhook
  src/app/api/proxy/          — Edge proxy assignment + config
  src/app/app/                — PM dashboard (findings, experiments, onboarding, settings)
  drizzle/                    — SQL migrations (apply before first run with Postgres)
  docs/                       — Technical reference
```

---

## Current build state

| Loop Step | Status | Notes |
|-----------|--------|-------|
| **Understand** (snapshot audit) | ⚠️ Partial | HTTP + DOM parse works; SPA/JS-rendered pages trigger Browserless fallback (`browserFetcher.ts`, gated on `BROWSERLESS_KEY`). **Browserless live-verified 2026-05-22** — a client-rendered SPA that returned an empty HTTP shell rendered fully via Browserless (`snapshotMethod: 'browser'`). snapshotMethod field on records. CSS system detection (Tailwind/styled-components/Emotion/CSS-Modules/Bootstrap) now runs at parse time and stored as `cssSystem` on `PageSnapshotData` (Zybit-122). Scheduled snapshot refresh + HTML drift detection shipped — `refresh-snapshots` cron (daily 03:00 UTC) re-fetches latest snapshot per pathRef, compares `contentHash`; cockpit surfaces `snapshots.staleDays` with an amber banner > 7 days (Zybit-023), now broken out **per pathRef** so the PM sees which pages are stale (Zybit-135). |
| **Watch** (PostHog + Segment + GA4) | ✅ Built | PostHog + Segment built; PostHog visitor-ID bridge shipped; GA4 connector shipped — service-account JWT (Web Crypto), `runReport` offset pagination, cursor, `runGA4PullSyncJob` + `/cron/sync-ga4` every 30m. GA4 is aggregate-grain (Identify/Propose only, not joinable to assignments). Segment webhook has a batch schema guard (`guardSegmentBatch` — rejects malformed/oversized payloads, Zybit-137). PostHog bridge health probe surfaces an amber "bridge not detected" cockpit banner when experiment assignments exist but no conversion joins (Zybit-126). |
| **Identify** (19 audit rules) | ✅ Built | 5 design + 7 pain + 1 flow + 6 structural rules. **Structural rules (Layer E)** are snapshot-only (no behavioral events required): `headingHierarchyJump`, `formLabelMissing`, `imageAltTextMissing`, `linkTextGeneric`, `missingMetaDescription`, `missingCanonicalUrl`. New rules must be deterministic pure functions grounded in snapshot or behavioral data — no LLM calls, no invented numbers. Dollar figures removed from `impactEstimate` — revenue/ecommerce goal types now emit conversion counts, not currency amounts. `proposeAnnotations` rewritten across all 9 annotated rules so each preview anchor matches its prescription (return-visit-thrash anchors a quick-answer placeholder above hero; help-seeking-spike anchors FAQ above the CTA; hesitation-pattern anchors a proof line above the CTA; above-fold-coverage shows the duplicate-CTA placement; bounce-on-key-page captions the first heading). User profile extended on `app_users` with `industry`, `role_title`, `last_audit_at`; new `app_user_rules_fired` table (id, user_id, org_id, site_id, finding_id, rule_id, fired_at, created_at, 4 indexes) scaffolds future personalization/onboarding analytics (writers TBD). Migration `0022_user_profile_and_audit_tracking.sql` applied to Neon. |
| **Flow-graph advisory** (PRD Milestone 1) | ✅ Built | All 5 PRD scope items complete: derivation (`deriveFlowGraph`), data model (`phase2_flow_graph` table + migration `0017`), graph view (`/app/flow` + `FlowGraphView.tsx`), flow-aware finding (`flow-inter-step-dropoff`), credibility slice (`flow-funnel` diagram in EvidencePanel). Migration `0017` **applied to Neon 2026-05-22** (table `phase2_flow_graph` + org index verified live). |
| **Propose** (findings + prescriptions) | ✅ Built | Ranked by priority score + revenue impact, PM-readable. Selector validation badge (500ms debounced, Zybit-121). CSS system hint in experiment builder when 'Swap CSS classes' selected (Zybit-122). Dead-state UX shows session progress bar vs threshold (Zybit-124). Deterministic copy-quality hints on the variant-copy field (`copyHints`, Zybit-125). Selector suggestions carry stability tiers (stable/medium/fragile, sorted stable-first) so PMs pick durable selectors (Zybit-134). `AnnotatedFindingPreview` now renders a per-rule "why this is highlighted" callout so the PM sees the rule-specific rationale next to each annotated anchor. Experiment-builder selector auto-fill bug fixed — was emitting `[data-zybit-ref=…]` instead of real CSS selectors; `pickSelectorForFinding` + the structural snapshot's `form.cssSelector` are now re-emitted in `buildMinimalHtml` so the validator agrees with the builder. **Design token extraction (Zybit-143)** — `extractDesignTokens` pure function derives a compact token set (primary/secondary/accent colour, font family, type scale, border radius, CTA vocabulary) from the captured computed styles and is co-written atomically into the design-snapshot row by `buildFullDesignSnapshot`. **AI Variant Advisor (Zybit-144)** — `POST /api/dashboard/experiments/ai-suggest` calls Gemini 2.0 Flash via REST and returns up to 3 schema-valid `VariantModification[]` proposals per finding; output validated against a selector allowlist (CTAs + forms only — headings are out of scope because the structural snapshot lacks per-heading `cssSelector`), an `attribute-set` attribute allowlist, `css-inject` content checks, and `text-replace` sanitisation; the prompt uses prescription delimiters to resist injection from finding text. `element-reorder` is deliberately excluded from the AI surface. Returns 503 if `GEMINI_API_KEY` is unset (PMs fall back to manual entry). **Proposals only — nothing applies them to a live DOM yet (Zybit-149 variant runtime not built).** |
| **Test** (variant deployment) | ⚠️ Partial | Bucketing + HTML modifier + proxy routes built. Network-error fail-open, modification-error fail-open, kill switch (`experiment.status === 'running'`), origin timeout (10s) all shipped in `handler.ts`. SPA shell detection logs a warning at proxy time; **launch-time SPA guard (Zybit-123)** — `launchExperimentAction` fetches the target page, runs `isSpaHtml`, and a client-side-rendered page triggers a warn-and-acknowledge banner before launch (the proxy modifies server-rendered HTML, so a SPA variant would silently render identical to control and pollute outcomes). Fails open on fetch error. DNS verify now probes HTTPS after CNAME check (`proxyLive` flag) to distinguish CNAME-only from fully-live proxy. Overlap warn-and-proceed (Zybit-119): running experiments on same site trigger acknowledgment banner; `overlappingExperimentIds` stored for audit. Draft→running "Launch experiment" button added to ExperimentControls. Edge Config kill-switch (Zybit-116): stopping/concluding an experiment writes a `disabledExperiments` key the proxy honors at the edge, failing closed without a DB round-trip. Daily `check-selectors` cron re-validates running experiments' selectors against the latest snapshot and emails the PM on a miss (Zybit-133). **`element-insert` shipped 2026-05-25** — `VariantModification` gains a 7th type that splices new HTML next to an anchor (DOM-standard `before`/`after`/`prepend`/`append`); `sanitizeInsertHtml.ts` enforces a tag+attribute allowlist (no `<script>`/`<iframe>`/`<form>`, no inline handlers, no `javascript:`/`data:` URLs). Experiment builder UI gains an "Add new section" change type so PMs can author "add a top-of-page quick-answer section" or "add an anchor nav" briefs that previously had no expressible form. Brief schema extended with `insertPosition`; launch path + `describeModification` + experiment detail page all updated. Return-visit-thrash findings now default to the `insert` change type so the AcmeBank quick-answer prescription pre-loads with a starter HTML scaffold. Tests: 4 positions + sanitization + fail-open. **CSP/XSS hardening shipped:** `stripScripts` fails closed, defeats the `javascript:` HTML-entity bypass, strips `data:` URIs + frame-creating elements + `<meta http-equiv="refresh">`; SSRF guard re-checks on every redirect hop and `phase1Sites` lookup is now tenant-scoped; the lighthouse preview CSP origin is env-gated via `LIGHTHOUSE_PREVIEW_ORIGIN` (optional, validated as `scheme://host[:port]`, defaults to `frame-ancestors 'self'`); screenshot route now returns 502 (not 200) on render fail; plus defensive nits — optional-chain on `snapshot.data`, `<img onError>`, modal a11y. |
| **Measure** (outcome computation) | ✅ Built | OBF alpha-spending (`stats.ts`), daily cron. PostHog visitor-ID bridge + auto-stop/guardrail PM email shipped. "Last computed at" surfaced in cockpit (Zybit-086, `MAX(experiment.updatedAt)`). **neon-http driver fix** (caught by live Lighthouse Phase 2): `queryBucketCounts` reads `result.rows` (neon-http returns a result object, not an array); `concludeExperiment` uses sequential writes instead of `db.transaction` (unsupported on neon-http). Verified end-to-end. **GA4-only sites skipped (Zybit-157):** `computeAllOutcomes` checks `isGa4OnlyMeasurementGap` per site and skips compute with a structured warning — GA4 is aggregate-grain and cannot be joined to assignments. |
| **Learn** (outcome feedback loop) | ✅ Built (L1+L2, PM-visible) | Layer 1 — per-site re-ranking via `applyLearnRerank`; persisted as `learn_adjustment` jsonb, surfaced as backlog pill, finding-detail "Past tests" panel, LEARNED timeline entry. **Layer 2** — per-site rule-threshold calibration (`ruleCalibration.ts`): `computeRuleCalibrations` aggregates outcomes per `ruleId` into `clamp(1 − netSignal, 0.7, 1.3)` multiplier (gated at 3+ conclusive outcomes); 11/12 rules route through `calibratedFloor`/`calibratedCap` (`hero-hierarchy-inversion` exempt — sample-size-only gate). **PM-visible (Zybit-164 equivalent):** calibration receipt stored in `learnAdjustment.calibration` jsonb; "Tuned" badge on findings backlog; "Tuned for your site" panel on finding detail (direction + multiplier + basis count); calibration note on LEARNED timeline entries. **Lighthouse-verified:** runner now seeds 3 prior outcomes after step 4.5 and re-runs the pipeline (step 4.6) to confirm calibration fires; `GenerateResult.layer2` carries the diagnostic. Security: `listForSite`/`listByIds` scope by `organizationId`. Layer 3 (cross-site priors) deferred until 50+ customers. |
| **Visible loop view** | ✅ Built | Timeline merge + per-entry rendering + empty state + detail links; guardrail-breach amber badge (Zybit-091), multi-site pill selector (Zybit-092), and LEARNED entries (Zybit-093) all shipped. |
| **Preview before deploy** | ✅ Built | Side-by-side control/variant iframes on experiment detail page; CSP `frame-ancestors 'self'` on preview response |
| **GA4 connector** | ✅ Built | `client.ts` (JWT+OAuth+runReport), `secrets.ts`, `cursor.ts`, `mapping.ts`, `sync.ts`, job + cron. 18 unit tests. |
| **Billing** (Stripe + plan limits) | ✅ Built | Metering + hard enforcement (sites/experiments 402) + events soft-cap shipped. Round-trip code bugs fixed: post-checkout redirect pointed at a non-existent `/dashboard/settings` (→ `/app/settings`); cross-instance-stale plan cache removed so enforcement reads the webhook-written plan immediately; webhook validates planId before persisting. **Round trip verified end-to-end 2026-05-22** — 18/18 checks against the live test API + real webhook handler + Neon (checkout → `checkout.session.completed`/`subscription.updated`/`subscription.deleted` → `organizations.plan` write → bad-signature 400 → `checkPlanLimit` 402). Production env still needs `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_*` set in Vercel. |
| **Observability** | ✅ Built | Cronitor + error budget + structured logger wired into crons; Axiom drain connected — best-effort fire-and-forget ingest in `logger.ts`, active when `AXIOM_TOKEN`+`AXIOM_DATASET` set; console JSON output preserved for platform drains. **Axiom verified (2026-05-21):** token confirmed working; dataset `axiom-audit` confirmed writeable. Set `AXIOM_DATASET=axiom-audit` in Vercel env vars to activate (Zybit-153 gate criteria met). |
| **Integration health (cockpit)** | ✅ Built | `deriveIntegrationHealth()` in `cockpit.ts`; `PipelineHealth` in `CockpitView.tsx` shows "Zybit is watching" / "No data yet" / "Degraded" + last-sync + 7-day event count (Zybit-111) |
| **Activation (onboarding)** | ⚠️ Partial | MRR/AOV now required to finish onboarding (Zybit-113, no skip). First-insight email exists. **Flow-graph pre-flight check shipped (2026-05-23)** — `computeFlowPreflight` (`src/lib/phase2/flow/preflight.ts`) derives a `ready` / `thin` / `empty` verdict + PM-readable diagnostics from canonical events; `GET /api/phase2/sites/:siteId/flow-preflight` + `runFlowPreflightAction` answer PRD §5's one hard dependency before promising the graph. Wizard redesign scoped in `docs/sprints/onboarding-redesign.md`. |
| **Auth security** | ✅ Built | Magic-link auth. Rate limiting on `/api/auth/request-link`: 3 req/10min per email, 10 req/10min per IP via `auth_rate_limits` table (Zybit-115). Single active token per email (old tokens invalidated on re-request). |
| **AI Variant Advisor cost guard** | ✅ Built | Per-org daily rate limit (10 AI suggestions / org / UTC day) via atomic upsert on `phase2_ai_advisor_usage` (migration `0018`); denied calls return 429 and **do not bump the counter**. Structured cost logging under `service: 'ai-advisor'` records token usage per call (Zybit-148). |
| **Public URL-audit lead magnet** | ⚠️ Partial | Phases A + B shipped 2026-05-23 in PR #69. `/audit` form (URL + work email + role), personal-email reject, SSRF-protected URL validator (`urlValidator.ts`), double opt-in via `audit_tokens` table, multi-dim sliding-window rate limits (IP / email / email-domain / target-host) + $25/day budget cap (`publicAuditRateLimit.ts`), atomic CAS in `/api/audit/public/confirm`, secret-gated `/api/audit/public/run` that calls `runUrlAudit` from Lighthouse, structural-copy override for synthetic-grounded rules, optional Browserless screenshot + Gemini 2.0 Flash vision caption (`visionPass.ts`), report email with receipt-card pattern + 4 ranked findings (`auditReportEmail.ts`). Kill-switch via `PUBLIC_AUDIT_ENABLED=0`. Migration `0019` adds `public_audits`, `audit_tokens`, `public_audit_rate_limits`, `public_audit_budget`. **Spec gaps deliberately deferred** (see `docs/sprints/url-audit-lead-magnet.md` §4a): Cloudflare Turnstile, 90-day TTL cron + privacy policy + opt-out, OWASP-payload SSRF test suite, idempotent resubmits + suppression list, hashed IP storage, Axiom + Cronitor wiring. Phase C (founder approval queue) not built. **Phase D (marketing surface) shipped 2026-05-24** — `/audit` linked from the landing-page nav (replaced the unused "Interactive Preview" link) and from the bottom-of-page hero CTA ("Run a free audit"); IntakeModal kept as the secondary product-waitlist path. Landing-page prose tightened to premium-B2B (outcome-first, evidence-first, founder bio trimmed). Followup hardening in same change: success-path + email-failure + pipeline-error + budget-fail + revalidation-fail `UPDATE`s in `/api/audit/public/run` now guarded on `AND status = 'running'` to stay idempotent with the lazy-flip recovery in `/api/audit/public/status`; `/audit/email-preview` production guard switched from `&&` to `||` so a non-Vercel production deployment can't expose the dev preview. **Audit→product funnel shipped on `feat/improve-audit` (2026-05-24)** — `/api/audit/public/confirm` now auto-provisions an approved `appUsers` row + an org named after the audited domain on a successful token consume (fail-soft via `console.error` if either insert throws), and sets a signed `zb_audit_confirmed` cookie (HMAC over `auditId\|expiry`, 7-day TTL, see `src/lib/audit/cookies.ts`). Report email replaces the single Calendly CTA with a primary "See these in your dashboard →" link hitting the new `GET /api/auth/request-link-from-audit?e=&a=&s=` route, which verifies the HMAC over `email\|auditId`, re-checks rate limits, calls `createMagicLink`, and 302s back to `/audit/[id]?signin=sent`. `/api/audit/public/status` now emits trimmed `findings.slice(0,2)` + a server-minted `signupLink` only when the confirmation cookie verifies — forwarding the URL gives the recipient a hollow "ready" state with no PII. `/audit/[id]` done state renders the inline findings + signup-first CTA; Calendly demoted to an outline button. Both confirmation + report emails now default to `asad@getzybit.com` via unified `AUDIT_FROM_EMAIL` env var (was `onboarding@resend.dev` + a separate `AUDIT_REPORT_FROM_EMAIL`). Migration `0020` adds `app_users.source` + `source_audit_id`. New env: `PUBLIC_AUDIT_SIGNING_SECRET` (required in prod). **Funnel hardening:** confirmation cookie now enforces a strict hex-format guard before HMAC verify (rejects mutated values before the constant-time compare); email normalization (lowercase + trim) applied before HMAC so Outlook safelink rewrites survive the round trip; `AUDIT_FROM_EMAIL` env precedence fixed so a missing value falls through cleanly; `signupLink` only minted when `status === 'done'` (no premature dashboard hand-off); email param dropped from the post-confirm redirect URL; auto-provision failures now log structured errors instead of silently swallowing. |

## Immediate build order

> **Status (2026-05-23):** Full sprint audit + live verification — see
> `docs/sprints/REMEDIATION.md` for the definitive per-ticket list. **23/39
> tickets done (Zybit-156 operator dashboard shipped 2026-05-23), 3 partial,
> 5 in open PRs (2 in PR #58, 3 in PR #66), 3 deferred per PRD (Zybit-145/146/149),
> 4 not built, 2 superseded.**
> - **Sprint 0:** 6/7 done. Zybit-114 (Stripe) **verified live end-to-end**;
>   Zybit-118 (snapshot cadence) partial.
> - **Sprint 1:** 5/8 done. Zybit-124 partial; Zybit-127/128 (demo seed +
>   synthetic outcomes) not built.
> - **Sprint 2:** ✅ 5/5 complete.
> - **Sprint 3:** Zybit-141/142 in open PR #58 (migration `0016` applied to
>   Neon). **Zybit-143/144/148 shipped in open PR #66** (`feat/sprint-3-followup`) —
>   design token extraction, AI Variant Advisor API (Gemini 2.0 Flash, REST,
>   strict validation), per-org daily rate limit + cost logging. Migration
>   `0018` ships with the PR and needs to be applied to Neon before the route
>   goes live; `GEMINI_API_KEY` needs to be set in Vercel (route returns 503
>   without it — non-essential, PMs build manually). Zybit-145/146/149
>   deferred per PRD (see `docs/sprints/sprint-3-deferred.md`); Zybit-147
>   partial. **Without Zybit-149 the advisor returns proposals only; nothing
>   applies them to a live DOM yet.**
> - **Sprint 4:** ✅ 5/5 done. Zybit-156 (operator dashboard) shipped 2026-05-23 — read-only `/admin/ops`.
> - **Sprint 5:** 2/5 done (163/164); 161/162 superseded by on-the-fly
>   calibration; 165 (operator visibility) not built.
>
> The deterministic six-step loop is built and live-verified. Zybit-156
> (operator dashboard) shipped 2026-05-23. Remaining engineering work is
> Sprint 3 (deferred per PRD — see `docs/sprints/sprint-3-deferred.md`).
> Definitive per-ticket list: `docs/sprints/REMEDIATION.md`.

## What's needed before first real customer

| Gap | Status | Notes |
|-----|--------|-------|
| Axiom `AXIOM_DATASET=axiom-audit` env var in Vercel | ⬛ **Action needed** | Token verified and present in env; dataset confirmed. One Vercel env var to set. |
| Live Stripe round-trip verification | ✅ **Verified (2026-05-22)** | Full round trip exercised end-to-end against the live test API + real webhook handler + Neon: checkout → `checkout.session.completed`/`subscription.updated`/`subscription.deleted` → `organizations.plan` write → bad-signature 400 → `checkPlanLimit` 402. 18/18 checks passed, scoped to a throwaway org. |
| Connector circuit breaker (Zybit-154) | ✅ Shipped | `errorBudget.ts` degrades at 3 / disconnects at 5 failures + ops email; sync crons now **skip `disconnected` integrations**; `POST /api/phase2/integrations/:id/resume` clears the breaker. |
| Cron failure email alerts (Zybit-155) | ✅ Shipped | `withCronAlert` wraps all 5 cron routes — unhandled throw or 5xx → structured log + Resend ops email. |
| Operator dashboard (Zybit-156) | ✅ Shipped (MVP) | Read-only ops view at `/admin/ops` — one row per org/site with plan, connectors (per-provider health dot + consecutive-failure count + last error code), last event timestamp, snapshot count + age, open-finding count. Sortable by urgency / last-event / org; filterable by org or domain. Reuses existing `ADMIN_COOKIE` gate. Pure helpers (`formatTimeAgo`, `connectorHealth`, `siteHealth`) covered by 19 unit tests. |
| GA4 measurement limitation warning (Zybit-157) | ✅ Shipped | `isGa4OnlyMeasurementGap` predicate; amber cockpit banner when GA4 is the only connector; `compute-outcomes` skips GA4-only sites with a structured warning instead of producing 0-confidence noise. |
| Layer 2 calibration needs real outcome history | ⬛ Inert until data | Works mechanically (Lighthouse-verified). Needs 3+ concluded experiments per rule per site before it affects anything. |

1. **Set `AXIOM_DATASET=axiom-audit` in Vercel** — one env var, zero code. Activates structured log drain (Zybit-153 gate).
2. ~~**Live Stripe round-trip verification**~~ **Verified 2026-05-22** — 18/18 checks end-to-end (checkout → webhooks → plan write → `checkPlanLimit` 402). Production env still needs `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_STARTER`/`_GROWTH`/`_SCALE` set in Vercel for the real checkout flow.
3. ~~**GA4 limitation warning** (Zybit-157)~~ **Shipped** — amber cockpit banner + `compute-outcomes` skip for GA4-only sites.
4. ~~**Connector circuit breaker** (Zybit-154)~~ **Shipped** — `errorBudget.ts` degrades/disconnects on consecutive failures; sync crons skip `disconnected` integrations; resume route clears the breaker.
5. ~~**Cron failure email** (Zybit-155)~~ **Shipped** — `withCronAlert` wraps all 5 cron routes.
6. ~~**Learn — Layer 2**~~ **Shipped + PM-visible** — calibration receipt in `learnAdjustment.calibration` jsonb; "Tuned" backlog badge; detail panel; LEARNED timeline note; Lighthouse step 4.6 verifies end-to-end.

**Never build:** sentiment analysis, GitHub PR generation, own event collection SDK / PostHog replacement, cross-site priors before 50+ customers. **Rules:** behavioral (event-based) rules are frozen at 12. New rules must be grounded in snapshot data (structural/SEO/accessibility) and deterministic — no LLM calls in rule logic.

**For full specifications:** `docs/ARCHITECTURE.md` — "Priority Build Items" section. `docs/BACKLOG.md` — Epics J, K, L, M.

**For the gap analysis and build plan:** [`../product_gap.md`](../product_gap.md)

---

## Document map

**For the persona-routed entry point and the full doc list, see
[`docs/INDEX.md`](./docs/INDEX.md).** The table below is the
narrower "if you're modifying code, update this doc when…" map.

| Document | Purpose | Update when... |
|----------|---------|----------------|
| `docs/INDEX.md` | Persona-routed entry point + full doc list with one-line summaries | A doc is added, removed, or its purpose changes |
| `DOCTRINE.md` | Product vision, who it's for, build conventions | Scope changes or build philosophy evolves (status lives here in this file) |
| `docs/ARCHITECTURE.md` | Technical reference — per-component file paths, schema, design decisions | New components are added or moved (status lives here in this file) |
| `docs/BACKLOG.md` | Prioritized epics and stories | Stories ship, priorities change |
| `../product_gap.md` | Historical gap analysis + architectural reasoning | Major architectural decisions are made (status lives here in this file) |
| `README.md` | Project overview, local setup, env vars | Env vars added or removed |
| `docs/PHASE2_EVIDENCE_MODEL.md` | Canonical event schema, audit rule contracts | Event schema or rule interface changes |
| `docs/PHASE2_LIVE_TUNING_PLAYBOOK.md` | Operator runbook for rule calibration | Rule thresholds or tuning approach changes |
| `docs/sprints/next-bets.md` | Forward-looking priority list | Priorities reshuffle or a bet completes |
| `docs/competitive-landscape.md` | Competitor map, wedge analysis, threats | Quarterly re-read; update when a competitor materially shifts |
| `docs/curriculum.md` | Founders' reading list | New essential reading is discovered |

---

## End-of-session obligations

**After every session where you write or modify code, update the relevant documentation.** These documents are the project's source of truth — they must reflect reality, not aspirations. Do not skip this step.

### Checklist

1. **Did you ship a feature that was listed as "not built" or "partial"?**
   - Update `docs/ARCHITECTURE.md` — move it from "What Needs to Be Built" into "What Exists"
   - Update the "Current build state" table above in this file
   - Update `DOCTRINE.md` — "Where we are today" section

2. **Did you complete a backlog story?**
   - Update `docs/BACKLOG.md` — mark the story **Shipped** with a brief note

3. **Did you close or partially close a gap from the gap analysis?**
   - Update `../product_gap.md` — update the status table row for the affected gap

4. **Did you add, rename, or remove API routes, env vars, or major source directories?**
   - Update `README.md` — env var table and repository structure
   - Update `DOCTRINE.md` — codebase map
   - Update `docs/ARCHITECTURE.md` — relevant component tables

5. **Did you change the canonical event schema or an audit rule interface?**
   - Update `docs/PHASE2_EVIDENCE_MODEL.md`

6. **Did you add, remove, or substantially change an audit rule?**
   - Update the rule count in `docs/ARCHITECTURE.md`
   - Update rule counts in `DOCTRINE.md` if referenced

### How to update

- Be factual and minimal. Change only what changed.
- Do not remove historical context — revise sections to reflect current state rather than erasing prior descriptions.
- If the change is a small bug fix, a one-line status note is sufficient.
- If the change closes a major gap, update all affected documents in the checklist above.
- Include documentation changes in the same commit as the code change.

### Single source of truth (consolidation 2026-05-23)

The **"Current build state" table above is the canonical record** of
what is built, partial, or not yet built. The previously-duplicated
status sections in `DOCTRINE.md`, `docs/ARCHITECTURE.md`, and
`../product_gap.md` were collapsed into pointers that reference this
table — so a feature shipping now requires updating exactly **one**
file.

If you find any stale status mention elsewhere in the docs, replace
it with a pointer back to this section.

`docs/ARCHITECTURE.md` still holds the **technical reference**
(per-component file paths, schema, design decisions). That is
complementary to this status table, not duplicative.

For the persona-routed entry point to the full doc set, see
[`docs/INDEX.md`](./docs/INDEX.md).

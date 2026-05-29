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
- **Third-party where it's better.** Auth = owned approved-access sessions in `src/lib/auth/` (email+password via scrypt + hand-rolled Google OAuth, both terminating in the owned `createSession`; Clerk was removed in `a786d37`). Email = Resend. Billing = Stripe. Headless browser = Browserless.io. Cron monitoring = Cronitor. Observability = Axiom. Do not rebuild what third parties do well.
- **Third-party where it's better.** Email = Resend. Billing = Stripe. Headless browser = Browserless.io. Cron monitoring = Cronitor. Observability = Axiom. Do not rebuild what third parties do well. (Auth is owned: approved-access password + Google OAuth on the owned session layer, no Clerk.)
- **AI provider = OpenAI.** Every text / vision / image-edit call routes through the shared client `src/lib/ai/openai.ts` (replaced the per-file Gemini REST integrations 2026-05). Default models: `gpt-5.4` (reasoning — variant advisor, audit fix advisor), `gpt-5.4-mini` (capture-time extraction + screenshot quality gate), `gpt-image-1` (Tier-2 inpaint), all env-overridable. Key: `OPENAI_API_KEY`. Inline "Gemini 2.0 Flash" / "gemini-3.5-flash" mentions elsewhere in this file are historical — the trust model (structured-output + strict validator + fail-soft, cached on the snapshot) is unchanged.
- **`npm run verify` must pass** before any commit: lint + TypeScript + build.

---

## Codebase map

```
zybit/
  src/lib/phase2/flow/        — Flow-graph derivation, data model, layout engine (PRD Milestone 1)
  src/lib/phase2/rules/       — 23 audit rules (5 design + 7 pain + 1 flow + 7 structural + 3 AI copy critique); 83 test files in repo
  src/lib/phase2/connectors/  — PostHog (pull-sync) + Segment (webhook)
  src/lib/phase2/snapshots/   — Static HTML parse + visual-weight analysis
  src/lib/phase2/rollups/     — Event → InsightInput aggregation pipeline
  src/lib/phase1/             — Readiness scoring + legacy insights engine
  src/lib/audit/fixPreview/   — Before/after fix-preview pipeline (audit-mode AI advisor w/ screenshot vision channel, Browserless route()-intercept render, Nano Banana 2 inpaint, three-tier ladder)
  src/lib/auth/               — Approved-access auth (password + Google OAuth, owned session layer) + M2M API keys
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
| **Identify** (23 audit rules) | ✅ Built | 5 design + 7 pain + 1 flow + 7 structural + **3 AI copy critique (Layer F, new)** rules. **Structural rules (Layer E)** are snapshot-only (no behavioral events required): `headingHierarchyJump`, `formLabelMissing`, `imageAltTextMissing`, `linkTextGeneric`, `missingMetaDescription`, `missingCanonicalUrl`, `deadClickTarget`. **AI copy critique (Layer F, 2026-05-26)** — `vagueClaimDetected`, `proofMissing`, `ctaVerbMismatch`. Capture-time Gemini 2.0 Flash call (`captureCopyCritique.ts`, mirrors `captureVisualSignals` trust model: structured-output + strict validator + fail-soft) produces a `CopyCritique` superset cached on `snapshot.data.copyCritique`; the three rules are pure deterministic functions over that cached output, `publicAuditBehavior: 'as-is'`. **PageType modulation (Ring 2 consumer, 2026-05-26)** — new `pageTypeModulation.ts` table consumed by `aboveFoldCoverage`, `navDispersion`, `linkTextGeneric`, `headingHierarchyJump`, `missingMetaDescription`, `missingCanonicalUrl`. Suppresses or modulates per (rule, pageType) — e.g. `aboveFoldCoverage` is suppressed on `blog`/`legal`/`docs`/`about`/`support`; `navDispersion` is suppressed on `docs`/`legal`. Fail-open: rules degrade to base thresholds when vision didn't run. **Parser-level skip-link filter** (`isSkipLink` in `parser.ts`) excludes "Skip to content"/"Jump to navigation" patterns from the CTA inventory at the source so no downstream rule treats a11y skip-links as conversion CTAs. **Hero-hierarchy-inversion vision fallback** — reads `visualPrimaryCta.text` when parser CTA text is empty (icon-only "Get started" hero no longer surfaces as `(unnamed button)`). **`aboveFoldCoverage.structuralPublicAuditCopy` vision fallback** — borrows `visualPrimaryCta.text` for evidence; drops finding rather than rendering fabricated "(unnamed CTA)" copy. New rules must be deterministic pure functions grounded in snapshot or behavioral data — no LLM calls **inside rule logic** (LLM calls are allowed at capture time, validated against a strict schema before the rule reads them). Dollar figures removed from `impactEstimate` — revenue/ecommerce goal types now emit conversion counts, not currency amounts. `proposeAnnotations` rewritten across all 9 annotated rules so each preview anchor matches its prescription (return-visit-thrash anchors a quick-answer placeholder above hero; help-seeking-spike anchors FAQ above the CTA; hesitation-pattern anchors a proof line above the CTA; above-fold-coverage shows the duplicate-CTA placement; bounce-on-key-page captions the first heading). User profile extended on `app_users` with `industry`, `role_title`, `last_audit_at`; new `app_user_rules_fired` table (id, user_id, org_id, site_id, finding_id, rule_id, fired_at, created_at, 4 indexes) scaffolds future personalization/onboarding analytics (writers TBD). Migration `0022_user_profile_and_audit_tracking.sql` applied to Neon. |
| **Flow-graph advisory** (PRD Milestone 1) | ✅ Built | All 5 PRD scope items complete: derivation (`deriveFlowGraph`), data model (`phase2_flow_graph` table + migration `0017`), graph view (`/app/flow` + `FlowGraphView.tsx`), flow-aware finding (`flow-inter-step-dropoff`), credibility slice (`flow-funnel` diagram in EvidencePanel). Migration `0017` **applied to Neon 2026-05-22** (table `phase2_flow_graph` + org index verified live). |
| **Propose** (findings + prescriptions) | ✅ Built | Ranked by priority score + revenue impact, PM-readable. Selector validation badge (500ms debounced, Zybit-121). CSS system hint in experiment builder when 'Swap CSS classes' selected (Zybit-122). Dead-state UX shows session progress bar vs threshold (Zybit-124). Deterministic copy-quality hints on the variant-copy field (`copyHints`, Zybit-125). Selector suggestions carry stability tiers (stable/medium/fragile, sorted stable-first) so PMs pick durable selectors (Zybit-134). `AnnotatedFindingPreview` now renders a per-rule "why this is highlighted" callout so the PM sees the rule-specific rationale next to each annotated anchor. Experiment-builder selector auto-fill bug fixed — was emitting `[data-zybit-ref=…]` instead of real CSS selectors; `pickSelectorForFinding` + the structural snapshot's `form.cssSelector` are now re-emitted in `buildMinimalHtml` so the validator agrees with the builder. **Design token extraction (Zybit-143)** — `extractDesignTokens` pure function derives a compact token set (primary/secondary/accent colour, font family, type scale, border radius, CTA vocabulary) from the captured computed styles and is co-written atomically into the design-snapshot row by `buildFullDesignSnapshot`. **AI Variant Advisor (Zybit-144)** — `POST /api/dashboard/experiments/ai-suggest` calls Gemini 2.0 Flash via REST and returns up to 3 schema-valid `VariantModification[]` proposals per finding; output validated against a selector allowlist (CTAs + forms + **headings** — heading `cssSelector` is populated by `findHeadings` in `parser.ts`, paired with PR #84's advisor expansion), an `attribute-set` attribute allowlist, `css-inject` content checks, `text-replace` sanitisation, and `element-insert` sanitised via `sanitizeInsertHtml` (4 KB cap pre-sanitize, rejects empty-after-sanitize payloads); the prompt uses prescription delimiters to resist injection from finding text. `nav`/`header` landmark CTAs are filtered out of the `ctaVocabulary` so the advisor's copy register is conversion copy, not IA labels. `element-reorder` is deliberately excluded from the AI surface. Returns 503 if `GEMINI_API_KEY` is unset (PMs fall back to manual entry). **Proposals only — nothing applies them to a live DOM yet (Zybit-149 variant runtime not built).** |
| **Test** (variant deployment) | ⚠️ Partial | Bucketing + HTML modifier + proxy routes built. Network-error fail-open, modification-error fail-open, kill switch (`experiment.status === 'running'`), origin timeout (10s) all shipped in `handler.ts`. SPA shell detection logs a warning at proxy time; **launch-time SPA guard (Zybit-123)** — `launchExperimentAction` fetches the target page, runs `isSpaHtml`, and a client-side-rendered page triggers a warn-and-acknowledge banner before launch (the proxy modifies server-rendered HTML, so a SPA variant would silently render identical to control and pollute outcomes). Fails open on fetch error. DNS verify now probes HTTPS after CNAME check (`proxyLive` flag) to distinguish CNAME-only from fully-live proxy. Overlap warn-and-proceed (Zybit-119): running experiments on same site trigger acknowledgment banner; `overlappingExperimentIds` stored for audit. Draft→running "Launch experiment" button added to ExperimentControls. Edge Config kill-switch (Zybit-116): stopping/concluding an experiment writes a `disabledExperiments` key the proxy honors at the edge, failing closed without a DB round-trip. Daily `check-selectors` cron re-validates running experiments' selectors against the latest snapshot and emails the PM on a miss (Zybit-133). **`element-insert` shipped 2026-05-25** — `VariantModification` gains a 7th type that splices new HTML next to an anchor (DOM-standard `before`/`after`/`prepend`/`append`); `sanitizeInsertHtml.ts` enforces a tag+attribute allowlist (no `<script>`/`<iframe>`/`<form>`, no inline handlers, no `javascript:`/`data:` URLs). Experiment builder UI gains an "Add new section" change type so PMs can author "add a top-of-page quick-answer section" or "add an anchor nav" briefs that previously had no expressible form. Brief schema extended with `insertPosition`; launch path + `describeModification` + experiment detail page all updated. Return-visit-thrash findings now default to the `insert` change type so the AcmeBank quick-answer prescription pre-loads with a starter HTML scaffold. Tests: 4 positions + sanitization + fail-open. **CSP/XSS hardening shipped:** `stripScripts` fails closed, defeats the `javascript:` HTML-entity bypass, strips `data:` URIs + frame-creating elements + `<meta http-equiv="refresh">`; SSRF guard re-checks on every redirect hop and `phase1Sites` lookup is now tenant-scoped; the lighthouse preview CSP origin is env-gated via `LIGHTHOUSE_PREVIEW_ORIGIN` (optional, validated as `scheme://host[:port]`, defaults to `frame-ancestors 'self'`); screenshot route now returns 502 (not 200) on render fail; plus defensive nits — optional-chain on `snapshot.data`, `<img onError>`, modal a11y. |
| **Measure** (outcome computation) | ✅ Built | OBF alpha-spending (`stats.ts`), daily cron. PostHog visitor-ID bridge + auto-stop/guardrail PM email shipped. "Last computed at" surfaced in cockpit (Zybit-086, `MAX(experiment.updatedAt)`). **neon-http driver fix** (caught by live Lighthouse Phase 2): `queryBucketCounts` reads `result.rows` (neon-http returns a result object, not an array); `concludeExperiment` uses sequential writes instead of `db.transaction` (unsupported on neon-http). Verified end-to-end. **GA4-only sites skipped (Zybit-157):** `computeAllOutcomes` checks `isGa4OnlyMeasurementGap` per site and skips compute with a structured warning — GA4 is aggregate-grain and cannot be joined to assignments. |
| **Learn** (outcome feedback loop) | ✅ Built (L1+L2, PM-visible) | Layer 1 — per-site re-ranking via `applyLearnRerank`; persisted as `learn_adjustment` jsonb, surfaced as backlog pill, finding-detail "Past tests" panel, LEARNED timeline entry. **Layer 2** — per-site rule-threshold calibration (`ruleCalibration.ts`): `computeRuleCalibrations` aggregates outcomes per `ruleId` into `clamp(1 − netSignal, 0.7, 1.3)` multiplier (gated at 3+ conclusive outcomes); 11/12 rules route through `calibratedFloor`/`calibratedCap` (`hero-hierarchy-inversion` exempt — sample-size-only gate). **PM-visible (Zybit-164 equivalent):** calibration receipt stored in `learnAdjustment.calibration` jsonb; "Tuned" badge on findings backlog; "Tuned for your site" panel on finding detail (direction + multiplier + basis count); calibration note on LEARNED timeline entries. **Lighthouse-verified:** runner now seeds 3 prior outcomes after step 4.5 and re-runs the pipeline (step 4.6) to confirm calibration fires; `GenerateResult.layer2` carries the diagnostic. Security: `listForSite`/`listByIds` scope by `organizationId`. Layer 3 (cross-site priors) deferred until 50+ customers. |
| **Visible loop view** | ✅ Built | Timeline merge + per-entry rendering + empty state + detail links; guardrail-breach amber badge (Zybit-091), multi-site pill selector (Zybit-092), and LEARNED entries (Zybit-093) all shipped. |
| **Preview before deploy** | ✅ Built | Side-by-side control/variant iframes on experiment detail page; CSP `frame-ancestors 'self'` on preview response |
| **GA4 connector** | ✅ Built | `client.ts` (JWT+OAuth+runReport), `secrets.ts`, `cursor.ts`, `mapping.ts`, `sync.ts`, job + cron. 18 unit tests. |
| **Billing** (Stripe + plan limits) | ✅ Built | Metering + hard enforcement (sites/experiments 402) + events soft-cap shipped. Round-trip code bugs fixed: post-checkout redirect pointed at a non-existent `/dashboard/settings` (→ `/app/settings`); cross-instance-stale plan cache removed so enforcement reads the webhook-written plan immediately; webhook validates planId before persisting. **Round trip verified end-to-end 2026-05-22** — 18/18 checks against the live test API + real webhook handler + Neon (checkout → `checkout.session.completed`/`subscription.updated`/`subscription.deleted` → `organizations.plan` write → bad-signature 400 → `checkPlanLimit` 402). Production env still needs `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_*` set in Vercel. |
| **Observability** | ✅ Built | Cronitor + error budget + structured logger wired into crons; Axiom drain connected — best-effort fire-and-forget ingest in `logger.ts`, active when `AXIOM_TOKEN`+`AXIOM_DATASET` set; console JSON output preserved for platform drains. **Axiom verified (2026-05-21):** token confirmed working; dataset `axiom-audit` confirmed writeable. Set `AXIOM_DATASET=axiom-audit` in Vercel env vars to activate (Zybit-153 gate criteria met). |
| **Integration health (cockpit)** | ✅ Built | `deriveIntegrationHealth()` in `cockpit.ts`; `PipelineHealth` in `CockpitView.tsx` shows "Zybit is watching" / "No data yet" / "Degraded" + last-sync + 7-day event count (Zybit-111) |
| **Activation (onboarding)** | ✅ Built | **Wizard trimmed to 3 steps (onboarding redesign Phase 5):** site → analytics → revenue. Proxy/DNS dropped from the critical path into `/app/settings` (`ProxySetupForm variant="settings"`, surfaced on deploy intent). The analytics step wires the **flow pre-flight** inline — `computeFlowPreflight` (`src/lib/phase2/flow/preflight.ts`) → `runFlowPreflightAction` renders a `ready`/`thin`/`empty` verdict so the PM sees "Zybit is receiving your events" before continuing. Revenue step is now skippable ("I'll add these later") with the "estimates only, never shared" reassurance above the inputs; finish lands in `/app/flow`. First-insight email exists. |
| **Auth security** | ✅ Built | **Real login shipped 2026-05-29 (onboarding/login redesign, Phases 1-3).** Email+password (`POST /api/auth/login`) — scrypt hash/verify in `src/lib/auth/password.ts` (`scrypt$N$salt$hash` format, timing-safe compare, no new dep) — plus hand-rolled Google OAuth (`src/lib/auth/google.ts` + `/api/auth/google/start` + `/callback`, CSRF state cookie, openid/email/profile scopes), both terminating in the owned `createSession`. First password set after approval via a one-time HMAC-signed link (`src/lib/auth/setPasswordToken.ts` → `POST /api/auth/set-password` → `/set-password` page). Login branches: approved+correct → session; approved+wrong → generic 401; approved+no-password → 403 `no-password` guidance; known pending lead → 403 humane "not approved yet"; unknown → generic 401 (closed-pilot enumeration tradeoff documented in `docs/sprints/onboarding-redesign.md`). Migration `0024` adds `app_users.password_hash`/`auth_provider`/`google_sub` (unique) + the `access_requests` pending queue. Sign-in page replaced magic-link UI with password + Google. Login rate limit is a forgiving **10 req/email/10min** (`LOGIN_EMAIL_LIMIT`, so a few password typos don't lock a user out); the magic-link `request-link` path keeps the stricter 3/10min. `request-link`/`callback` remain for the legacy admin-invite path only. **New env:** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URL`, `AUTH_SIGNING_SECRET`. **Migration `0024` applied to Neon 2026-05-29.** **E2E-verified 2026-05-29** against the live Next server + Neon: request → pending → humane login block → admin approve → welcome-token set-password → login (correct/wrong/revoked) + enumeration-safe unknown (19/19), and the full approval HTTP chain (admin approve → mint org+user + mark invited + save Stripe link → set-password → login, 11/11). |
| **Access-request queue + funnel** | ✅ Built | `access_requests` table (migration `0024`) is the single pending-lead queue keyed uniquely on email (upsert on re-request). `POST /api/intake` now persists `source='request_form'` leads (+ personal-email reject for parity with `/audit`) and keeps the founder notification; success copy is the honest 1:1 onboarding line (no "3 business days" promise). `/api/audit/public/confirm` no longer auto-provisions an approved `app_users`+org — it upserts `source='public_audit'` into the same queue (closes the hole where anyone confirming an audit got an approved account). The audit still runs and the report still ships; approval is a deliberate human act. **Approval flow shipped (Phase 4):** the `/admin` dashboard renders the unified pending queue (request-form + audit leads) with Approve / Reject / save-Stripe-link actions (`GET`/`POST /api/admin/access-requests`); Approve mints an `organizations` + approved `app_users` row, flips the request to `invited`, and sends a welcome email (`src/lib/email/welcomeEmail.ts`) carrying the one-time set-password link + "continue with Google". `/admin/leads` now joins `access_requests` to show each audit lead's queue status. Manual Stripe payment links (paste + save) — no automated checkout yet. |
| **AI Variant Advisor cost guard** | ✅ Built | Per-org daily rate limit (10 AI suggestions / org / UTC day) via atomic upsert on `phase2_ai_advisor_usage` (migration `0018`); denied calls return 429 and **do not bump the counter**. Structured cost logging under `service: 'ai-advisor'` records token usage per call (Zybit-148). |
| **Public URL-audit lead magnet** | ⚠️ Partial | Phases A + B shipped 2026-05-23 in PR #69. `/audit` form (URL + work email + role), personal-email reject, SSRF-protected URL validator (`urlValidator.ts`), double opt-in via `audit_tokens` table, multi-dim sliding-window rate limits (IP / email / email-domain / target-host) + $25/day budget cap (`publicAuditRateLimit.ts`), atomic CAS in `/api/audit/public/confirm`, secret-gated `/api/audit/public/run` that calls `runUrlAudit` from Lighthouse, structural-copy override for synthetic-grounded rules, optional Browserless screenshot + Gemini 2.0 Flash vision caption (`visionPass.ts`), report email with receipt-card pattern + 4 ranked findings (`auditReportEmail.ts`). Kill-switch via `PUBLIC_AUDIT_ENABLED=0`. Migration `0019` adds `public_audits`, `audit_tokens`, `public_audit_rate_limits`, `public_audit_budget`. **Spec gaps deliberately deferred** (see `docs/sprints/url-audit-lead-magnet.md` §4a): Cloudflare Turnstile, 90-day TTL cron + privacy policy + opt-out, OWASP-payload SSRF test suite, idempotent resubmits + suppression list, hashed IP storage, Axiom + Cronitor wiring. Phase C (founder approval queue) not built. **Phase D (marketing surface) shipped 2026-05-24** — `/audit` linked from the landing-page nav (replaced the unused "Interactive Preview" link) and from the bottom-of-page hero CTA ("Run a free audit"); IntakeModal kept as the secondary product-waitlist path. Landing-page prose tightened to premium-B2B (outcome-first, evidence-first, founder bio trimmed). Followup hardening in same change: success-path + email-failure + pipeline-error + budget-fail + revalidation-fail `UPDATE`s in `/api/audit/public/run` now guarded on `AND status = 'running'` to stay idempotent with the lazy-flip recovery in `/api/audit/public/status`; `/audit/email-preview` production guard switched from `&&` to `||` so a non-Vercel production deployment can't expose the dev preview. **Audit→product funnel shipped on `feat/improve-audit` (2026-05-24)** — `/api/audit/public/confirm` now auto-provisions an approved `appUsers` row + an org named after the audited domain on a successful token consume (fail-soft via `console.error` if either insert throws), and sets a signed `zb_audit_confirmed` cookie (HMAC over `auditId\|expiry`, 7-day TTL, see `src/lib/audit/cookies.ts`). Report email replaces the single Calendly CTA with a primary "See these in your dashboard →" link hitting the new `GET /api/auth/request-link-from-audit?e=&a=&s=` route, which verifies the HMAC over `email\|auditId`, re-checks rate limits, calls `createMagicLink`, and 302s back to `/audit/[id]?signin=sent`. `/api/audit/public/status` now emits trimmed `findings.slice(0,2)` + a server-minted `signupLink` only when the confirmation cookie verifies — forwarding the URL gives the recipient a hollow "ready" state with no PII. `/audit/[id]` done state renders the inline findings + signup-first CTA; Calendly demoted to an outline button. Both confirmation + report emails now default to `asad@getzybit.com` via unified `AUDIT_FROM_EMAIL` env var (was `onboarding@resend.dev` + a separate `AUDIT_REPORT_FROM_EMAIL`). Migration `0020` adds `app_users.source` + `source_audit_id`. New env: `PUBLIC_AUDIT_SIGNING_SECRET` (required in prod). **Funnel hardening:** confirmation cookie now enforces a strict hex-format guard before HMAC verify (rejects mutated values before the constant-time compare); email normalization (lowercase + trim) applied before HMAC so Outlook safelink rewrites survive the round trip; `AUDIT_FROM_EMAIL` env precedence fixed so a missing value falls through cleanly; `signupLink` only minted when `status === 'done'` (no premature dashboard hand-off); email param dropped from the post-confirm redirect URL; auto-provision failures now log structured errors instead of silently swallowing. **Before/after fix-preview (2026-05-27)** — new `src/lib/audit/fixPreview/` orchestrator runs on the public-audit pipeline (gated `AUDIT_FIX_PREVIEW_ENABLED=1`) and produces a real before+after screenshot pair per top finding: Tier 1 = audit-mode AI advisor (`auditFixAdvisor.ts`, vision-enabled `gemini-3.5-flash`, 16 KB element-insert cap, no selector allowlist) → `applyModifications(snapshotHtml, mods)` → Browserless renders both before + after at 1280×900 in one connection; Tier 2 = Gemini 2.5 Flash Image inpaint (`visionInpaint.ts`, edits the real before screenshot — brand consistency preserved by construction); Tier 3 = legacy annotated-before fallback. All safety guards from `aiAdvisor.ts` reused (`sanitizeInsertHtml`, `isSafeCssDeclarations`, `isSafeReplacementText`, `isSafeAttributeName`). Migration `0023` adds `screenshot_before_url`, `screenshot_after_url`, `fix_preview_tier`, `fix_modifications`, `fix_preview_generated_at` on `forge_findings`; URLs also inlined on `public_audits.findings` JSON so `/audit/[id]` and the report email both render the swipe slider without an extra round trip. New `BeforeAfterSlider.tsx` client component drives the comparison (drag pointer + arrow keys). Email template gains `fixPreviewRow` rendering side-by-side images for tier 1/2 and a "sign up to see the fix" single-image fallback for tier 3. 19 unit tests cover prompt building, response validation, and orchestrator tier-fallback. **Step 1 shipped 2026-05-27 (branch `claude/audit-fix-preview-handover-N2TVH`)** — orchestrator reordered so `renderBeforeOnly` runs first and feeds its base64 PNG to the Tier 1 advisor; `renderBeforeAfter` + `renderBeforeOnly` ported from `setContent` to `page.route()` + `page.goto(originUrl)` interception so the rendered screenshot is a real styled page (not unstyled raw HTML); `buildAuditFixPrompt` tightened with screenshot-grounded GROUND TRUTH language + explicit hash-class warning; `availableSelectors` hint list removed. Live-verified with real Gemini API call: with screenshot the advisor picked `a:not(header a)` (resolves); without screenshot it invented `a.learn-more` (class doesn't exist — classic Tier 1 miss). **Step 2 shipped + hardened 2026-05-27 (branch `claude/audit-fix-preview-handover-N2TVH`)** — `isVisiblyChanged(before, after)` (exported from `renderBeforeAfter.ts`, `pixelmatch` v7 + `pngjs` v7) runs after `screenshotPair` and returns `null` when the after PNG is perceptually indistinguishable from the before. Threshold raised to `PIXEL_DIFF_THRESHOLD = 1 000` px (≈ 0.09 % of frame) after live-verification revealed a "ghost case" on Vercel: host CSS overrides a css-inject with no `!important`, leaving 172 px of render jitter that passed the original 100 px threshold but is invisible to humans. Real visible changes produce ≥ 8 000 px. Advisor prompt hardened: `element-insert` mods must give the inserted element a unique `id` and pair it with companion `css-inject` mods for all visual styling (because `sanitizeInsertHtml` strips inline `style` attrs); all `css-inject` declarations must use `!important`. Live-verified Stripe + IANA: Stripe hero-hierarchy-inversion now produces a fully-styled branded card (8 962 px diff). 26 fix-preview tests pass (12 advisor + 9 orchestrator + 5 renderer), 1107 full suite. Next: Step 3 (apply migration `0023` to Neon + flip `AUDIT_FIX_PREVIEW_ENABLED=1` in Vercel). **Screenshot quality gate (2026-05-28, branch `feat/QA`)** — new `screenshotQualityGate.ts` sends the rendered "before" PNG to `gemini-3.5-flash` (structured JSON, `thinkingBudget:0`) and returns `{render, issue}`; the orchestrator runs it right after `renderBeforeOnly` and bails with `reason:'screenshot-unusable'` (no advisor/inpaint spend, finding card renders with no screenshot row) when the capture is login-gated / blank / mid-load / broken-layout — the cases `isLikelyBlankFrame`'s white-ratio heuristic can't catch. Fail-soft (no key / API error → `render:true`); operator kill switch `AUDIT_SCREENSHOT_GATE_DISABLED=1`. 7 gate unit tests + 1 orchestrator skip-path test (50 fix-preview tests total). |

## Immediate build order

> **Status (2026-05-23):** Full sprint audit + live verification — see
> `docs/sprints/REMEDIATION.md` for the definitive per-ticket list. **23/39
> tickets done (Zybit-156 operator dashboard shipped 2026-05-23), 3 partial,
> 5 in open PRs (2 in PR #58, 3 in PR #66), 3 deferred per PRD (Zybit-145/146/149),
> 4 not built, 2 superseded.**
> - **Sprint 0:** 6/7 done. Zybit-114 (Stripe) **verified live end-to-end**;
>   Zybit-118 (snapshot cadence) partial.
> - **Sprint 1:** 7/8 done. Zybit-124 partial; Zybit-127/128 (demo seed +
>   synthetic outcomes) shipped — `scripts/seed-demo.ts` runs the real
>   `/audit` pipeline against commitmint.app and `posthogOverlay.ts`
>   lays a 14-day `source='posthog'` stream + bucketed assignments over
>   the grounded layer; `/demo` mints a session for the synthetic PM and
>   drops into the real cockpit.
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

**Never build:** sentiment analysis, GitHub PR generation, own event collection SDK / PostHog replacement, cross-site priors before 50+ customers. **Rules:** behavioral (event-based) rules are frozen at 12. New rules must be grounded in snapshot data (structural / SEO / accessibility / capture-time AI critique) and deterministic — **no LLM calls inside rule logic** (rule body is a pure function). LLM calls at *capture time* are allowed (Layer F pattern: `captureVisualSignals`, `captureCopyCritique`) — they must use structured-output mode + a strict validator + fail-soft return, and their output must be cached on the snapshot so rules see deterministic input.

**The snapshot audit is the front door, not the differentiated product.** Layer D snapshot-only paths, Layer E (structural / WCAG / SEO), and Layer F (AI copy critique) together power the public `/audit` lead magnet and the *Understand* step. They run on HTML, have no evidence anyone is hurt, and apply general-web convention. The differentiated product is the behavioral + outcome-labeled loop (Pain rules + Layer D behavioral paths + Learn). Findings on visibly polished sites (Stripe, Vercel, GitHub) in snapshot-only mode will look thin — that is the medium, not a bug. See `DOCTRINE.md` §"The snapshot audit is the front door, not the product" and `docs/ARCHITECTURE.md` §"Ground truth per rule family" for the strategic framing + the WCAG / SEO / heuristic citations per rule.

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

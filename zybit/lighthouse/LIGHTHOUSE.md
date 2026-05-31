# Lighthouse — Internal Pipeline Observation & Audit Tool

> **Status (2026-05-21):** Week 1 data-generation rail shipped + an unplanned **Phase 2 synthetic-experiments rail** (creates a running experiment per scenario, computes its outcome, surfaces DEPLOYED → RESULT → LEARNED in the PM view). PR #56 added preview-iframe support for `lighthouse_site_*` and parse-time CSS selectors so control + variant actually diverge. **Next priority is not Week 3 — it's scenario realism.** See §7 for the reordered roadmap, §13 for the driver gaps that block credible findings.
> Audience: Gabe + Asad. Internal only, password-gated at `/lighthouse`.

---

## 1. What Lighthouse is

Lighthouse is an internal tool for **verifying and understanding the Zybit loop** before real customer data exists.

It does three things:

1. **Audits the pipeline.** Exercises every step of the six-step loop (Understand → Watch → Identify → Propose → Test → Measure → Learn) with synthetic data and asserts the outputs match expectations.
2. **Visualises the pipeline in action.** Shows what each step produces — snapshots, canonical events, findings, prescriptions, bucket assignments, outcomes, learn adjustments — in a way a human can read.
3. **Lets us experience the PM-facing surface.** Seeds a scenario into the real `/app` so we can open the dashboard, finding detail, experiment cockpit, and loop view as if we were the PM for a fake site.

The first two are engineer-facing. The third is the dogfood — it answers the question "what does a PM actually see, given this input?"

---

## 2. Why we need it

Two gaps we cannot close any other way right now:

### Verification gap
- 392 unit tests pass. The product is built. We do not know whether the loop produces sensible outputs end-to-end because we have no real PM data flowing through it.
- Phase 5 (Test/Measure) and Phase 6 (Learn — Layer 1) shipped recently. Their correctness has not been observed on integrated, realistic input.
- We need a way to detect regressions across the whole loop, not just per-module unit tests.

### Comprehension gap
- We do not have a clear picture of what the real PM dashboard looks like with realistic data. Tests pass on paper; the lived experience is unknown.
- We need to be able to open `/app` for a synthetic site and click through it as if we were the PM.

Lighthouse closes both gaps without requiring real customers.

---

## 3. Decisions made (and why)

| Decision | Choice | Reason |
|---|---|---|
| Repo placement | **Standalone Node http server** at `zybit/lighthouse/` (own port, 3001 by default). Imports Zybit's pipeline functions directly via the workspace; does not modify `src/`. | Originally planned as in-repo Next.js routes at `src/app/lighthouse/*` + `src/lib/lighthouse/*`; switched to a separate process so Lighthouse can run independently of the main app and so engine code sits in one place (`lighthouse/lib/*`) instead of straddling Next.js conventions. |
| Access control | **Password gate** behind `/lighthouse/*`; HMAC-signed cookie, password reuses `ADMIN_PASSWORD` from Zybit's `.env`. | Two users, no need for full auth |
| Loop driver | **Direct function calls** — Lighthouse imports `runPhase2InsightsPipeline`, `runSnapshot`, `upsertFindings`, `computeOutcomes`, etc. directly. | Simplest; we already share a DB; HTTP boundary would be ceremony |
| Data isolation | Single Postgres DB with a `lighthouse_*` site/org marker; no separate sandbox DB pre-customer | No real data to pollute; deferred until we have customers |
| GUI vs CLI | **GUI only** — single-page dashboard at `/lighthouse`. CLI (`lighthouse seed <name>`) was in the original Week 1 plan but never built; generation runs via `POST /lighthouse/api/generate`. | Two-dev tool; one entry point is enough. Revisit CLI if assertions land and we want CI integration. |
| Standalone repo? | **No** | Shared types + DB outweigh the cosmetic clean-boundary win. Can extract later if needed |

---

## 4. Core architecture

### 4.1 The Scenario

A Scenario describes one synthetic site: the manifest of its pages + the persona mix that should drive traffic. The runner (`lighthouse/lib/runner/runScenario.ts`) provisions the org/site/config from this manifest at generation time and emits events live — scenarios do **not** carry pre-baked events or expected-finding ground truth today.

**Shipped shape** (`lighthouse/lib/types.ts`):

```typescript
interface Scenario {
  id: string;                          // 'acmebank' | 'wovenbasics'
  name: string;                        // human-readable
  siteManifest: SiteManifest;          // slug, bucket, baseUrl, primaryFunnelPaths,
                                       // primaryCtaSelector, expectedConversionEvent,
                                       // businessProfile.{mrr,aov}, biasNotes
  personaMix: { personaId: string; weight: number }[];
  defaultSessions: number;
}
```

The runner derives everything else: it creates the `lighthouse_org_<slug>` / `lighthouse_site_<slug>` / `lighthouse_user_<slug>` rows on first run, weights persona draws by `personaMix`, drives sessions across `primaryFunnelPaths`, snapshots every visited path, runs the Phase 2 insights pipeline, then (since the Phase 2 rail shipped) generates a synthetic experiment for the top finding and computes its outcome.

**Originally planned but never built** (deferred until §7 priorities #3 + #4 land):

- `pages: { url, html }[]` — raw HTML attached to the manifest. Today the HTML lives as static files under `lighthouse/fake-sites/<slug>/*.html` and is served by the Lighthouse http server; the snapshot fetcher reads it over HTTP like a real site. Folding raw HTML into the manifest is unnecessary while sites are served locally.
- `events: CanonicalEvent[]` — pre-baked event stream. The session driver generates events live + deterministically, so a snapshot of events isn't needed for reproducibility.
- `prebaked: { snapshots, findings, experiments, outcomes }` — entry-at-any-step short-circuits. Useful for Learn-in-isolation testing; would land alongside the assertion engine.
- `expected: { findings.mustFire / mustNotFire, outcomes, learnAdjustments }` — ground truth for assertions. **Blocks priority #3 in §7.** Adding this field is the first concrete deliverable when the assertion engine starts.

### 4.2 Viewing surfaces

The shipped GUI is a single-page dashboard at `/lighthouse` (`lighthouse/web/app.js`, ~316 lines) with three panes:

**Left (control + progress)** — scenario dropdown, sessions input, mode toggle (`direct` | `posthog`), Generate button, and a live progress log streamed from the runner (`provisioning → sessions → snapshots → insights → experiments → done`, plus warnings like `gate: trustworthy=true`).

**Right (result)** — when a run finishes, this pane shows counts (sessions/events/snapshots/findings), the synthetic-experiment summary (action / result / lift / participants), and sample rows from each phase output. The PM-view handoff button appears here.

**PM-view iframe** — clicking **open as PM** calls `POST /lighthouse/api/impersonate/start`, which mints a real `zb_session` cookie for the synthetic `app_users` row (`lighthouse_user_<slug>`). The button swaps in-place for an iframe of `http://localhost:3000/app/loop` (override via `ZYBIT_APP_BASE_URL`). Inside that iframe an amber banner identifies the session as synthetic.

**Developer log panel** (`logCapture.ts`, 2026-05-31) — a streaming, per-run log pane below the run pane. `installLogCapture()` taps `console` once at startup and `AsyncLocalStorage` (`runLogStore`) binds the active run id through the whole async chain, so every line the pipeline emits — including LLM calls routed through `src/lib/observability/logger.ts` — is attributed to the run. Lines are classified (`ai` / `snapshot` / `db` / `pipeline` / `http` / `other`) with category filter checkboxes; `ai` lines surface model + token + latency inline. The poller fetches incrementally via `?sinceLog=<n>`. Capture is additive — terminal output is unchanged.

**Database browser** (`server/routes/data.ts`, 2026-05-31) — a read-only window onto every row, opened from the panel at the bottom of the dashboard. `GET /lighthouse/api/data/meta` + `GET /lighthouse/api/data/rows` are Drizzle `select`s over a hardcoded table allowlist (no raw SQL, no writes). Opening the panel auto-loads **all** tables (first 50 rows + total + per-table pagination + row-JSON expand) across **all orgs** (real + synthetic); the org/site selectors narrow every table together. Same exposure level as `/admin/ops`.

**Owned-site full-LLM-depth presets** (2026-05-31) — a control row with `commitmint.app` + `cohor7.com` buttons that fire a URL audit with the whole LLM surface on (Layer B + deriveFacts + `visionPagesLimit:3` + `fixPreview` + `variantAdvisor`), capped to 6 pages. Results render in the inspector as before/after fix-preview image cards + per-finding variant-advisor option JSON. This is the one-click path to QA the LLM PR against a site we own.

**Prod-access hardening** (2026-05-31) — the server binds **loopback-only** (`127.0.0.1`) and **refuses to start** under `VERCEL` / `NODE_ENV=production` (override `LIGHTHOUSE_ALLOW_PROD=1`). It was never part of the Vercel deploy (only the Next.js app builds); this is defense-in-depth now that the DB browser surfaces customer PII behind the admin-password gate.

**Not yet shipped** (queued in §7 priority #3 / #5):

- Per-scenario route (`/lighthouse/scenarios/[id]`) with a vertical step-by-step timeline showing each phase's input/output/assertion-pass-fail. The current GUI shows the latest run's summary, not the loop as a stepwise timeline.
- Side-by-side internals + PM-view layout. Today it's stacked: progress + result on top, PM iframe below when opened.

### 4.3 Per-loop-step coverage

Status as of 2026-05-21. Last column ("Assertions that matter") is what an assertion engine *would* check — none of these are enforced today (no `expected` field, no assertion engine; see §7 priority #3).

| Loop step | Inject | Trigger | Inspect | Status | Assertions to enforce (future) |
|---|---|---|---|---|---|
| **Understand** | Static HTML at `lighthouse/fake-sites/<slug>/*.html`, served by Lighthouse on `:3001` | `runSnapshot(fullUrl)` per visited path | `phase2_page_snapshots` rows; sample shown in result pane | ✅ Exercised | Headings/CTAs/forms detected; visual weight scoring; fold guess; SPA fallback fires when shell detected; `cssSystem` populated |
| **Watch** | Canonical events via `DirectEventSink` (default) or `PostHogEventSink` (`--mode posthog`) | Direct insert into `phase1_events` or PostHog capture API + the existing pull-sync cron | `phase1_events` rows | ✅ Exercised | Dedup on `(siteId, source, sourceEventId)`; cursor advances; canonical schema matches |
| **Identify** | Site + snapshots + events | `runPhase2InsightsPipeline()`, persisted via `upsertFindings` | `zybit_findings` rows + in-memory `auditReport` shown in result | ✅ Exercised | Specific findings fire (true positive); trap findings do NOT fire (true negative); evidence array well-formed |
| **Propose** | Finding row | Prescriptions are computed inside `runPhase2InsightsPipeline` and attached to each finding | Rendered in the PM-view `/app/findings/[id]` page | ✅ Exercised (via PM view) | Prescription coherent with evidence; impact estimate in plausible range given MRR/AOV |
| **Test** | Top finding (selected by `generateSyntheticExperiment`) | Synthesizes a `running` `forge_experiments` row + assignment events for control + variant arms | `forge_experiments` row, control/variant iframes via preview route (now Lighthouse-aware, PR #56) | ⚠️ Exercised at the data layer only. Real bucketing + edge proxy not invoked — Lighthouse doesn't drive traffic through `/proxy/*`. | Bucketing deterministic; modifications applied; fail-open on errors; kill switch on `status != 'running'` |
| **Measure** | Assignment + conversion events emitted by the synthetic experiment generator (variant arm lifted) | `computeOutcomes(experimentId)` | `zybit_experiment_outcomes` row + summary in result pane | ✅ Exercised | Chi-squared correct; OBF threshold tightens early / loosens late; auto-stop at right moment; guardrail breach triggers PM email |
| **Learn** | Prior outcomes for the site | `applyLearnRerank` runs inside the next `runPhase2InsightsPipeline` invocation; `learn_adjustment` jsonb persisted on findings | LEARNED entry in `/app/loop` timeline | ✅ Exercised (transitively — needs a second Generate run for the same site to see Learn re-ranking) | Cascade tier matches correctly; D-with-guardrails formula produces expected delta; visibility threshold `\|delta\| ≥ 0.05` gates UI |

---

## 5. PostHog seeding strategy

Zybit ingests PostHog via a **pull-sync cron** (`/api/phase2/cron/sync-posthog`), not via the reverse proxy. The reverse proxy is for experiment variant delivery only.

Lighthouse seeds events two ways:

- **`--mode direct`** (default): writes synthetic events directly into `phase1_events` with `source = 'posthog'`, matching the canonical schema. Fast, deterministic. Skips PostHog entirely.
- **`--mode posthog`** (optional): pushes events to a real "Lighthouse" PostHog project via the [capture API](https://posthog.com/docs/api/capture); the real cron then pulls them. Tests the integration end-to-end. Slower, eventual consistency.

Default to `direct` for everyday verification. Use `posthog` for integration testing of the connector itself.

### Event generation discipline

Random events are useless. To produce realistic streams, generate personas first (10 synthetic users per scenario, each with traits: power user, casual, churning, evaluator) and have each persona "emit" events according to behavioural patterns:

- Diurnal cycles (events cluster in business hours)
- Sessions (5–30 events in 10-min bursts, then quiet)
- Cohort skew (5% power users generating 100× the events of casuals)
- Funnel realism (viewed_pricing → clicked_signup → completed_signup with realistic drop-offs)
- Decay curves (new features spike then decay; churning users decay over weeks)

For the shipped session-driver implementation, see `lighthouse/lib/generators/sessionDriver.ts` + `lighthouse/lib/personas/index.ts`. The earlier plan in [`phase1.md`](./phase1.md) (Playwright against real OSS sites) was deferred in favor of synthetic fake-sites + a direct event sink — see §7.2 "Optional parallel track" for when the OSS-sites approach might revive.

---

## 6. Scenario generation strategy

Pre-customer, "good seed data" means data designed to **expose the failure modes we fear**: rule false positives, rule false negatives, outcome computation bugs, learn re-ranker miscalibration, proxy modification breakage, bucketing drift.

Four sources, ranked by realism-per-effort:

1. **Hand-written** (5–10 scenarios) — diverse industries, stages, feedback volumes, PM experience levels. Painful but irreplaceable. This is the calibration set.
2. **Scraped public artifacts** (via Firecrawl) — public roadmaps (Linear, Cal.com, tldraw), changelogs, ProductHunt, Reddit r/ProductManagement. Mind ToS for anything beyond personal-tool use.
3. **LLM-generated, grounded on the handcrafted set** — "given this scenario, generate 10 noisier variants." Bias-aware: the model writes overly articulate "PM input" by default.
4. **Real anonymised scraps from PM friends** — DM 3 PM friends, ask for 20 messages each. Highest realism, no engineering required, do it in parallel.

Adversarial layer: 5–10% of signals in each scenario are **traps** — feedback that looks like it should produce a finding but shouldn't (off-topic, sarcasm, competitor complaints). If the pipeline extracts findings from these, false-positive failure is caught.

Note: Zybit's audit rules are deterministic pure functions (12 rules, hundreds of tests). "Hallucination" in the LLM sense is not the failure mode. The failure modes are rule miscalibration, statistical bugs in measurement, and re-ranker miscalibration. Synthetic data should exercise those.

---

## 7. Roadmap

### 7.1 What shipped

Scope of "Week 1" in the original plan, plus an unplanned Phase 2 rail that closes the Identify → Test → Measure → Learn loop end-to-end:

- ✅ Scenario format (manifest + persona-mix), DB seeder, GUI generation (CLI was descoped — see §3).
- ✅ Two handcrafted scenarios: **AcmeBank** (engineered friction, bounce-on-key-page positive) and **WovenBasics** (realistic well-built DTC funnel, calibration / false-positive counterpart).
- ✅ Direct-mode session driver — deterministic RNG, 5 personas, log-normal distributions, dedupe on `(siteId, source, sourceEventId)`.
- ✅ `/app` impersonation handoff — `POST /lighthouse/api/impersonate/start` mints a real `zb_session` and the GUI embeds `/app/loop` in an iframe with a synthetic-PM banner.
- ✅ **Phase 2 synthetic experiments + outcomes** — `generateSyntheticExperiment` creates a `running` experiment for the top finding, emits assignment + conversion events with the variant arm lifted, runs `computeOutcomes`, so `/app/loop` shows DEPLOYED → RESULT → LEARNED on a single Generate.
- ✅ Preview iframe + parse-time CSS selectors (PR #56) — control + variant render real divergent HTML on Lighthouse synthetic sites.
- ✅ **Developer log panel + DB browser + full-LLM-depth URL audit (2026-05-31)** — per-run `console` capture streamed to a category-filtered log pane (`logCapture.ts`); a read-only DB browser over all orgs (`server/routes/data.ts`); owned-site presets that run vision + copy-critique + Layer B + fix-preview + variant advisor in one click. Server hardened to loopback-only + refuse-in-prod. See §4.2.

### 7.1a QA findings — LLM PR vs real owned sites (2026-05-31)

First end-to-end QA of the LLM PR against **commitmint.app** + **cohor7.com** via the full-depth presets. Capture-time LLM (vision, copy-critique), Layer B prose, and the fix-preview screenshot quality gate all worked. Four findings worth carrying forward (none are Lighthouse-harness bugs — the harness surfaced them):

1. **AI Variant Advisor is dead on the URL-audit path.** The URL-audit snapshot parser emits `cssSelector: null` for every CTA/form/heading (elements get a `ref`/`data-zybit-ref` but no CSS selector), so the advisor's selector allowlist is empty → 0 options on both sites. The in-app dashboard route works because its snapshots populate selectors. Fix: populate `cssSelector` on the URL-audit parse path, or give the advisor a `ref`-based fallback.
2. **fix-preview render came back blank on cohor7** (commitmint rendered fine). The new screenshot quality gate (`gpt-5.4-mini`) correctly caught it (`issue: "blank"`) and suppressed before spending advisor/inpaint budget — the gate works. But the fix-preview render path (`renderBeforeOnly`) produced a blank frame where the vision pass's own screenshot succeeded; the two render paths disagree on this SPA.
3. **Behavioral rules fire on synthetic events in URL-audit mode.** `hero-hierarchy-inversion` reported "83 button clicks, 42.2% → Connect PostHog" — those are Lighthouse's engineered grounded events, not real traffic (it even picked a different CTA than vision's real primary). Inherent to URL-audit's `in-app` mode; `public-audit` mode would suppress/rewrite. Don't read behavioral stats from a real-site URL audit as ground truth.
4. **Design-capture screenshot upload always fails** with `Vercel Blob: Cannot use private access on a public store` — `captureScreenshot()` requests `access: 'private'` but the env's Blob store is public. Fires every run regardless of site; non-fatal (brand-DNA falls back to page meta), but design-snapshot screenshots are never persisted.

### 7.2 Reordered roadmap

The original Week 2–6 plan still describes the right *destinations*, but the prerequisite for any of it is **scenarios that model funnel reality**. Running an assertion engine on top of random-walk traffic just measures the rule engine's behavior on noise. Reordered:

| # | Deliverable | Why this order |
|---|---|---|
| **1** | **Accurate scenarios.** Fix §13 #1 (transition matrix — per-scenario `transitionWeights` table, ~40 lines in `sessionDriver.ts`); then §13 #3 (per-path CTA registry so `cta_click` events stop tagging `signup-cta` on `/checkout`); then §13 #2 (continuous per-step exit hazard, replaces binary bounce). Re-author AcmeBank + WovenBasics to use the new fields so their event streams trace a directed funnel instead of a random walk. | Findings credibility depends on this. Everything below assumes scenarios actually model the funnels the rules are written for. |
| **2** | **Per-scenario internals view at `/lighthouse/scenarios/[id]`.** Vertical step-by-step timeline of one run — input, trigger, output per phase, with drill-into-JSON. No assertions yet. | We have the data (runner emits per-phase progress + result samples); the GUI just doesn't render it as a timeline. Inspection before assertions. |
| **3** | **Assertion engine + ground truth.** Add the `expected: { findings.mustFire, findings.mustNotFire, outcomes, learnAdjustments }` field to the Scenario type (§4.1). Build a comparator and surface pass/fail badges in the §7.2-#2 timeline. Add per-scenario trap cases. | Once scenarios are credible (#1) and you can see what each phase emitted (#2), assertions tell you *whether* what you saw was right. |
| **4** | **Scenario authoring tools.** Firecrawl URL ingest (snapshot a real public site into a Scenario manifest skeleton), LLM-grounded scenario generation seeded on the handcrafted set, scenario forking. | Scales the scenario library beyond handcrafted seeds. Only worth doing after #1 — bulk-generated scenarios on a credible driver are useful; on a random-walk driver they multiply the noise. |
| **5** | **Cross-scenario regression dashboard.** Rows = scenarios, columns = loop steps, cells = pass/fail / drift since last run. | Catches drift after pipeline changes. Requires #3 to mean anything. |
| **6** | **Polish.** Edge cases, hand-off-able docs, deploy-ready impersonation handoff (signed token instead of localhost-cookie shortcut). | Internal product ≠ no polish — Asad uses it too. |

**Optional parallel track — real OSS sites (was `phase1.md`).** Driving Playwright against real public sites (cal.com, Medusa storefront, etc.) would solve §13 #1–#5 by construction (real DOM determines transitions and CTAs). It's a bigger build than the transition-matrix fix and isn't required to unblock #2–#6 above. Keep it as a Phase 2 fidelity upgrade once the synthetic-site rail has carried Lighthouse through assertions + regression.

### 7.3 Out-of-roadmap, opportunistic

- Lighthouse-aware DNS-gate bypass for the proxy/Test step. Today the synthetic experiment's `forge_experiments` row is enough for the PM view to render DEPLOYED → RESULT, but no real bucketing runs because the proxy code path is DNS-gated. Two paths in §10 Q2: synthesizing `proxy_live=true` for `lighthouse_site_*` (~1 day) or cloudflared tunnel (highest-fidelity, deferred).

---

## 8. Architectural prerequisites

These items must be true (or made true) for Lighthouse to be clean:

1. **Each loop step is a pure-ish function with explicit inputs and outputs.** Most already are: `runInsightsPipeline`, `computeOutcomes`, `applyLearnRerank`, `runSnapshotFetcher`. Audit each and patch any that read implicit global state.
2. **Phase outputs are serializable.** They mostly already are (DB rows). Verify any in-memory intermediate that Lighthouse needs to capture is JSON-encodable.
3. **The dev DB schema lives in drizzle migrations** that Lighthouse can replay deterministically. Already true.
4. **Optional trace table** (`phase_runs` or similar) capturing per-phase metadata (timing, input/output hashes, any LLM prompts/responses if applicable). Async write, off the critical path. Adds one DB insert per phase — sub-ms cost, irrelevant against LLM/HTTP latency. Defer until v1 ships unless we see real need.

Net runtime cost on prod after these changes: **zero to negligible.** The architectural cost (pure functions, explicit IO) is one we should pay anyway — it improves testability, retries, caching independent of Lighthouse.

---

## 9. Things explicitly NOT in scope for v1

- A "simulated PM agent" that clicks through the dashboard automatically (interesting, much bigger build).
- Real-time streaming of pipeline execution (token-by-token LLM output etc.) — unnecessary for our pipeline, which is deterministic and DB-driven.
- Multi-tenant Lighthouse access (design partners using it themselves).
- Lighthouse as an external SDK or product surface.
- Mutating production data of any kind. Lighthouse only touches `lighthouse_*`-prefixed orgs/sites.

---

## 10. Open questions

1. **Should Lighthouse get its own DB schema namespace?** (`lighthouse_*` site/org marker is sufficient pre-customer. Revisit when we have real customers.)
2. **Do we need a synthetic customer origin for proxy testing?** As of 2026-05-20, three known paths for exercising the Test step against AcmeBank-style synthetic origins. The DNS-gated experiment surface (`/app/experiments/[id]`) + the variant-preview iframe (`src/app/api/preview/[experimentId]/route.ts`) both assume `https://<public-domain>/<path>` — they don't fit `localhost:3001/fake-sites/<slug>/<path>` out of the box. Options, ordered by cost:
   - **(small) Preview-only patch.** ✅ **Shipped 2026-05-21** (commit 88b8786). The preview route now detects `lighthouse_site_<slug>` and rewrites to `http://${domain}/fake-sites/<slug>${path}`, and extends `frame-ancestors` to allow the Lighthouse origin so the iframe is not blocked when itself embedded inside Lighthouse on `:3001`. Control + variant iframes render real synthetic HTML; the DNS gate stays untouched; production sites unaffected.
   - **(medium) Lighthouse v2 — local proxy mode.** Skip the DNS gate for lighthouse sites by synthesizing a `proxy_live = true` row in `phase2_integrations` at provision time, and teach the proxy handler to use `http://localhost:3001/fake-sites/<slug>` as the origin when the experiment belongs to a `lighthouse_site_*`. Route customer-facing traffic through `http://localhost:3000/proxy/<slug>/<path>` instead of via DNS. Exercises real bucketing + variant code locally, with no tunnel and no public exposure. ~1 day.
   - **(heavy, end-to-end) cloudflared tunnel.** The wrapper already exists at `lighthouse/lib/tunnel/cloudflared.ts` and the manifest has a `requiresTunnel` field. Tunnel exposes `localhost:3001` as a real public URL; you point a test domain you own at Zybit's proxy via real CNAME; the **production** proxy code path runs unchanged. Requires `cloudflared` installed, a test domain, and DNS edits. Highest-fidelity verification; deferred until we want to exercise the deployed proxy stack from Lighthouse.

   No decision needed today — the PM-view embed (Identify + Propose) works without any of these. Pick when the Test step becomes a verification priority.
3. **What's the storage format for scenarios?** Committed TS/JSON fixtures vs DB rows vs both. Default to **TS files** in `zybit/src/lib/lighthouse/scenarios/*.ts` so they're code-reviewed, versioned, and re-runnable. Generated/imported scenarios get persisted to DB.
4. **Adversarial trap library.** We need a catalog of failure modes to test. Start with: trap signals for each of the 12 audit rules; OBF early-stopping false-positive scenarios; cascade-tier-collision scenarios for the learn re-ranker.
5. **CI integration.** Should Lighthouse's assertion suite run in `npm run verify`? Probably yes once scenarios stabilize — it's the only end-to-end signal we have.

---

## 11. Related docs

- [`phase1.md`](./phase1.md) — concrete week-1 build: Playwright-driven personas on real OSS sites
- `zybit/AGENTS.md` — current build state and immediate build order
- `zybit/docs/ARCHITECTURE.md` — what's built across the loop
- `zybit/docs/BACKLOG.md` — prioritized stories
- `product_gap.md` — gap analysis and build plan
- `zybit/DOCTRINE.md` — product vision and build philosophy

---

## 12. Decision log

- **2026-05-20** — Decided in-repo placement, password gate, direct function calls (vs HTTP API), CLI for seeding + GUI for inspection. Initial scope = all six loop steps + PM impersonation view. Sized at six weeks.
- **2026-05-20** — Moved doc from `zybit/docs/LIGHTHOUSE.md` to `zybit/lighthouse/LIGHTHOUSE.md`; created `phase1.md` for the Playwright-driven persona generator. Removed reference to PostHog "Mockingbird" (does not exist).
- **2026-05-20** — PM view shipped as an iframe of `/app/loop` inside the Lighthouse results pane, not a separate tab. Handoff: `POST /lighthouse/api/impersonate/start` mints a normal `zb_session` via `createSession()` for a synthetic `app_users` row (`lighthouse_user_<slug>`, RFC2606 `.invalid` email). The browser sends the cookie on `:3000` requests because cookies on `localhost` ignore port. Side effect: clicking "open as PM" overwrites any real `zb_session` on `localhost` — acceptable for a two-dev internal tool. Production deploy is deferred and would require a signed-handoff endpoint on the Zybit side.
- **2026-05-20** — Findings persist to `forge_findings` via the cron's existing `upsertFindings` helper (one-word `export` change in `src/lib/phase2/jobs/insightsTrigger.ts`). Each `Generate` first clears prior `phase1_events`, `phase2_page_snapshots`, `forge_findings`, `forge_experiments`, and `zybit_experiment_outcomes` for the target `lighthouse_site_<slug>` so re-runs are reproducible and the PM-view timeline doesn't accumulate stale DEPLOYED/MEASURED entries from earlier sessions.
- **2026-05-20** — All Lighthouse HTTP routes namespaced under `/lighthouse/api/*` so they can't be confused with the Next app's `/api/*` (which lives on a different port anyway, but the visual cue matters for grep + log review). Static UI continues to serve at `/lighthouse/*`.
- **2026-05-20** — Synthetic site uses `/checking-accounts` as its primary funnel path with a believable banking marketing page; the audit finding now reads like a real PM artefact rather than referencing bare `/`.
- **2026-05-21** — Preview-route fix for Lighthouse synthetic sites shipped (commit 88b8786, PR #56). The preview route now rewrites the origin to `http://${domain}/fake-sites/<slug>${path}` and extends `frame-ancestors` to allow the Lighthouse origin. Closes the "(small) Preview-only patch" option in §10 Open question #2.
- **2026-05-21** — Snapshot parser now emits a `cssSelector` per CtaCandidate/FormCandidate at parse time (stability ladder: testid → human-authored id → tag[name] → role+aria-label → bail). Synthetic experiment generator (`syntheticExperiment.ts`) picks its target selector from the snapshot instead of the hardcoded `[data-zybit-ref="primary-cta"]`. Result: Lighthouse-generated variants now mutate real elements on the fake-site HTML; preview iframes show actual control/variant divergence. Closes the long-standing "variant and control render identical HTML" bug. Commit f4958a8, PR #56.
- **2026-05-21** — Added **WovenBasics** as the second registered scenario (PR #56): a realistic well-built DTC funnel (home → PDP → cart → checkout). Counterpart to AcmeBank's engineered friction — findings that fire on WovenBasics are calibration / false-positive signal, not real flaws. Persona mix is e-commerce skew (heavy casual, modest evaluator, smaller power-user, light churn + bot). Surfaced the driver-realism gaps documented in §13: with the SaaS-flavored `preferredPaths` in `personas/index.ts`, the five personas degenerate to near-identical behavior on a DTC URL space.

---

## 13. Session driver realism — known gaps

The shipped direct-mode session driver (`lighthouse/lib/generators/sessionDriver.ts`) is good enough to populate `phase1_events` and exercise the audit rules end-to-end, but it has five real behavioral limitations that distort what Zybit sees. Ranked by impact on findings credibility:

### 1. No funnel direction (load-bearing)

`pickPath()` (sessionDriver.ts:124, 192) does an **independent** weighted-random draw on every page transition. There is no notion that after `/product` the next step should usually be `/cart`, not back to `/`. Sessions look like `[/, /checkout, /, /product]` — a directed walk through the funnel is unrepresentable, so **funnel drop-off** — the central concept in DTC and SaaS conversion — cannot be modeled.

**Cheapest credible fix (~40 lines):** transition matrix. Add a per-scenario `transitionWeights: Record<string, Array<{path: string; weight: number}>>` and have `pickPath` look up transitions from the current path instead of sampling globally. Persona `preferredPaths` would weight transition options rather than overriding them.

This is the single change that would make findings on multi-path scenarios meaningful. Fix this before Phase 3 assertion work, otherwise the assertion engine measures rule behavior on random walks.

### 2. Bounce is binary

`samplePagesCount()` (sessionDriver.ts:98): `if (rng.next() < persona.bounceProbability) return 1;` — otherwise a log-normal length is drawn and the session visits that many pages. Real sessions have a **continuous exit hazard** on each page ("user looked at /, looked at /product, left after 3 because they couldn't find what they wanted"). Here it is all-or-nothing: 1 page, or the full sampled pagesCount. The mid-funnel exit pattern is unrepresentable.

**Fix sketch:** replace the up-front length draw with a per-step exit roll using a persona+path-dependent hazard rate. Pairs naturally with the transition matrix in #1.

### 3. CTA clicks are path-agnostic and use a single `ctaId`

sessionDriver.ts:158–174. `clickIntent` is a flat persona-level probability that fires regardless of which page the user is on, and every `cta_click` event is tagged with the same `primaryCta.ctaId` — so the rule engine sees `signup-cta` clicks happening on `/cart` and `/checkout`, which is nonsense. Same problem for `form_submit` on `/`. This pollutes any rule that joins clicks/submits to specific pages.

**Fix sketch:** per-path CTA registry on the scenario manifest (`ctasPerPath: Record<string, Array<{ctaId, selector, intentMultiplier}>>`) and a click step that picks from the current page's registry. `formSubmitIntent` similarly gated on whether the current page actually has a form.

### 4. Personas' `preferredPaths` are SaaS-flavored constants

`personas/index.ts` — `power-user` prefers `/event-types`, `/bookings`, `/team`. None of those exist on a DTC site. The `2×` weighting in `pickPath` becomes a no-op on WovenBasics, and personas degenerate to "same path distribution, different click rates and dwell." For WovenBasics specifically, the five personas are almost behaviorally identical.

**Don't fix this first.** Fixing personas without fixing #1 just gives a slightly better-flavored random walk. The right shape is: scenario declares a path taxonomy, personas declare *roles* (browser/comparer/converter/...), and the transition matrix per scenario maps role × current-page → next-page distribution.

### 5. Dwell and scroll are per-page persona constants

Real users dwell longer on `/product` than on `/`. The driver can't express that — `sampleDwell()` and `sampleScroll()` only see the persona, not the path. Minor compared to 1–3 but worth flagging because dwell-based rules (hesitation, return-visit-thrash) will look uniform across the funnel.

**Fix sketch:** per-path multipliers on the scenario manifest, applied inside `sampleDwell` / `sampleScroll`.

### Recommended order

1. **#1 transition matrix** — unblocks everything else; ~40 lines + a per-scenario field.
2. **#3 per-path CTA registry** — required to stop polluting rule input with cross-path clicks.
3. **#2 continuous exit hazard** — naturally falls out of #1's per-step model.
4. **#5 per-path dwell multipliers** — small, lands with #3.
5. **#4 persona roles + transition-matrix-aware preferredPaths** — last; meaningful only after the others.

Phase 1 (`phase1.md`) sketches a Playwright-driven driver against real OSS sites; #1–#5 are inherently solved there because the real DOM determines transitions and CTAs. Until that lands, the direct-mode driver is the only path and these fixes are how we close the credibility gap incrementally.

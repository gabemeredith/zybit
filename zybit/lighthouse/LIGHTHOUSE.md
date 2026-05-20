# Lighthouse — Internal Pipeline Observation & Audit Tool

> Status: planning. Branch `feat/lighthouse`. No code yet.
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
| Repo placement | **In-repo** at `zybit/src/app/lighthouse/*` (routes) and `zybit/src/lib/lighthouse/*` (engine) | Pre-customer schemas are unstable; shared types + DB; no isolation requirement because no prod data exists |
| Access control | **Password gate** behind a `/lighthouse` route prefix; reuses Next.js middleware | Two users, no need for full auth |
| Loop driver | **Direct function calls** — Lighthouse imports `runInsightsPipeline`, `computeOutcomes`, `applyLearnRerank`, etc. | Simplest; we already share a process; HTTP boundary would be ceremony |
| Data isolation | Single Postgres DB with a `lighthouse_*` site/org marker; no separate sandbox DB pre-customer | No real data to pollute; deferred until we have customers |
| GUI vs CLI | **Both** — CLI for seeding, GUI for inspection + PM view | Comprehension requires a browser; verification benefits from CLI for CI |
| Standalone repo? | **No** | Shared types + DB outweigh the cosmetic clean-boundary win. Can extract later if needed |

---

## 4. Core architecture

### 4.1 The Scenario

A Scenario is a self-contained, JSON-serializable bundle that populates the full loop's input state for one synthetic site. It contains both **raw upstream data** and **optional pre-baked downstream artifacts**, which lets us enter the loop at any step.

```typescript
interface Scenario {
  id: string;
  name: string;                       // "AcmeBank Q3 post-launch"

  // Setup — created first
  organization: { id, name, plan };
  site:         { id, url, meta: { mrr, aov, sessionCount } };
  integrations: Integration[];        // PostHog/Segment/GA4 records (no real creds)
  siteConfig:   Phase2SiteConfig;     // cohort/CTA/narrative

  // Upstream data (Understand + Watch inputs)
  pages:        { url, html }[];      // raw HTML for snapshot fetcher
  events:       CanonicalEvent[];     // raw canonical events for phase1_events

  // OPTIONAL pre-baked downstream data — skip earlier steps
  prebaked?: {
    snapshots?: PageSnapshot[];       // skip Understand
    findings?:  Finding[];            // skip Identify
    experiments?: Experiment[];       // skip Propose
    outcomes?:  Outcome[];            // skip Measure (test Learn in isolation)
  };

  // Ground truth — what Lighthouse asserts on
  expected: {
    snapshots?: PartialMatch<PageSnapshot>[];
    findings:  {
      mustFire:    Partial<Finding>[];            // true positives
      mustNotFire: { ruleId, pathRef, reason }[]; // trap cases for false-positive detection
    };
    outcomes?: { experimentId, result, liftPctRange, confidence }[];
    learnAdjustments?: { findingId, deltaRange }[];
  };
}
```

### 4.2 Two viewing surfaces

The GUI splits into two halves that serve different audiences:

**Internals view** — engineer-facing. Vertical loop timeline showing each step's input, trigger, output, assertion pass/fail. Drill into raw JSON. Diff actual vs expected.

**PM view** — what-the-user-sees. Lighthouse impersonates the scenario's PM so you can open `/app/loop`, `/app/findings`, `/app/findings/[id]`, `/app/experiments/[id]`, and cockpit as if you were that customer. Almost free to build — it's the existing `/app` with a session-cookie + organizationId swap.

```
┌─────────────────────────────────────────────────────────────┐
│ /lighthouse/scenarios/acmebank                              │
├──────────────────────────────┬──────────────────────────────┤
│ INTERNALS                    │ PM VIEW                      │
│                              │                              │
│ U → 23 snapshots             │ ┌─────────────────────────┐ │
│ W → 4,812 events             │ │ /app/loop (as PM)       │ │
│ I → 7 findings  ▸ 2 traps    │ │                         │ │
│ P → prescriptions ready      │ │ [embed real /app pages] │ │
│ T → 3 experiments running    │ │                         │ │
│ M → 1 outcome (positive)     │ │                         │ │
│ L → 4 adjustments (+0.18 max)│ │                         │ │
└──────────────────────────────┴──────────────────────────────┘
```

### 4.3 Per-loop-step coverage

| Loop step | Inject | Trigger | Inspect | Assertions that matter |
|---|---|---|---|---|
| **Understand** | Synthetic HTML for N pages | `runSnapshotFetcher(siteId)` | `phase2_page_snapshots` rows | Headings/CTAs/forms detected; visual weight scoring; fold guess; SPA fallback fires when shell detected |
| **Watch** | Canonical events (direct DB) or live PostHog/Segment/GA4 push | Direct insert or cron | `phase1_events` rows | Dedup on `(siteId, source, sourceEventId)`; cursor advances; canonical schema matches |
| **Identify** | Site + snapshots + events | `runInsightsPipeline()` | `zybit_findings` rows | Specific findings fire (true positive); trap findings do NOT fire (true negative); evidence array well-formed |
| **Propose** | Finding row | Read prescription + impact estimate | Prescription text, modification, revenue impact | Prescription coherent with evidence; impact estimate in plausible range given MRR/AOV |
| **Test** | Experiment config + synthetic traffic | Headless requests through proxy | Bucket assignments, modified HTML | Bucketing deterministic; modifications applied; fail-open on errors; kill switch on `status != 'running'` |
| **Measure** | Assignment events + conversion events | `/api/phase2/cron/compute-outcomes` | `zybit_experiment_outcomes` rows | Chi-squared correct; OBF threshold tightens early / loosens late; auto-stop at right moment; guardrail breach triggers PM email |
| **Learn** | Site with prior outcomes | `applyLearnRerank(findings, outcomes)` | `learn_adjustment` jsonb on findings | Cascade tier matches correctly; D-with-guardrails formula produces expected delta; visibility threshold `|delta| ≥ 0.05` gates UI |

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

For the concrete week-1 build of the persona generator, see [`phase1.md`](./phase1.md).

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

Six weeks of focused work. Comprehension surfaces first; verification surfaces second.

| Week | Deliverable | Why this order |
|---|---|---|
| 1 | Scenario format + DB seeder + `lighthouse seed <name>` CLI. Three handcrafted scenarios. | Without scenarios, nothing else works. |
| 1 | `/app` impersonation at `/lighthouse/view/[siteId]` — opens the real PM dashboard as if you were that site's PM. | Highest-leverage week-1 deliverable. Comprehension before verification. |
| 2 | Lighthouse internals panels at `/lighthouse/scenarios/[id]` — vertical step-by-step viewer, no assertions yet. | Inspection before assertions. See it before measuring it. |
| 3 | Assertion engine + ground-truth editor + pass/fail badges. | Now you can detect regressions. |
| 4 | Scenario authoring tools — Firecrawl URL ingest, LLM-grounded scenario generation, scenario forking. | Scales scenario library beyond handcrafted seeds. |
| 5 | Cross-scenario regression dashboard — rows = scenarios, columns = loop steps, cells = pass/fail. | Catches drift after pipeline changes. |
| 6 | Polish, edge cases, hand-off-able docs. | Internal product ≠ no polish — Asad uses it too. |

### Week 1 in detail

By end of week 1 we can:
1. Run `lighthouse seed acmebank` from the terminal.
2. Open `http://localhost:3000/lighthouse/view/<acmebank-site-id>` in a browser.
3. See the real `/app/loop`, finding detail, experiment cockpit — populated with the scenario's data.

This alone is enormous. Everything after is acceleration.

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
   - **(small) Preview-only patch.** Detect `siteId LIKE 'lighthouse_site_%'` in the preview route and build `http://localhost:3001/fake-sites/<slug><path>` instead. The control/variant iframes render real synthetic HTML; the DNS gate stays untouched and no real A/B traffic is served. ~30 min.
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

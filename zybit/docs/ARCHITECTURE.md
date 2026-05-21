# Zybit — Technical Architecture

How the system works, what each component does, what needs to be built, and how it scales. This is the engineering companion to [DOCTRINE.md](../DOCTRINE.md).

---

## System Overview

Zybit is a single Next.js application deployed on Vercel. All domain logic runs server-side in API routes and library modules. The frontend is a PM-facing dashboard. There is no separate backend service.

```
┌─────────────────────────────────────────────────────────┐
│                     Zybit (Next.js)                      │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Dashboard │  │ API      │  │ Cron     │  │ Auth   │  │
│  │ (React)  │  │ Routes   │  │ Jobs     │  │(Magic) │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┘  │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴──────────────┐    │
│  │              Domain Logic (src/lib)              │    │
│  │                                                  │    │
│  │  ┌───────────┐  ┌────────────┐  ┌────────────┐  │    │
│  │  │ Snapshots │  │ Connectors │  │ Audit      │  │    │
│  │  │ (Understand)│ │ (Watch)    │  │ Rules      │  │    │
│  │  │           │  │            │  │ (Identify) │  │    │
│  │  └───────────┘  └────────────┘  └────────────┘  │    │
│  │                                                  │    │
│  │  ┌───────────┐  ┌────────────┐  ┌────────────┐  │    │
│  │  │ Variant   │  │ Experiment │  │ Outcome    │  │    │
│  │  │ Engine    │  │ Deployer   │  │ Tracker    │  │    │
│  │  │ (Propose) │  │ (Test)     │  │ (Measure)  │  │    │
│  │  │   BUILT   │  │  PARTIAL   │  │   BUILT    │  │    │
│  │  └───────────┘  └────────────┘  └────────────┘  │    │
│  └──────────────────────────────────────────────────┘    │
│                          │                               │
│                    ┌─────┴─────┐                         │
│                    │ Postgres  │                         │
│                    │ (Neon)    │                         │
│                    └───────────┘                         │
└─────────────────────────────────────────────────────────┘
         │                    │                  │
    ┌────┴────┐         ┌────┴────┐        ┌────┴────┐
    │ PostHog │         │ Segment │        │Customer │
    │ API     │         │ Webhook │        │  Site   │
    └─────────┘         └─────────┘        └─────────┘
```

---

## What Exists (built, tested, working)

### Understand — Page Audit (`src/lib/phase2/snapshots/`)

Static HTML analysis. Fetches pages via HTTP, parses DOM structure.

| Component | File | What it does |
|-----------|------|--------------|
| Fetcher | `fetcher.ts` | HTTP GET with redirect following, robots.txt respect, 5s timeout, 1.5MB limit |
| Parser | `parser.ts` | Extracts headings, CTAs (buttons + links), forms, meta tags, landmarks |
| Visual weight | `visualWeight.ts` | Scores element prominence from Tailwind class tokens (text-2xl, bg-primary, font-bold) |
| Fold guess | `foldGuess.ts` | Estimates above/below fold from DOM position + landmark proximity |
| Refresh cron | `refresh.ts` + `cron/refresh-snapshots/route.ts` | Daily 03:00 UTC re-fetch of the latest snapshot per pathRef; compares `contentHash` for HTML drift; cockpit surfaces `snapshots.staleDays` (amber > 7d). Distinct from `refresh-captures` (Playwright artifacts). (Zybit-023) |

**Limitation:** SPA pages return blank HTTP responses. `fetcher.ts` checks `isSpaHtml()` and falls back to `runBrowserSnapshot()` via Browserless.io when a shell is detected (`snapshotMethod: 'browser'`). HTTP-only fallback when `BROWSERLESS_TOKEN` is absent. Visual weight is heuristic (class token matching), not measured pixel positions.

### Watch — Data Collection (`src/lib/phase2/connectors/`)

Event ingestion from customer analytics tools.

| Connector | Method | Status |
|-----------|--------|--------|
| PostHog | API pull (paginated, cursor-tracked, retry/backoff) | Working |
| Segment | Webhook receiver | Working |
| GA4 | API pull (Google Analytics Data API v1beta) | Built — service-account JWT + `runReport` pagination + cron. Aggregate-grain (Identify/Propose only, not joinable to assignments) |
| Direct JS SDK | — | Not built |

Events are normalized to a canonical schema (`CanonicalEvent v2`) with deduplication on `(siteId, source, sourceEventId)`.

### Identify — Audit Rules (`src/lib/phase2/rules/`)

12 deterministic rules. Pure functions. Same input → same output.

**Design rules (5):** hero-hierarchy-inversion, above-fold-coverage, rage-click-target, mobile-engagement-asymmetry, nav-dispersion

**Pain rules (7):** form-abandonment, help-seeking-spike, hesitation-pattern, bounce-on-key-page, error-exposure, return-visit-thrash, cohort-pain-asymmetry

Each finding includes: severity, confidence, priority score, structured evidence array, text prescription (what to change, why, variant description), and revenue impact estimate.

### Dashboard (`src/app/dashboard/`)

PM-facing product surface. Connected to real APIs and real data.

| Page | What it does |
|------|--------------|
| Cockpit | Top 3 findings, integration health, active experiments, data readiness |
| Findings list | Ranked backlog with status filters (open/approved/dismissed/shipped/measured) |
| Finding detail | Evidence table, prescription, preview slot, approve/dismiss/measure buttons |
| Experiments list | All experiments with confidence bars and lift percentages |
| Experiment detail | Hypothesis, control vs variant rates, confidence meter, result entry |
| Connect | Guided setup wizard (site URL → PostHog → Segment → GitHub) |

### Storage

Single Postgres database (Neon serverless) via Drizzle ORM.

| Table | Purpose |
|-------|---------|
| `phase1_sites` | Site registrations |
| `phase1_events` | Canonical events (Phase 1 + 2 unified) |
| `phase2_site_configs` | Per-site cohort/onboarding/CTA/narrative config |
| `phase2_integrations` | Connector records (PostHog/Segment, status, cursor) |
| `phase2_page_snapshots` | Page DNA snapshots |
| `zybit_findings` | Persisted audit findings with lifecycle |
| `zybit_experiments` | Experiment metadata and results |
| `zybit_site_meta` | Site operational metadata (MRR, AOV, session counts) |
| `zybit_api_keys` | M2M API keys (hashed) |

### Test — Variant Delivery (`src/lib/experiments/`)

Invite-only magic-link auth (email → 15-min token → 30-day session cookie). M2M API keys for programmatic access. Tenant scoping on `(organizationId, siteId)`. No Clerk.

---

## What Needs to Be Built

### Step 5: Test — Experiment Deployment

This is the hardest engineering problem in the product. Zybit needs to modify a customer's live website without owning their infrastructure. Three viable approaches, ordered by feasibility:

#### Option A: Proxy-based variant injection (recommended first)

Zybit acts as a reverse proxy for the customer's site. Traffic routes through Zybit, which injects variant modifications on the fly.

```
User → Zybit Edge (Vercel Middleware) → Customer Origin
                    │
                    ├─ Control: pass through unmodified
                    └─ Variant: inject CSS/JS/HTML modifications
```

**How it works:**
1. Customer points a subdomain (e.g., `test.acme.com`) at Zybit via CNAME, or adds Zybit as a Vercel middleware layer
2. Zybit middleware reads the experiment config, assigns the visitor to control or variant (cookie-based bucketing)
3. For variant visitors: rewrites the response HTML to apply the change (CSS injection, element text replacement, element visibility toggle)
4. Zybit logs the assignment event back to the canonical event stream

**Variant definition format:**
```typescript
interface VariantModification {
  type: 'css-inject' | 'text-replace' | 'element-hide' | 'element-reorder' | 'attribute-set';
  selector: string;        // CSS selector targeting the element
  value: string;           // New text, CSS rules, or attribute value
}

interface ExperimentConfig {
  id: string;
  siteId: string;
  status: 'draft' | 'running' | 'completed' | 'stopped';
  trafficSplit: number;    // 0..1 — fraction assigned to variant
  modifications: VariantModification[];
  primaryMetric: string;   // Event type to measure
  durationDays: number;
  startedAt: string;
}
```

**Why this approach:**
- Works without customer code changes (just DNS)
- Supports the most common CRO modifications (button text, CTA position, form field visibility, color changes)
- Vercel Middleware runs at the edge — low latency
- Zybit already runs on Vercel, so middleware is native

**Limitations:**
- Can't modify server-side logic (pricing, API responses)
- DOM manipulation via selector is fragile if customer changes their markup
- Customer must trust Zybit as a proxy

**Implementation scope:**
- `src/lib/experiments/variantEngine.ts` — Applies modifications to HTML response
- `src/lib/experiments/bucketing.ts` — Cookie-based visitor assignment (deterministic hash)
- `middleware.ts` update — Route proxied traffic through variant engine
- Experiment config API — CRUD for `ExperimentConfig` with `modifications[]`
- Dashboard UI — Visual modification builder (select element → choose action → preview)

#### Option B: Script tag injection (lighter, less capable)

Customer adds a `<script src="https://zybit.app/sdk.js?site=xxx">` tag. The SDK reads active experiments from Zybit API and applies DOM modifications client-side.

**Pros:** No DNS changes. Customer just adds one tag.
**Cons:** Flash of original content before modification. Blocked by CSP on some sites. Client-side only.

#### Option C: Feature flag integration (delegate deployment)

Zybit creates feature flags in the customer's existing tool (PostHog Feature Flags, LaunchDarkly) via API. Customer's own code reads the flag and renders the variant.

**Pros:** Customer keeps full control. No proxy.
**Cons:** Requires customer to write variant code. Not "one-click." Breaks the PM-first promise.

**Recommendation:** Start with Option A (proxy) for maximum PM value. Fall back to Option C for customers who won't proxy.

---

---

## Priority Build Items (ordered)

The analysis engine is production-ready. The proxy bucketing and HTML modification exist. What follows is what separates Zybit from a finding backlog into a real measurement system. Build these four things. Nothing else until they exist.

---

### Priority 1: Measurement Rigor — Compute Outcomes

**What:** Automatically compute conversion rates per bucket, run statistical significance, auto-stop, auto-rollback on guardrail breach.

**Why it's first:** Without this, experiment results are manually entered numbers. Zybit is a calculator, not a measurement system. Everything downstream — renewal story, rule calibration, dataset moat — depends on measurement being correct.

**Why best-in-class matters:** If lift numbers are wrong, everything is poisoned: the calibration data, the renewal story, the dataset. "Adequate" measurement is not acceptable here.

> **Status:** OBF alpha-spending shipped on `claude/fix-measurement-proxy-reliability`. `stats.ts` has `obfConfidenceThreshold(elapsedDays, durationDays, alpha)` computing per-look thresholds; `isReadyToStop` uses day-number information fraction (t = lookNumber / totalLooks). Simulation: 2,000 null experiments, empirical FP-rate ≤ 6.5% (3-sigma MC tolerance). Cron cadence: daily (`vercel.json`). PostHog visitor-ID bridge shipped — the proxy injects a `zybit_vid` PostHog super-property (`proxy/bridgeScript.ts`, both buckets) and `posthog/mapping.ts` prefers it in `deriveSessionId`, so the conversion join matches PostHog-sourced events with no SQL change. Auto-stop/guardrail PM email shipped (`email/experimentConcludedEmail.ts`, `notifyConcluded` in `computeOutcomes.ts`, best-effort). Remaining: "last computed at" surface.

#### Outcome Storage

New table `zybit_experiment_outcomes`:
```sql
CREATE TABLE zybit_experiment_outcomes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES zybit_experiments(id),
  finding_id TEXT REFERENCES zybit_findings(id),
  rule_id TEXT NOT NULL,
  path_ref TEXT,
  modification_type TEXT NOT NULL,          -- 'css-inject' | 'text-replace' | etc.
  result TEXT NOT NULL,                     -- 'positive' | 'negative' | 'inconclusive'
  lift_pct REAL,                            -- measured lift (negative = variant lost)
  confidence REAL,                          -- final statistical confidence
  control_conversions INTEGER,
  control_participants INTEGER,
  variant_conversions INTEGER,
  variant_participants INTEGER,
  guardrail_breached BOOLEAN DEFAULT FALSE,
  concluded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

Populate when an experiment moves to `completed` or `stopped`.

#### Conversion Rate Computation

Join `experiment_assignment` canonical events to conversion events:
- Match: `(visitorId, occurredAt > assignedAt, occurredAt <= assignedAt + durationDays)`
- Count: unique visitors who converted per bucket / unique visitors assigned per bucket
- Handle: `primaryMetric` event type as the conversion signal
- Handle: attribution window strictly — conversions outside the window do not count
- Handle: multiple conversions per visitor count as one (unique converter, not total events)

For binary (converted/not) primary metrics: **chi-squared test for two proportions** — not a z-test with pooled variance, which is incorrect for this case.

For continuous metrics (revenue per session): **Welch's t-test** (unequal variance).

#### Sequential Testing — No Early Stopping on Noise

Do NOT call significance the moment p < 0.05 is first reached. This is the most common A/B testing mistake and produces false positives.

Enforce both conditions before significance is declared:
1. `confidence >= 0.95` (chi-squared p-value threshold)
2. `participants >= minimumSampleSize` computed from: base conversion rate, minimum detectable effect (default 5%), power 80%, alpha 5%
3. `elapsedDays >= 7` (minimum one full business cycle)

Optional (preferred): implement **always-valid p-values** (mSPRT) to allow continuous monitoring without inflating false positive rate. Simpler alternative: **O'Brien-Fleming alpha spending** boundary — significance threshold tightens early and relaxes as the experiment matures.

#### Auto-Stop

When both conditions are met: transition experiment to `completed`, write outcome row, notify PM.

When `durationDays` is reached regardless of significance: transition to `completed` as `inconclusive`.

#### Guardrail Metrics

PM-defined guardrail: e.g., "do not ship if session error rate increases by >10%". 

Implementation:
- `guardrails` column already exists on `zybit_experiments` (JSONB)
- On each compute-outcomes run: evaluate each guardrail metric in the same way as primary metric
- If guardrail is breached with >80% confidence in the wrong direction:
  1. Transition experiment to `stopped`
  2. Write outcome row with `guardrail_breached = true`
  3. Notify PM with specific which guardrail tripped and by how much
  4. The proxy stops applying the variant on next config reload

**Cron:** `POST /api/phase2/cron/compute-outcomes` — hourly, processes all `running` experiments.

**Timeline:** 4 focused days. Nothing else ships until this is done.

---

### Priority 2: Preview Before Deploy

> **Status:** Server endpoint shipped in `5951a99` + `b09a212`. CSP `frame-ancestors 'self'` set on response (`route.ts:131`). Side-by-side control/variant iframes added to experiment detail page (`experiments/[id]/page.tsx`). SPA-rendered content note shown under iframe.

**What:** PM sees the modified page in an iframe before activating on real traffic.

**Why:** Removes the single biggest trust blocker in every demo. A PM who cannot see the change before it goes live will not approve it.

**Implementation:**
`GET /api/preview/[experimentId]` — fetch origin HTML, apply `VariantModification[]` as `<style>` injections and DOM mutations, return modified HTML for iframe embed. No external dependency.

Dashboard: side-by-side iframe toggle (control | variant) on experiment detail page.

---

### Priority 3: The Visible Loop View

**What:** A dedicated timeline view showing the full cycle for a site: detection → experiment deployed → result → what was learned → what changed in next recommendations.

**Why:** This is the renewal story. It answers the "why pay again?" question in 10 seconds. It is also the demo that beats "ChatGPT can do this" in a single screen.

**What it shows (in timeline order):**
1. `[date]` Zybit detected: **[finding title]** on `[page]` — evidence summary in one line
2. `[date]` Experiment deployed: **[hypothesis]** — what changed, traffic split
3. `[date]` Result: variant `X%` vs control `Y%` — `+N pp` (`Z%` relative), `p=[confidence]`
4. `[date]` (if suppressed) Already tested — prior outcome was `[result]`, raising the signal threshold
5. Next: Suggested based on outcomes: **[next finding]**

**This view is not buried in finding detail.** It is a top-level page (e.g., `/app/loop` or `/app/activity`). It is the first thing shown in a demo.

**What powers it:** Completed experiment rows + outcome rows + finding lifecycle transitions. All data already (or soon to be) available. It is a view, not new data.

---

### Priority 4: Proxy Reliability + SPA Support

**Must be in place before any paid pilot routes real production traffic.**

> **Status:** All items shipped on `claude/fix-measurement-proxy-reliability`. `handler.ts` — `fetchOrigin` with 10s `AbortSignal.timeout`; modification errors caught → serve unmodified HTML; `experiment.status === 'running'` kill switch check; `looksLikeSpaShell()` warning log. `browserFetcher.ts` — `runBrowserSnapshot` via playwright-core CDP over Browserless.io. `fetcher.ts` — SPA shell → Browserless fallback with `snapshotMethod` field. `config.ts` — `status` field on `ProxyExperiment`. `route.ts` — `status` selected from DB. Vercel Domains API auto-provisioning (`vercelDomains.ts`) — `addCustomerDomain(customerSubdomain)` called after DNS verify passes, falls back to manual email if env vars absent.

#### Fail-Open Behavior

If the Zybit proxy is unavailable or throws an error, the user's request must be served from the customer's origin unchanged. Under no circumstances should a proxy failure produce a 5xx to the end user.

```typescript
// src/lib/experiments/proxy/handler.ts
try {
  const modified = await applyModifications(originResponse, modifications);
  return modified;
} catch (err) {
  logger.error('proxy modification failed, serving origin', { experimentId, err });
  return originResponse; // fail open: serve control unmodified
}
```

Proxy config fetch must also fail open: if Edge Config is unavailable, pass through as control.

#### Kill Switch Per Experiment

PM can stop an experiment instantly without DNS changes. When `status` transitions to `stopped`, the next Edge Config update removes the experiment from the active manifest. The proxy reads from Edge Config on every request (cached at edge, TTL 30s). No per-experiment deploy required.

Require: a prominent "Stop experiment" button on the experiment detail page that does not require confirmation dialogs — speed matters when something is wrong.

#### SPA Support (Browserless.io)

The audit engine (snapshot fetcher) and the proxy both have SPA gaps.

**Snapshot fetcher (`src/lib/phase2/snapshots/fetcher.ts`):**
- Detect SPA: if raw HTML `<body>` has <500 characters or contains `<div id="root"></div>` / `<div id="app"></div>` with no content → SPA detected
- Re-fetch via Browserless.io: `wss://chrome.browserless.io?token=BROWSERLESS_TOKEN`
- `page.goto(url, { waitUntil: 'networkidle', timeout: 10_000 })`
- If Browserless unavailable: return HTTP result with `snapshotMethod: 'http-only'` in the snapshot record, surface a warning in the cockpit

**Proxy (client-side routing):**
- SPA route changes are client-side (History API pushState) — the proxy only sees the initial page load
- For experiments targeting a path that SPA-routes to (not a full-page load), the variant must be applied via the injected initial HTML — CSS injection and the initial DOM state are sufficient for most modifications
- Record which experiments target SPA-only paths; validate that modifications are HTML-injectable at parse time, not dependent on post-hydration DOM

**Add to Vercel env:** `BROWSERLESS_TOKEN` — gate all Browserless calls behind its presence.

#### Auto-Rollback on Guardrail Regression

See Priority 1 (Guardrail Metrics). The proxy side: when `experiment.status = 'stopped'` is set by guardrail breach, the next Edge Config sync removes the experiment from the active manifest automatically. No manual intervention required.

---

### Step 6: Learn — Outcome Feedback Loop

**Layer 1 (per-site re-ranking) shipped.** When an experiment completes, its outcome adjusts the `priorityScore` of future findings on the same site via a cascade match + D-with-guardrails formula. Rules stay pure; the reranker is a separate pass.

**Architecture:**
- `src/lib/phase2/outcomes/repository.ts` — read-only `createOutcomesRepository().listForSite(siteId)` over `zybit_experiment_outcomes`.
- `src/lib/phase2/rules/learnReranker.ts` — pure fn `applyLearnRerank(findings, outcomes)`. Cascade: Tier 1 `(ruleId, pathRef, modType)` → Tier 2 `(ruleId, pathRef)` → Tier 3 `(ruleId, modType)` → Tier 4 `(ruleId)`. Strongest non-empty tier wins. Per-outcome contribution = `clamp(liftPct, ±20) × confidence × tierStrength × 0.01`; guardrail breach stacks `−0.10 × tierStrength`. Total delta clamped to ±0.30.
- Inconclusives use no special case — low confidence × small lift naturally drives contribution toward zero.
- `LearnAdjustment` metadata persisted on `forge_findings.learn_adjustment` (drizzle/0013); written by `src/lib/phase2/jobs/insightsTrigger.ts:upsertFindings`. Visibility threshold `|delta| ≥ 0.05` gates the UI surfaces.
- UI surfaces: backlog pill (`src/app/app/findings/page.tsx`), "Past tests on your site" panel on finding detail (`src/app/app/findings/[id]/page.tsx`), LEARNED timeline entry on `/app/loop` (`src/app/app/loop/page.tsx`).
- 16 unit tests in `src/lib/phase2/rules/__tests__/learnReranker.test.ts`.

**Not yet built (Layer 2 and 3):**
- **Layer 2** — per-site mutation of rule thresholds (effectively per-site `ruleTuning.ts`-equivalent). Today only `priorityScore` is adjusted; the rules themselves remain functionally identical across sites.
- **Layer 3** — cross-site priors. Deferred until 50+ customers have outcome rows. The global prior means nothing at smaller sample sizes. Do not build this early.

---

### GA4 Connector (shipped)

Built at `src/lib/phase2/connectors/ga4/`, same shape as the PostHog pull-sync adapter.
- GA4 Data API v1beta `runReport`; service-account RS256 JWT signed via Web Crypto (zero extra deps), exchanged for an OAuth2 access token (in-memory cached per service account).
- `eventName` → canonical `type`; `eventCount` + `sessions` → canonical `metrics`. Each aggregated `(date, hour, minute, pagePath, eventName)` row → one canonical event; the deterministic grain key is the `(siteId, source, sourceEventId)` dedupe id, so re-syncs are idempotent.
- Cursor: `(synthetic timestamp, grain key)` in `phase2_integrations.cursor`; `runReport` `startDate` derived from it, with strictly-after filtering.
- `runGA4PullSyncJob` + `/api/phase2/cron/sync-ga4` (every 30m). The session-volume insights trigger is the shared `jobs/insightsTrigger.ts`, also used by the PostHog cron.

**Caveat (deliberate):** `runReport` is aggregated — GA4 exposes no per-visitor/session id without a BigQuery export. GA4 is therefore an **Identify/Propose** source only; it is NOT joined to proxy assignments for outcome computation (PostHog/Segment are the measurement-grade sources). A future BigQuery-export path could lift this.

**Do not build:** Amplitude or Mixpanel connectors yet. Add them one at a time, same pattern.

---

## Data Flow (end-to-end with all steps built)

```
Customer Site ──→ PostHog/Segment ──→ Zybit Connectors ──→ Canonical Events
                                                              │
Customer Site ──→ Zybit Snapshot Fetcher ──→ Page DNA          │
                                              │                │
                                              ▼                ▼
                                     ┌─────────────────────────────┐
                                     │    Audit Rule Pipeline       │
                                     │                             │
                                     │  Events + Snapshots         │
                                     │  + Site Config              │
                                     │  + Past Outcomes (Learn)    │
                                     │         │                   │
                                     │         ▼                   │
                                     │  12 Rules → Findings        │
                                     │  + Prescriptions            │
                                     │  + Impact Estimates         │
                                     └──────────┬──────────────────┘
                                                │
                                                ▼
                                     ┌──────────────────┐
                                     │  PM Dashboard     │
                                     │                  │
                                     │  Review finding  │
                                     │  Approve variant │
                                     │  Preview change  │
                                     └────────┬─────────┘
                                              │
                                              ▼
                                     ┌──────────────────┐
                                     │ Experiment Engine │
                                     │                  │
                                     │ Deploy variant   │
                                     │ Split traffic    │
                                     │ Measure lift     │
                                     └────────┬─────────┘
                                              │
                                              ▼
                                     ┌──────────────────┐
                                     │ Outcome Store     │
                                     │                  │
                                     │ Feed back to     │
                                     │ rule pipeline    │──→ (back to top)
                                     └──────────────────┘
```

---

## Scaling Considerations

### Event volume

Current: events held in memory for rule evaluation. ~50MB at 100k events.

| Volume | Approach |
|--------|----------|
| <100k events/site | Current in-memory approach works |
| 100k-500k | Pre-group sessions once on context (not per-rule). Enforce max-events limit on API. |
| 500k+ | Pre-aggregate into daily rollups. Rules consume rollups, not raw events. The rollup layer already exists (`src/lib/phase2/rollups/`). |

### Concurrent sites

Each site's audit runs independently. No shared state between sites. Parallelizable via Vercel Functions (each `/insights/run` call is a separate function invocation).

### Experiment traffic

Proxy-based variant injection runs in Vercel Middleware (edge). Stateless — reads experiment config from edge cache (Vercel Edge Config or KV), applies modifications, returns. No per-request database hit for experiment assignment.

### Database

Neon serverless scales reads automatically. Write-heavy paths (event ingestion) use batch inserts with `ON CONFLICT DO NOTHING` for deduplication. Indexes are already in place on all query paths.

---

## Build Sequence

Four things. In this order. Everything else is a distraction until these exist.

| Priority | What | Why first | Time |
|----------|------|-----------|------|
| 1 | Compute-outcomes: outcome storage + chi-squared + sequential testing + guardrails | Converts Zybit from a calculator into a measurement system. Everything downstream depends on measurement being correct. | 4 days |
| 2 | Preview before deploy | Removes trust blocker on every demo. Different surface — can build in parallel with #1. | 2 days |
| 3 | Visible loop view | The renewal story and the demo. Needs #1 to populate it. | 3 days |
| 4 | SPA support + proxy reliability (fail-open, kill switch, auto-rollback) | Non-negotiable before any paid pilot routes real traffic. One outage = dead pilot. | 4 days |

**After the four priorities:**
- GA4 connector (analytics-agnostic claim becomes real)
- Per-site outcome feedback into rule pipeline (learning loop)
- Amplitude / Mixpanel connectors (one at a time, same pattern as PostHog)
- Warehouse-native ingestion path (BigQuery, Snowflake)
- Cross-site global priors (not before 50+ customers with outcomes)

**Never build:**
Sentiment analysis, GitHub PR generation, own event collection SDK / PostHog replacement, elaborate new audit rules, cross-site priors before sample size justifies it.

---

## Current Codebase Health

After cleanup (this session):

- **16,240 lines** of domain logic across 79 source files
- **193 tests**, all passing
- **Single storage backend** (Postgres via Drizzle — blob driver removed)
- **Zero dead code** (backend shell, duplicate onboarding page, blob repository all deleted)
- **Clean type system** (TypeScript strict mode, no `any` leaks in domain code)

The foundation is solid. The architecture is modular — new rules, new connectors, new experiment types can be added without touching existing code. The immediate work is building the experiment deployment layer (Phase B above), which is the product's core differentiator.

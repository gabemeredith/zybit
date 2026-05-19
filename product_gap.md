# Zybit — Product Gap Analysis & Roadmap

> **Status (updated 2026-05-19):** Analysis engine (Understand → Watch → Identify → Propose) production-ready. Test → Measure in place: outcome computation, preview, proxy reliability, PostHog visitor-ID bridge, auto-stop PM email, and "results last refreshed" cockpit surface. **GA4 connector shipped** (aggregate-grain, Identify/Propose only). **Visible loop view shipped** (timeline + guardrail badge + multi-site selector). Gap 2 (Billing) — metering + enforcement shipped; round-trip code bugs fixed; only live stripe-cli verification remains. Gap 6 (Onboarding) — integration-health cockpit + required MRR/AOV shipped. Remaining critical-path: live Stripe verification, then the Learn rule-calibration loop. Refer to `zybit/docs/BACKLOG.md` for sequencing.

---

## State of the Product Today

| Loop Step | Status | What Works |
|-----------|--------|-----------|
| **Understand** | ✅ Built | HTTP snapshot → DOM parse → visual-weight scoring. SPA support still missing. |
| **Watch** | ✅ Built | PostHog pull-sync + Segment webhook + GA4 Data API pull-sync, canonical event schema. PostHog visitor-ID bridge. GA4 is aggregate-grain (Identify/Propose only). |
| **Identify** | ✅ Built | 12 audit rules, 193 passing tests, deterministic findings |
| **Propose** | ✅ Built | Findings ranked by priority score + revenue impact, PM-readable |
| **Test** | ⚠️ Partial | Bucketing, HTML modifier, and edge proxy routes built. Network-error fail-open in place. Modification-error fail-open, kill switch, SPA handling, and auto-rollback wiring all still TODO in `src/lib/experiments/proxy/handler.ts`. |
| **Measure** | ✅ Built | Outcome storage, conversion join (`DISTINCT ON` dedup), chi-squared + Welch, sequential guard, guardrail eval, auto-stop, cron with Cronitor heartbeat. PostHog visitor-ID bridge now shipped (`proxy/bridgeScript.ts` + `posthog/mapping.ts` prefers `zybit_vid`) — PostHog-sourced conversions are now matched. Auto-stop/guardrail PM email shipped. |
| **Learn** | ⚠️ Partial | Layer 1 (per-site re-ranking) shipped: `applyLearnRerank` in `src/lib/phase2/rules/learnReranker.ts` adjusts `priorityScore` on new findings using a cascade match + D-with-guardrails formula. Persisted as `learn_adjustment` on `forge_findings`; surfaced as backlog pill, finding-detail "Past tests" panel, and LEARNED timeline entry on `/app/loop`. Layer 2 (per-site rule-threshold calibration) and Layer 3 (cross-site priors, ≥50 customers) not built. |
| **Pay** | ⚠️ Partial | Metering at the persistence layer; plan limits enforced — sites + concurrent experiments hard (402), events soft-capped. Round-trip code bugs fixed (post-checkout redirect target; cross-instance-stale plan cache removed; webhook validates planId). Live stripe-cli verification of checkout→webhook→plan-write→enforcement still pending (needs Stripe test keys). |
| **Operate** | ⚠️ Partial | Cronitor heartbeats, error-budget tracker, and structured logger built and wired into crons. No staging environment, no E2E harness, no Axiom log drain. |

---

## Gap 1 — Variant Deployment (P0, Critical Path)

### Problem
When a PM creates an experiment in Zybit, nothing happens in production. The experiment record is stored with a hypothesis, metric name, and traffic split percentages — but no variant is ever applied to real users. There is no bucketing, no modification, no traffic assignment. "Start measuring" is currently a form with no backend effect.

This gap is the reason Zybit cannot call itself a testing platform. Without it, it is a finding backlog, not a loop.

### Decision: Proxy vs. Script Tag vs. Feature Flag Delegation

| Approach | PM Control | Engineering overhead | Fidelity | Chosen? |
|----------|-----------|---------------------|----------|---------|
| **Proxy (Vercel Middleware)** | ✅ Full | Medium — rewrite HTML at edge | ✅ Full-DOM | ✅ Yes |
| Script tag injection | ✅ Full | Low — one-line install | ⚠️ Layout shift risk | No (brittle) |
| Feature flag delegation (LaunchDarkly) | ❌ None — PM loses control | Low | ✅ Full | No (breaks promise) |
| Browser extension | ✅ Full | Low | ✅ Full-DOM | No (not scalable) |

**Use the proxy approach.** Zybit routes the customer's production traffic through a Vercel Middleware proxy. This is what gives the "one-click" promise meaning: Zybit modifies the HTML response before it reaches the user, without the customer touching their codebase.

### Architecture

```
User browser → customer-site.zybit.run (CNAME) → Vercel Middleware
                                                        │
                          ┌─────────────────────────────┤
                          │                             │
                   resolve experiment              fetch origin
                   (Edge Config or KV)             customer site
                          │                             │
                   assign visitor bucket          response HTML
                   (deterministic cookie hash)         │
                          │                             │
                   apply modifications ←─────────────────
                   (css inject, text replace,
                    element hide, reorder)
                          │
                   serve modified response
                   + set bucket cookie
                   + log assignment event → Zybit canonical stream
```

### What Needs to Be Built

#### 1a. Experiment Modifications Schema (1 day)

Add `modifications` column to `forge_experiments` table. This is the payload that defines the variant:

```typescript
type VariantModification =
  | { type: 'css-inject';     selector: string; css: string }
  | { type: 'text-replace';   selector: string; text: string }
  | { type: 'element-hide';   selector: string }
  | { type: 'element-show';   selector: string }
  | { type: 'attribute-set';  selector: string; attr: string; value: string }
  | { type: 'element-reorder'; parentSelector: string; childOrder: number[] }
```

Add DB migration and update `/api/dashboard/experiments` CRUD to accept/return `modifications[]`.

#### 1b. Visual Modification Builder UI (3 days)

The PM needs a way to define what changes in the variant — without writing CSS. Build this inside the experiment creation panel on `/dashboard/findings/[id]`:

- **Text replace:** "Change this element's copy" → selector (auto-detected from snapshot DOM) + new text field
- **CSS override:** Paste or build CSS for an element (advanced)
- **Element visibility:** Toggle show/hide on a selector
- **Preview panel:** Static diff showing original vs. variant side-by-side (render the modification as a CSS overlay on the snapshot screenshot)

No element picker (visual overlay) needed for v1 — path-based selector input from the snapshot DOM is sufficient. The modification builder is a structured form, not a WYSIWYG.

#### 1c. Visitor Bucketing (2 days)

Build `src/lib/experiments/bucketing.ts`:

```typescript
// Deterministic: same visitor, same experiment → always same bucket
function assignBucket(visitorId: string, experimentId: string): 'control' | 'variant' {
  const hash = sha256(`${visitorId}:${experimentId}`).slice(0, 8);
  const n = parseInt(hash, 16);
  return (n % 100) < controlPct ? 'control' : 'variant';
}
```

- Visitor ID sourced from `_zybit_vid` cookie (set on first visit, 1-year expiry, UUID)
- Bucket stored in `_zybit_exp_{experimentId}` cookie (ensure sticky sessions)
- If experiment is not active, pass through unchanged

#### 1d. Edge Proxy via Vercel Middleware (3 days)

The proxy lives in `src/middleware.ts`. When a request hits `*.zybit.run`:

1. Extract `siteId` from hostname
2. Load active experiment configs from Vercel Edge Config (updated when experiment status changes to `running`)
3. Resolve visitor bucket
4. Fetch origin response (customer's actual site)
5. If visitor is in variant bucket AND request path matches experiment's target URL:
   - Stream response through HTML rewriter
   - Apply `VariantModification[]` via regex/DOM mutations
6. Set bucket cookie on response
7. Log `experiment_assignment` event to Zybit canonical event stream (for outcome tracking)

**Third party to use: Vercel Edge Config** for the active experiment manifest (fast reads at edge, zero cold-start latency). Update Edge Config via API whenever an experiment is activated or deactivated.

**Do NOT use an external proxy service (Cloudflare Workers, ngrok, etc.)** — Vercel Middleware is sufficient and keeps the architecture single-deployment.

#### 1e. Custom Subdomain Provisioning (2 days)

Each customer site needs a `{slug}.zybit.run` subdomain that CNAMEs to Vercel:

- On site creation: generate slug from domain (e.g., `acme.zybit.run`)
- Store in `phase1_sites.proxySlug`
- Create DNS CNAME via Vercel Domains API (or pre-wildcard the record: `*.zybit.run → cname.vercel-dns.com`)
- Show the PM a one-time setup instruction: "Add this CNAME to your DNS"
- Validate CNAME via DNS lookup before activating experiments

The wildcard approach (`*.zybit.run → Vercel`) avoids per-customer DNS calls. Customer just adds a single CNAME. No external DNS provider SDK needed.

### Timeline: 11 production days

---

## Gap 2 — Billing & Plan Limits (P0, Paid Pilots Blocked)

### Problem
There is no payment flow, no subscription, no plan enforcement. Zybit cannot charge money. It also cannot enforce limits, meaning a free user could run unlimited experiments and ingest unlimited events.

### Architecture Decision: Use Stripe + magic-link sessions (was: Clerk Organizations)

> Clerk was removed in `a786d37`; org scoping now hangs off magic-link sessions in `src/lib/auth/` rather than Clerk Organizations. The Stripe integration described below shipped against this model.

Clerk is already integrated and handles multi-org. Stripe is the clear choice for SaaS billing — no alternatives evaluated (Paddle adds complexity without benefit at this stage). Billing is keyed to Clerk Organization, not individual user.

### Plan Structure (Proposed)

| Plan | Price | Sites | Events/mo | Experiments | Support |
|------|-------|-------|-----------|-------------|---------|
| **Starter** | $199/mo | 1 | 100K | 2 concurrent | Email |
| **Growth** | $599/mo | 3 | 500K | 10 concurrent | Slack |
| **Scale** | $1,499/mo | 10 | 2M | Unlimited | Dedicated |
| **Enterprise** | Custom | Unlimited | Unlimited | Unlimited | SLA |

### What Needs to Be Built

#### 2a. Stripe Integration (3 days)

Install `stripe` SDK. Build:
- `/api/billing/checkout` — create Stripe Checkout session for plan selection
- `/api/billing/portal` — redirect to Stripe Customer Portal for self-serve plan changes
- `/api/billing/webhook` — handle `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Store `stripeCustomerId` and `stripePlanId` on organization record in DB

#### 2b. Plan Limits Enforcement (2 days)

Add `plan` column to organizations. Enforce limits at API layer:
- Event ingestion: count events/month per org, reject with `402` if over limit
- Sites: reject `POST /api/phase1/sites` if at limit
- Experiments: reject `POST /api/dashboard/experiments` if at concurrent limit

Use a `checkPlanLimit(orgId, resource)` helper that reads plan from DB (cached 5 min via Vercel Runtime Cache).

#### 2c. Pricing Page + Upgrade UI (2 days)

- Public `/pricing` page with plan comparison table
- Upgrade prompt inline when a PM hits a limit (modal, not a redirect)
- Billing section in dashboard settings: current plan, usage bar (events this month), upgrade/downgrade button

#### 2d. Usage Metering (2 days)

Track per-org monthly usage in DB:
- Events ingested (increment on every canonical event insert)
- Snapshots taken (increment on every `upsertPageSnapshot`)
- Insights runs (increment per `runPhase2InsightsPipeline` call)

Show usage in dashboard settings. Feed into Stripe metered billing line items for overage charges on Scale/Enterprise plans.

### Timeline: 9 production days

---

## Gap 3 — Measurement Rigor: Compute Outcomes (P0, Highest Priority)

### Problem
Experiment results are entirely manually entered. Zybit's "confidence meter" is based on whatever numbers the PM types — not real data. It is a calculator, not a measurement system.

If lift numbers are wrong, everything downstream is poisoned: the rule calibration, the renewal story, the outcome-labeled dataset that is the long-term moat. This gap must be closed before anything else.

### Architecture

```
visitor assigned → log experiment_assignment{experimentId, bucket, visitorId, assignedAt}
visitor converts → canonical event has visitorId, occurredAt
                → join: assignment × conversion by (visitorId, occurredAt in attribution window)
                → count unique converters per bucket / unique assigned per bucket
                → chi-squared significance test
                → if both significance + min sample + min days met → auto-stop
                → if guardrail breached → auto-rollback + notify
```

### What Needs to Be Built

#### 3a. Outcome Storage Table (1 day)

New table `zybit_experiment_outcomes`. Full schema in `docs/ARCHITECTURE.md`. Populated when any experiment transitions to `completed` or `stopped`.

Design the schema for future learning loop use from day one: include `ruleId`, `modificationType`, `pathRef` — these are what power per-site calibration later.

#### 3b. Conversion Join and Rate Computation (1 day)

Join `experiment_assignment` canonical events to `primaryMetric` events:
- Match: `(visitorId, occurredAt > assignedAt, occurredAt <= assignedAt + durationDays)`
- Count: unique converters per bucket / unique assigned per bucket (unique visitor, not event count)
- For binary metrics (converted/not): **chi-squared test for two proportions** — not a z-test with pooled variance
- For continuous metrics (revenue per session): **Welch's t-test** (unequal variance)

#### 3c. Sequential Testing Guard (1 day)

Do NOT call significance at the first p < 0.05. This is the most common A/B testing mistake and produces false positives. Three conditions must ALL be true before significance is declared:

1. `confidence >= 0.95`
2. `participants >= minimumSampleSize` — pre-computed at experiment start from base conversion rate, MDE=5%, power=80%, alpha=5%
3. `elapsedDays >= 7` — minimum one full business cycle to wash out day-of-week noise

Implementation note: Minimum sample size formula using normal approximation:
```
n = (z_alpha + z_beta)^2 * (p1*(1-p1) + p2*(1-p2)) / (p1-p2)^2
```
Where `p1` = base rate, `p2` = base rate * (1 + MDE), `z_alpha` = 1.96, `z_beta` = 0.84.

No external stats library needed — pure math.

#### 3d. Auto-Stop and Auto-Rollback (0.5 days)

- **Significance reached:** transition to `completed`, write outcome row, Resend email to PM
- **Duration elapsed without significance:** transition to `completed` as `inconclusive`, write outcome row
- **Guardrail breached** (>80% confidence in wrong direction on any guardrail metric): transition to `stopped`, write outcome row with `guardrailBreached = true`, notify PM with specific guardrail name and observed vs threshold values

The proxy stops applying the variant on next Edge Config sync (within 30s). No manual intervention required.

#### 3e. Hourly Compute-Outcomes Cron (0.5 days)

`POST /api/phase2/cron/compute-outcomes` — processes all `running` experiments. Idempotent: re-running on a completed experiment is a no-op. Cronitor heartbeat ping at start and completion.

### Timeline: 4 production days. Nothing else ships first.

---

## Gap 4 — Outcome Feedback & Learning Loop (P1, The Moat)

### Problem
Zybit's audit rules produce the same findings regardless of what has already been tested and measured. A rule will flag `form-abandonment` on a page even if Zybit already ran an experiment on that exact form and it did not move the metric. The rules have no memory.

The learning loop is the core moat. Without it, Zybit is a detection system. With it, it becomes a system that gets more accurate over time — the longer a PM uses it, the better the findings get.

### Architecture

```
Completed experiment outcome
        │
        ├── Did the variant win?
        │       ├── Yes → "winning signal" for this rule+pathRef combination
        │       └── No  → "null signal" — reduce confidence threshold for this rule+pathRef
        │
        ▼
  zybit_experiment_outcomes table
  { experimentId, findingId, ruleId, pathRef, won, liftPct, confidence, concludedAt }
        │
        ▼
  AuditRuleContext.previousOutcomes[]
  (passed to each rule on every insights run for this siteId)
        │
        ▼
  Rules adjust:
  - If rule fired before + outcome won → increase priorityScore by 10%
  - If rule fired before + outcome null → suppress for 30 days OR require stronger signal
  - Surface "you already tried this" context in finding summary
```

### What Needs to Be Built

#### 4a. Outcomes Table (1 day)

Add `zybit_experiment_outcomes` migration:
```sql
CREATE TABLE zybit_experiment_outcomes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES forge_experiments(id),
  finding_id TEXT REFERENCES forge_findings(id),
  rule_id TEXT NOT NULL,
  path_ref TEXT,
  won BOOLEAN NOT NULL,
  lift_pct REAL,        -- % improvement in primary metric (negative = variant lost)
  confidence REAL,      -- final statistical confidence at conclusion
  concluded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

Populate this row when an experiment moves to `completed`.

#### 4b. Previous Outcomes in Rule Context (1 day)

In `runPhase2InsightsPipeline`, before calling rules:
```typescript
const previousOutcomes = await loadOutcomesForSite(organizationId, siteId);
// pass into AuditRuleContext
ctx.previousOutcomes = previousOutcomes;
```

#### 4c. Rule Adjustments (2 days)

Update each of the 12 audit rules to consult `previousOutcomes` on `ctx`:

```typescript
// Example: form-abandonment rule
const priorOutcome = ctx.previousOutcomes?.find(
  o => o.ruleId === RULE_ID && o.pathRef === targetPath
);

if (priorOutcome) {
  if (!priorOutcome.won) {
    // Null result: require stronger signal to re-fire
    if (abandonmentRate < THRESHOLD * 1.5) return null;
    finding.summary += ` Note: a previous experiment on this form did not improve conversion — this signal is now stronger than when last tested.`;
  } else {
    // Win: boost priority, note the compounding effect
    finding.priorityScore = Math.min(1, finding.priorityScore * 1.1);
  }
}
```

#### 4d. Site-Level Learning Dashboard Section (1 day)

In the cockpit, add a "What we've learned" section:
- List of completed experiments with outcome (won/null/lost)
- Rules that have been calibrated by past outcomes
- "X findings suppressed because already tested" counter

This makes the learning loop visible and valuable in a PM's weekly review.

### Timeline: 5 production days

---

## Gap 5 — SPA & JavaScript-Rendered Page Support (P1)

### Problem
Zybit's snapshot fetcher uses raw HTTP GET to capture page HTML. This means any page that renders its content via JavaScript (React, Vue, Angular, Next.js client components) will return nearly empty HTML — no headings, no CTAs, no form elements. The design audit rules will produce no signal on most modern B2B SaaS products.

This is a hard constraint. Without SPA support, Zybit cannot audit a large class of target customers.

### Architecture Decision: Browserless.io

Do not build a headless browser service. Use **Browserless.io** — a managed Playwright/Puppeteer API that runs Chromium as a service. It is the correct third-party here.

- API: `wss://chrome.browserless.io?token=...` (WebSocket Playwright protocol)
- Or their REST screenshot/content API
- Pricing: $0.005/session at pay-as-you-go, sufficient for snapshot runs
- Fallback: if Browserless is unavailable, fall back to raw HTTP (current behavior)

**Alternative considered: Vercel Sandbox** — ephemeral Firecracker VMs that could run a browser. More expensive, more setup. Browserless is purpose-built for this. Use Browserless.

### What Needs to Be Built

#### 5a. Browserless Snapshot Fetcher (2 days)

Add `src/lib/phase2/snapshots/browserFetcher.ts`:

```typescript
export async function runBrowserSnapshot(url: string, options: SnapshotFetchOptions): Promise<SnapshotFetchResult> {
  const client = await playwright.chromium.connectOverCDP(
    `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
  );
  const page = await client.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeoutMs ?? 10_000 });
  const html = await page.content();
  await client.close();
  return parseHtml(html, url);
}
```

#### 5b. Auto-detection & Fallback (1 day)

In `runSnapshot` (the unified entry point), probe the raw HTTP response:
- If `<div id="root"></div>` or `<div id="app"></div>` detected with no content → SPA detected
- Re-fetch via Browserless
- If Browserless fails → log warning, return HTTP result with `snapshotMethod: 'http-only'`
- Surface `snapshotMethod` in the snapshot record so PMs can see "JS rendering used"

#### 5c. Environment Config (0.5 days)

Add `BROWSERLESS_TOKEN` to Vercel env vars. Gate Browserless calls behind `process.env.BROWSERLESS_TOKEN !== undefined`. 

**Add to Vercel project via `vercel env add BROWSERLESS_TOKEN`.**

### Timeline: 3.5 production days

---

## Gap 6 — Onboarding Completeness (P1)

### Problem
The connect wizard exists (`/dashboard/connect`) but it is fragmented and has no post-connect guidance. A PM landing in the dashboard for the first time has no hand-holding toward their first insight. The wizard captures the site URL and integration credentials but does not:

1. Confirm that events are actually flowing
2. Explain what to do while waiting for data
3. Guide the PM to run their first audit after the gate is met
4. Surface a "Baseline learning" progress bar that is prominent enough to actually drive action

This is a conversion problem for Zybit itself. If a PM signs up, connects PostHog, and then sees an empty dashboard with no direction, they churn.

### What Needs to Be Built

#### 6a. Post-Connect Welcome State (1 day)

After the connect wizard completes, show a "Learning mode" cockpit state:
- Large progress indicator: "Zybit is watching [domain]. First insights in ~[N] more sessions."
- Session counter: "45 / 100 sessions observed so far"
- "While you wait" section: 3 things the PM can do (add a second site, set MRR for revenue context, invite a teammate)

This replaces the empty findings list that currently shows before the threshold is met.

#### 6b. First Insight Email (1 day)

When `sessionDelta >= threshold` triggers for the first time for a site, send an email via Resend:

> **Your first Zybit report is ready**  
> We analyzed 100 sessions on acme.com and found 4 friction points costing an estimated $8,200/month. [View findings →]

Already have Resend installed — just needs the trigger and template.

#### 6c. MRR/AOV Capture in Connect Flow (0.5 days)

The connect wizard should ask for Monthly Recurring Revenue and Average Order Value before completing. This unlocks revenue-impact framing on all findings from day one. Currently MRR is settable via site meta API but not surfaced in the UI wizard.

#### 6d. Empty State Guidance (0.5 days)

If a PM visits findings with zero results, show:
- Why there are no findings yet (gate not met, or no events ingested)
- Specific next action (connect an integration, or wait for N more sessions)
- Not just "No findings yet."

### Timeline: 3 production days

---

## Gap 7 — Preview Deployments & Visual Diffs (P2)

### Problem
When a PM defines a variant modification in Zybit, they have no way to see what it will look like before activating it on live traffic. The finding detail page has a "Preview URL" field where they can paste a staging URL or Figma mock — but Zybit does not generate this preview automatically.

### Architecture: Two-Level Preview System

**Level 1 (CSS-only preview, no external dependency) — v1:**

When a variant modification is saved, generate a shareable preview link:
`/preview/{experimentId}?src={encodedOriginUrl}`

This route fetches the page HTML, applies the modifications as `<style>` injections and DOM mutations, and serves the result. The PM sees the modified page in an iframe without touching production.

**Level 2 (Vercel deployment preview) — v2:**

When Zybit connects to a GitHub repository (via GitHub OAuth), it can open a PR with the variant changes as code, get a Vercel preview URL automatically, and surface that URL in the finding detail. This is the "see in staging" workflow.

- **Third party:** GitHub API (OAuth) + Vercel Deployment API
- This is P2 — skip for initial launch

### What Needs to Be Built (v1 only)

#### 7a. Preview Render Endpoint (1.5 days)

`GET /api/preview/{experimentId}` — fetches origin HTML, applies CSS/text modifications, returns modified HTML for iframe embed.

#### 7b. Preview Panel in Experiment Detail (1 day)

In experiment detail page, show a preview iframe that loads the modified page side-by-side with the original. Toggle: control | variant.

### Timeline: 2.5 production days (v1 only)

---

## Gap 8 — Observability & Reliability (P1)

### Problem
There is no visibility into how the cron jobs are performing, whether insights runs are failing silently, or how long rule evaluation takes. If PostHog sync fails for a tenant, nobody knows. If the snapshot fetcher times out for an entire customer, findings stop updating with no alert.

### What Needs to Be Built

#### 8a. Vercel Log Drains → OpenTelemetry (1 day)

Configure Vercel Log Drains to send structured logs to a provider. **Use Axiom** — it has a native Vercel integration, free tier, and good querying. No custom instrumentation required initially.

- Add structured logging (`console.log(JSON.stringify({...}))`) to:
  - Every cron job run (integrations processed, findings upserted, errors)
  - Every insights pipeline run (rule outputs, timing, gate result)
  - Every snapshot fetch (URL, status, bytes, timing)

#### 8b. Cron Health Monitoring (1 day)

- Add `POST /api/health/cron` endpoint: returns status of last sync per site
- Hook this into a simple Vercel cron job that sends Resend alert email if any site hasn't synced in 2+ hours
- Or: use **Better Uptime / Cronitor** (dead man's switch) — lightweight third-party for cron heartbeat monitoring. Add `curl https://cronitor.link/p/{id}/run` at start of cron handler, `complete` at end.

**Third party: Cronitor** (free tier, perfect for this). Do not build custom cron monitoring.

#### 8c. Error Budget per Tenant (0.5 days)

Track per-site sync failures in DB:
- If site fails 3 consecutive syncs → `integration.status = 'degraded'`, surface warning in cockpit
- If 5 consecutive → `status = 'disconnected'`, send email to PM

This is already partially wired (integration has `status` and `lastErrorCode` columns) — just need the failure-count logic in the cron job.

### Timeline: 2.5 production days

---

## Gap 9 — Staging Environment & E2E Test Harness (P1)

### Problem
There is no staging environment that mirrors production. All development happens against production Neon DB and production Clerk tenant. This is risky for any destructive schema migration or billing change.

There are also no end-to-end tests that simulate a real PM flow (connect site → ingest events → run insights → create experiment). Unit tests exist for audit rules but not for the API and UI layer.

### What Needs to Be Built

#### 9a. Staging Environment (1 day)

- Create a second Vercel environment: `zybit-staging.vercel.app`
- Separate Neon branch (Neon supports DB branching natively — free)
- Separate Clerk dev instance (already supported by Clerk dashboard)
- Add `NODE_ENV=staging` guard to prevent staging from sending real emails or charging Stripe

**Use Neon DB branching** — this is exactly the use case. Branch from prod schema, use for staging, delete and re-branch after migrations. No extra cost.

#### 9b. E2E Test Suite with Playwright (2 days)

Playwright against `localhost:3000` with a test Neon branch:

```
tests/e2e/
├── connect-site.spec.ts     # wizard: enter URL → connect PostHog → validate
├── ingest-events.spec.ts    # POST to /api/intake, confirm canonical events stored
├── run-insights.spec.ts     # POST to /api/dashboard/findings, confirm findings returned
├── create-experiment.spec.ts# approve finding → fill form → create experiment
└── proxy-variant.spec.ts    # activate experiment → request proxied URL → confirm modification applied
```

Run on every PR via GitHub Actions. Currently the workflow (`Zybit verify`) only runs lint + tsc + build. Add E2E step.

### Timeline: 3 production days

---

## Gap 10 — Cross-Site Aggregate Learning (P3, Long-Term Moat)

### Problem
Each site's learning loop is isolated. When `form-abandonment` fires on a new customer's checkout page, Zybit has no idea that this exact finding pattern has been tested 47 times across other customers and won 82% of the time. This prior knowledge should increase the finding's priority score and confidence for new customers immediately.

This is the long-term moat. The more customers use Zybit, the more accurate the findings become for every customer — a flywheel.

### Architecture

```
Per-site outcome (won/null/lost)
        │
        ▼
zybit_global_rule_priors table
{ ruleId, bucket: (category × pathType), winRate, sampleSize, updatedAt }
        │
        ▼
Rule context injection (same as per-site, but aggregate)
ctx.globalPriors[ruleId] = { winRate: 0.82, n: 47 }
        │
        ▼
Rule priorityScore boosted by Bayesian update:
posterior = (priorWins + localWins) / (priorN + localN)
```

**Privacy:** Global priors are derived from aggregated outcomes only — no PII, no site-specific event data crosses tenant boundaries. The aggregation happens at the `ruleId × pathType` level (e.g., "checkout-page form abandonment"), not at URL level.

### What Needs to Be Built

#### 10a. Global Priors Table (1 day)

```sql
CREATE TABLE zybit_global_rule_priors (
  rule_id TEXT NOT NULL,
  path_type TEXT NOT NULL,  -- 'checkout' | 'pricing' | 'signup' | 'generic'
  win_count INTEGER NOT NULL DEFAULT 0,
  trial_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, path_type)
);
```

Path type is classified from the `pathRef` using a simple keyword heuristic (`/checkout` → 'checkout', `/pricing` → 'pricing', etc.).

#### 10b. Prior Update Job (1 day)

Triggered when an experiment completes: classify the `pathRef`, upsert into `zybit_global_rule_priors`.

#### 10c. Prior Injection into Rule Context (1 day)

Load global priors at pipeline start (cached hourly), inject alongside per-site outcomes.

#### 10d. Bayesian Priority Score Adjustment (1 day)

Each rule's `priorityScore` gets a prior boost when `globalPrior.winRate > 0.7` and `globalPrior.trial_count >= 10`. Makes findings from well-tested patterns rise to the top automatically.

### Timeline: 4 production days (deferred — do after 50 customers)

---

## Build Sequence (updated)

Four things. In this order. Everything else is a distraction until they exist.

```
IMMEDIATE — Week 1 (parallel tracks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Track A  Gap 3 — Measurement rigor (4 days)
         Outcome table + conversion join + chi-squared + sequential testing
         + auto-stop + guardrail evaluation + hourly cron

Track B  Gap 7 — Preview before deploy (2 days, different surface)
         /api/preview/[experimentId] endpoint + iframe in experiment detail

Deliverable: Experiment results are real numbers, not manual inputs.
             PM sees the change before it goes live on real traffic.

WEEK 2 — Visible loop view
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         /app/loop (or /app/activity): timeline of detection → deploy → result → learning
         Needs Gap 3 data to populate. This is the demo and the renewal story.

WEEKS 2-3 — Proxy reliability + SPA support
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Gap 5    SPA support via Browserless (snapshot fetcher + proxy SPA handling)
Gap 1 (remainder) Fail-open, kill switch, auto-rollback wiring
         Non-negotiable before any paid pilot.

WEEK 3 — GA4 connector
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         Google Analytics Data API pull-sync; same pattern as PostHog.
         Required for analytics-agnostic claim to be credible.

WEEK 4 — Per-site outcome feedback into rules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Gap 4    previousOutcomes in AuditRuleContext; 3 rules updated
         (form-abandonment, bounce-on-key-page, hero-hierarchy-inversion)

ONGOING — Scale and coverage
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         Amplitude, Mixpanel connectors (one at a time)
         Gap 9 — Staging env + E2E harness
         Gap 2 — Billing hardening
         Gap 10 — Cross-site priors (not before 50+ customers with outcome rows)

NEVER BUILD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         Sentiment analysis / NLP / voice-of-customer
         GitHub PR generation or code deployment
         Own event collection SDK / PostHog replacement
         More audit rules (12 is sufficient; bottleneck is measurement)
         Gap 7v2 (GitHub PR + Vercel preview URLs) — out of scope
```

---

## Third-Party Decisions Summary

| Need | Use | Do NOT build |
|------|-----|-------------|
| Auth | Clerk (already in) | Custom session management |
| Email | Resend (already in) | SMTP relay |
| Headless browser | Browserless.io | Own browser infra |
| Edge experiment config | Vercel Edge Config | Custom KV or Redis |
| Observability | Axiom (Vercel native integration) | Custom log aggregation |
| Cron monitoring | Cronitor (dead-man's-switch) | Custom health API |
| DB branching (staging) | Neon branches | Separate Postgres instance |
| Billing | Stripe | Paddle / custom |
| Statistical significance | Custom chi-squared (pure math) | Third-party stats lib |
| Variant proxy | Vercel Middleware (already in deployment) | Cloudflare Workers / ngrok |

---

## What We Own

The intelligence layer — every rule, every signal combination, every evidence schema, every prioritization heuristic — is ours. Third parties handle plumbing. Zybit's competitive position is in the quality and accuracy of findings, the tightness of the propose→test→learn loop, and the cross-site priors that make it better with every customer added.

No third party can replicate the rule engine, the canonical event schema, or the Bayesian prior system. Those are the durable assets.

# Zybit — Product Doctrine

**This is the single source of truth for what Zybit is, who it's for, and how we build it.**

---

## What Zybit is

Zybit is a conversion intelligence platform for product managers.

You connect your product. Zybit audits it — learning your brand DNA, visual hierarchy, and messaging — then watches how your real users move through it. It identifies exactly where conversions are being lost, proposes specific evidence-backed changes, and deploys live A/B tests against your production product. You see what worked. The cycle repeats. Your product gets measurably better.

---

## Who it's for

**Primary buyer:** Product managers and Chief Product Officers at B2B SaaS companies, startups, and consumer products where conversion rate directly moves revenue.

**Primary user:** The PM who owns growth. Someone who knows their product needs work but can't justify which change to prioritize — and doesn't want to spend weeks inside analytics dashboards to find out.

**Not for:** Developers (they integrate Zybit; PMs use it). Teams that want more charts. People building products from scratch.

The PM-first framing is non-negotiable. Every UI decision, every output format, every finding must be evaluated by: *would a product manager understand this and know what to do next?*

---

## The loop

Zybit runs a repeating six-step cycle. The loop is the product — every feature we build either advances the loop or it doesn't belong.

### 1. Understand
Full-product audit via headless browser. Zybit reads your brand DNA: visual hierarchy, heading structure, CTA inventory, form complexity, messaging. It doesn't impose a template — it learns what makes your product yours, so it can identify deviations from your own intent, not from some generic rulebook.

Understanding is two-level: **each page** (structure, hierarchy, brand DNA) **and the whole product** (how pages connect into flows, and how real users move between them). The page-level audit is built; the product-level flow graph is the next layer — see `docs/PRD.md`.

### 2. Watch
Behavioral data collection from your analytics stack (PostHog, Segment, or direct). Zybit tracks how real users move: where they hesitate, where they abandon, which cohorts convert differently, what gets rage-clicked.

### 3. Identify
Chokepoint analysis. Zybit surfaces specific, evidence-grounded findings — naming the actual element, the actual form field, the actual page, the actual user segment where friction lives. Every finding is traceable to the underlying behavioral data. We do not surface suggestions with no evidence.

### 4. Propose
Concrete improvement briefs. Each suggestion includes: what to change, why it works (citing specific behavioral evidence), and exactly what the A/B variant should look like. The PM reviews and approves.

### 5. Test
One-click A/B deployment to production. PM approves the variant; Zybit manages the test. No engineering ticket required. The change goes live against real traffic.

### 6. Learn
Test outcomes — what moved the metric, what didn't — feed back into the model. Every result makes future suggestions sharper. This is what compounds over time. Layer 1 (per-site re-ranking) is shipped: past outcomes adjust the priority of new findings via a cascade match + D-with-guardrails formula, surfaced in the backlog pill, finding-detail "Past tests" panel, and the LEARNED timeline entry on `/app/loop`. Layer 2 (per-site rule-threshold calibration) is shipped: `ruleCalibration.ts` turns a site's accumulated outcomes per rule into a detection-floor multiplier — rules that repeatedly win on a site fire on weaker signal, rules that repeatedly lose require stronger signal — applied before the rules run. Layer 3 (cross-site priors) remains future work, explicitly deferred until 50+ customers.

---

## Unique value

**Analytics-agnostic.** Zybit sits on top of whatever analytics the customer already runs — PostHog, Segment, GA4, Amplitude, Mixpanel. We never ask them to replace it. This is the structural moat that incumbents cannot copy without cannibalizing themselves: PostHog and Mixpanel need you to use them; Zybit works because you already do. This must be present in every sales conversation, every pitch, and every demo.

**Evidence-first.** Every finding is traceable to specific behavioral data. If we can't cite the evidence, we don't make the suggestion. Every recommendation has an inspectable logic chain — rule fired, evidence cited, prescription generated — that a PM can read, defend in a meeting, and trust the deploy button. This is a deliberate choice against LLM black-box suggestions.

**Brand-aware.** Zybit understands your product before it criticizes it. Per-product normalization means we compare you to yourself, not to a generic template. A finding that would harm what makes your product distinctive is a bad finding.

**Closed-loop measurement.** Not just "here's what to change" but "here's what we tested and what we learned." The value compounds as results feed into better future suggestions. The outcome-labeled dataset from real experiments — which variant won, by how much, on what kind of site — is the durable asset no third-party analytics tool has.

**One ranked backlog.** Instead of scattered analytics tabs, replay sessions, and team gut-feel, PMs get one prioritized, evidence-backed list of improvements — with receipts attached.

---

## The long-term vision

**Close the loop entirely.** Today Zybit tells you what to change and runs the test. The next step is learning from every test result automatically — so each round of suggestions is measurably better than the last. The visible expression of this is a timeline a PM can point to: we detected this, we deployed this variant, it moved the metric by X%, and here is what we learned that changed the next recommendation. That sequence — visible, attributable, compounding — is the product.

**Own the outcome-labeled dataset.** The long-term moat is not raw event collection. It is outcome labels: which variant won, by how much, on what kind of page, for what kind of site. No analytics incumbent has this. Every experiment Zybit runs adds a row to this dataset. As it grows, findings can be weighted by expected win probability across similar sites and patterns — a flywheel that gets more accurate with every customer added and that requires years of real experiments to replicate.

**Stay analytics-agnostic, go deeper.** PostHog and Segment are connectors. GA4, Amplitude, and Mixpanel come next. Warehouse-native ingestion (BigQuery, Snowflake) follows. The goal is: whatever analytics a customer already runs, Zybit works. We never ask them to replace it. Expanding connector coverage is a first-class strategic priority, not an integration detail.

**Simulate before shipping.** Once we have enough outcome data at scale, we can predict A/B test outcomes before running them live — ship the winning variant on day one with model-backed confidence. This requires years of proprietary outcome-labeled data to build, which is why every experiment we run today matters. It is also where the moat becomes unassailable: it cannot be replicated without running thousands of real experiments first.

**The endgame: your product improves continuously, without you thinking about it.** Product managers and CPOs would pay significant money for a product that genuinely does this. Nobody has fully built it yet. We are building toward it one loop at a time.

---

## Roadmap

### Phase 1 — Close the loop (now)
Four things, in order. Nothing else.

1. **Measurement rigor.** Compute-outcomes: join assignments to conversions, run chi-squared significance with sequential testing boundaries (no early stopping on noise), auto-stop at 95% confidence, guardrail metrics with auto-rollback. This is the only thing that converts Zybit from a calculator into a measurement system. Four days of focused work. Nothing else matters until this exists.

2. **The visible loop view.** A timeline that shows: we detected this, we deployed this variant, it moved the metric by X%, and here is what we learned that changed the next recommendation. This is what every demo runs on and what every renewal renews on.

3. **Delivery reliability.** Fail-open behavior before any paid pilot routes real production traffic — one outage equals a dead pilot. Server-rendered HTML sites are delivered via the edge proxy (built). A client-side runtime for SPAs / authenticated products is a deferred, customer-pulled phase, not a scheduled milestone — see `docs/PRD.md` §4.

4. **Preview before deploy.** PM sees the modified page in an iframe before activating it on real traffic. Two days. Removes a trust blocker on every demo.

### Phase 2 — Deepen coverage and compound (year one)
Expand analytics-agnostic ingestion (GA4 first, then Amplitude/Mixpanel, then warehouse-native). Build the per-site outcome feedback loop so rules calibrate on past results. Make the visible loop view richer. Onboard 10-50 product teams to build the outcome-labeled dataset that makes findings progressively more accurate.

### Phase 3 — Simulate (year two)
Build outcome-based priors across all customers (anonymized, aggregated). Then: given enough outcome data, predict A/B test results before running them live. Ship the winning variant on day one with model-backed confidence. This requires years of proprietary outcome-labeled data to build — which is exactly what Phase 1 and Phase 2 are collecting.

---

## Data strategy

Zybit's long-term moat is outcome-labeled data, not raw event collection. Models commoditize. Data does not.

**What we collect:** Experiment assignments, conversion outcomes, lift measurements — paired with the finding that generated the experiment and the rule that generated the finding. This is not general behavioral data; it is structured experimental evidence about what changes move what metrics on what kinds of sites.

**What we own:** No third-party analytics tool has outcome labels. PostHog knows that users churned. Zybit knows that changing the CTA copy on the pricing page increased conversion by 12%, and that a similar change on a checkout page with similar traffic patterns won 73% of the time across all customers. That is a structurally different and more valuable dataset.

**The flywheel:** Every experiment Zybit runs adds to the outcome-labeled dataset. As it grows, findings become more accurate for new customers with no history — the prior says "this pattern wins 80% of the time." This is the compounding advantage. It cannot be replicated without running thousands of real experiments across real customers.

**Why analytics-agnostic is the moat, not the risk:** PostHog and Mixpanel cannot build what we build without cannibalizing themselves. Every dollar they invest in "you should use us for A/B testing too" is a dollar that widens the gap for a provider that sits on top of all of them. We stay on top. We never replace them. That positioning is defensible and is reflected in every sales conversation.

---

## What Zybit is not

- A site or product builder
- A replacement for your analytics stack — PostHog, Segment, GA4, Amplitude, Mixpanel are connectors, not competitors. We never build this.
- A "UX best practices" checklist
- An AI that writes copy or redesigns your pages
- A tool that invents numbers or generates evidence from thin air
- A sentiment analyzer, voice-of-customer tool, or NLP pipeline. Not loop-advancing; pulls us into PII and consent complexity. Never build this.
- A GitHub PR generator or code deployment system. Cool demo; zero deal-closing value for the PM buyer. Never build this.
- A PostHog ingestion replacement or direct behavioral event SDK. Fights an incumbent on their strongest ground while abandoning our structural moat. Never build this.
- A system where adding behavioral rules (event-based) closes the measurement gap. The 12 behavioral rules are frozen at that count — the bottleneck is loop closure, not behavioral rule count. New rules must be structural/snapshot-grounded (SEO, accessibility, HTML structure) and deterministic pure functions — no LLM calls in rule logic.
- A cross-site learning system before 50+ customers with real outcome data. The priors mean nothing without the sample size. Build the single-customer loop first.

---

## Where we are today

**For the canonical build-state table, see [`AGENTS.md`](./AGENTS.md) — "Current build state."**
That table is the single source of truth for what is built, partial, or
not yet built. This section keeps only what is unique to the doctrine:
the immediate priorities and what we deliberately do **not** build.

### Immediate priorities (in order)

The product direction is set by [`docs/PRD.md`](./docs/PRD.md) —
deliberately **one milestone**, not a platform build.

1. ~~**Flow-graph advisory (PRD Milestone 1)**~~ ✅ **Complete** — all 5
   PRD scope items shipped. Everything beyond the committed milestone
   (client runtime, journey experiments, one-click in-app deploy, full
   AI advisor, element picker) is **deferred until a customer pulls
   it** — see [`docs/PRD.md`](./docs/PRD.md) §4 and
   [`docs/sprints/sprint-3-deferred.md`](./docs/sprints/sprint-3-deferred.md).
2. ~~**URL-audit lead magnet (Phases A + B)**~~ ✅ **Shipped 2026-05-23 in
   PR #69.** Public `/audit` form → double opt-in confirmation →
   `runUrlAudit` pipeline → 4-finding HTML report by email. Spec +
   shipped scope: [`docs/sprints/url-audit-lead-magnet.md`](./docs/sprints/url-audit-lead-magnet.md).
   Phase C (founder approval queue) + Phase D (landing-page surface)
   deferred.
3. Forward-looking priorities live in
   [`docs/sprints/next-bets.md`](./docs/sprints/next-bets.md) (preview
   pipeline → manual outcome entry → richer modifications → one-click
   deploy).

### Recently completed

23 audit rules now live (5 design + 7 pain + 1 flow + 7 structural + 3 AI copy critique). The 7 structural rules are Layer E — snapshot-only, no behavioral events required: `headingHierarchyJump`, `formLabelMissing`, `imageAltTextMissing`, `linkTextGeneric`, `missingMetaDescription`, `missingCanonicalUrl`, `deadClickTarget`. **Layer F (2026-05-26, this session)** — three new rules driven by a structured Gemini critique cached at capture time on `snapshot.data.copyCritique`: `vagueClaimDetected` (hero specificity), `proofMissing` (zero proof signals on a sales-shaped page), `ctaVerbMismatch` (CTA verb doesn't fit the vision-classified `pageType`). LLM call lives in `captureCopyCritique.ts` (structured-output + strict validator + fail-soft); rules themselves are pure deterministic functions over the cached output — same trust model as the AI Variant Advisor. **PageType modulation (Ring 2 consumer, same session)** — new `pageTypeModulation.ts` table now drives per-(rule, pageType) threshold modulation across 6 existing rules so a "primary CTA below the fold" finding does not fire on a Privacy Policy page, etc. Fail-open: rules degrade to base thresholds when the vision pass didn't run. Dollar figures removed from `impactEstimate` — revenue/ecommerce goal types return conversion counts. `proposeAnnotations` rewritten across 9 rules so each preview anchor matches its prescription, and `AnnotatedFindingPreview` renders a per-rule "why this is highlighted" callout. `app_users` extended with `industry`, `role_title`, `last_audit_at` and a new `app_user_rules_fired` table scaffolds per-PM personalization (migration `0022`). `VariantModification` gained a 7th type — `element-insert` (splices new HTML at `before`/`after`/`prepend`/`append` of an anchor, sanitized by `sanitizeInsertHtml` with a tag+attr allowlist, no `<script>`/`<iframe>`/`<form>`, no inline handlers, no `javascript:`/`data:` URLs). Audit funnel hardened: cookie hex-format guard, email normalization for HMAC so Outlook safelinks survive, `AUDIT_FROM_EMAIL` precedence cleaned up, `signupLink` only minted at `status === 'done'`. CSP/XSS hardening: `stripScripts` fails closed and defeats the `javascript:` entity bypass, SSRF guard re-checks on every redirect hop, lighthouse preview origin env-gated via `LIGHTHOUSE_PREVIEW_ORIGIN`. Selector auto-fill in the experiment builder fixed (was emitting `[data-zybit-ref=…]` placeholders instead of real CSS selectors).

### What is deliberately not being built

Sentiment analysis, GitHub PR generation, PostHog replacement / direct
SDK, more behavioral (event-based) rules, cross-site priors before 50
customers with outcomes. See "What Zybit is not" above for the rationale
on each.

---

## How we build

**Deterministic over generative.** Audit rules are pure functions. Same input, same output. Every finding is reproducible and attributable. We do not use LLMs to generate numbers or invent evidence.

**Every file has a purpose.** No scaffolding, no placeholders, no "we might need this later." If code doesn't serve a current need, it doesn't exist.

**The loop, not the feature.** We don't build analytics features or dashboard charts for their own sake. We build what advances the cycle: understand → propose → test → learn.

**Third-party where it's better.** We own the conversion intelligence layer. We also own auth (invite-only magic-link; no Clerk). We don't own email (Resend), analytics ingestion (PostHog/Segment), or hosting (Vercel/edge infrastructure). Integrate the rest; build only what's differentiated.

**PM-first at every layer.** The PM is the user. Engineering integrates Zybit; PMs run it. Every output — finding title, evidence summary, export format — is written for someone who owns a product, not someone who reads curl responses.

---

## Codebase map

```
zybit/
  src/lib/phase1/         — Readiness scoring + insights engine (deterministic, pure)
  src/lib/phase2/         — Canonical events, audit rules, connectors, snapshots
    connectors/posthog/   — PostHog sync + event mapping
    connectors/segment/   — Segment webhook receiver
    rules/                — 23 audit rules (5 design + 7 pain + 1 flow + 7 structural + 3 AI copy critique); 83 test files in repo
    snapshots/            — Static HTML parse + visual-weight analysis
    rollups/              — Event → InsightInput aggregation pipeline
  src/lib/auth/           — Invite-only magic-link auth + M2M API keys
  src/lib/db/             — Drizzle schema + Postgres migrations
  src/app/api/phase1/     — Readiness + insights HTTP API
  src/app/api/phase2/     — Canonical events, insights run, connectors, snapshots
  src/app/dashboard/      — Customer-facing PM dashboard (in progress)
  drizzle/                — SQL migrations
  docs/                   — Technical reference
```

## Document map

| Document | Purpose |
|----------|---------|
| `DOCTRINE.md` (this file) | What Zybit is, who it's for, how we build it |
| `docs/PRD.md` | Ratified product direction: the page-level + flow-level synthesis and its build sequence |
| `docs/pivot.md` | Superseded by `docs/PRD.md`; retained as the strategic-discussion record |
| `docs/ARCHITECTURE.md` | Technical architecture: system design, what's built, what's not, scaling |
| `docs/BACKLOG.md` | Prioritized epics and stories toward commercial launch |
| `docs/PHASE2_EVIDENCE_MODEL.md` | Technical reference: event schema, audit rules, connector contracts |
| `docs/PHASE2_LIVE_TUNING_PLAYBOOK.md` | Operator runbook for calibrating rules against live traffic |
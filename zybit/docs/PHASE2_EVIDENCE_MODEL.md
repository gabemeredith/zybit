# Zybit — Phase 2 Evidence Model

**Audience:** integrators, design-partner engineers, GTM with technical context.
**Status:** v1 — versioned evidence contract that powers `/api/phase2/*`.

This document is the canonical reference for **what Zybit needs in order to produce
trustworthy findings from real customer data**, and how the new Phase 2 contracts
relate to the Phase 1 deterministic engines.

---

## 1. Why Phase 2 exists

Phase 1 ships pure, deterministic engines (sufficiency + insights) but expects the
caller to supply pre-shaped aggregates such as `cohorts[]`, `narratives[]`,
`onboarding[]`, `ctas[]`, `deadEnds[]`. **No commercial analytics tool emits
those shapes natively.** Phase 2 closes the gap with:

- A **versioned canonical event** that connectors and clients can both speak.
- A **per-site config** declaring how a site's events map to cohorts, funnel
  steps, CTAs, and narratives.
- A **rollup pipeline** that turns canonical events + config into the
  Phase 1 `InsightInput`.
- A **validation gate** that emits structured warnings when the engine's output
  is underpowered.
- End-to-end routes: **`POST /api/phase2/insights/run`** and **`POST /api/phase2/insights/receipt`** (same runner; receipt adds **`zybit.receipt.v1`** or Markdown export).

---

## 2. Versioned canonical event (v2)

The Phase 2 ingestion shape is defined in `src/lib/phase2/types.ts` as
`CanonicalEvent` (server-side) and `CanonicalEventInput` (wire shape).

Key v2 additions vs. legacy Phase 1 events:

| Field | Type | Purpose |
| --- | --- | --- |
| `occurredAt` | ISO date | engine-time used for windowing (defaults to `createdAt` if omitted) |
| `source` | `'api' \| 'shopify' \| 'segment' \| 'ga4' \| 'posthog' \| 'custom'` | provenance + dedupe namespace |
| `sourceEventId` | string | external id; uniqueness with `(siteId, source, sourceEventId)` |
| `anonymousId` | string | opaque visitor handle for stitching |
| `properties` | `Record<string, string \| number \| boolean \| null>` | mapped, not raw provider blobs |
| `schemaVersion` | `1 \| 2` | rows ingested via Phase 2 are `2`; legacy rows treated as `1` |

**Backward compatibility.** `POST /api/phase1/events` accepts the new fields
optionally. Clients that send only the old fields keep working unchanged.

**Dedupe.** With `source` and `sourceEventId` set, a unique index in Postgres
(`phase1_events_dedupe_idx`) blocks duplicate inserts. Blob driver dedupes via
linear scan and is documented as the lower-throughput fallback.

---

## 3. Per-site Phase 2 config

`Phase2SiteConfig` declares **how** the site should be analyzed.

| Field | Drives | Required for which finding to fire |
| --- | --- | --- |
| `cohortDimensions[]` | session partitioning by `property`, `metric`, or `path-prefix` | `cohort-asymmetry` |
| `onboardingSteps[]` | ordered funnel matched by `event-type` or `path-prefix` | `onboarding-friction` |
| `ctas[]` | per-page CTA registry with declared `visualWeight` and click matchers | `cta-hierarchy-conflict` |
| `narratives[]` | story page → expected next paths | `narrative-ia-mismatch` |
| `conversionEventTypes[]?` | extends Zybit's default conversion set | dead-end + cohort conversion math |

Read & write via `GET / PUT /api/phase2/sites/:siteId/config`.

**Why declarative?** Zybit cannot infer "what is your onboarding" or "which
button is your primary CTA" from raw clicks; doing so would defeat the
determinism and explainability Phase 1 promises.

---

## 4. Rollup pipeline

`buildInsightInputFromEvents(ctx, now?)` (in `src/lib/phase2/rollups/`) is a
pure function. Same input → same output.

Pipeline stages:

1. **`filterEventsInWindow`** — keep events with `start <= occurredAt < end`.
2. **`buildCohortAggregates`** — partition sessions by each dimension's value;
   per cohort emit `sessionCount`, `conversionRate`, `avgIntentScore`,
   `evidenceRefs`. `avgIntentScore` defaults to `0.5` when no
   `metrics.intent` is present.
3. **`buildDeadEndAggregates`** — sessions whose **last** in-window event on a
   path did not convert; rage signal from `metrics.rage > 0` or
   `event.type === 'rage_click'`.
4. **`buildOnboardingAggregates`** — entry rate, completion rate, median
   duration to next step, rage rate per declared step.
5. **`buildCtaAggregates`** — clickShare, conversionShare per declared CTA
   per page.
6. **`buildNarrativeAggregates`** — dominant next-path share and mismatch rate
   relative to `expectedPathRefs`.

Output: `RollupResult { insightInput, diagnostics }`. The diagnostics include
`windowDurationMs`, `uniqueSessions`, per-category coverage, and per-source
event counts.

---

## 5. Validation gate

`runInsightInputGate({ rollup, config, window })` emits structured warnings
without changing engine output. Codes (stable in `GateWarning.code`):

| Code | Level | Trigger |
| --- | --- | --- |
| `WINDOW_TOO_SHORT` | warn | window < 24h |
| `LOW_SESSION_COUNT` | warn (<50) / block (<10) | unique sessions in window |
| `COHORT_IMBALANCE` | warn | smallest cohort < 30 and largest/smallest ≥ 5x |
| `EMPTY_NARRATIVES_CONFIG` | info | site has no narrative declarations |
| `EMPTY_ONBOARDING_CONFIG` | info | no onboarding steps |
| `EMPTY_CTA_CONFIG` | info | no CTA registry |
| `NO_DEAD_END_DATA` | info | events present but no path crossed dead-end floor |
| `DOMINANT_SOURCE` | info | one source ≥ 90% of events |

`GateResult.ok = true` iff zero `block` warnings. Routes map this to the
`trustworthy` field of the response.

---

## 6. End-to-end run

`POST /api/phase2/insights/run`

```jsonc
{
  "siteId": "site_123",
  "window": { "start": "2026-04-01T00:00:00Z", "end": "2026-04-22T00:00:00Z" },
  "maxFindings": 5
}
```

Pipeline server-side:

1. Resolve `organizationId` (header > body > query > default per
   `PHASE1_ORG_IDENTITY_MODE`).
2. Load `Phase2SiteConfig` and windowed events in parallel.
3. `buildInsightInputFromEvents` → `runInsightInputGate` → `generateFindings`.
4. `runAuditRules` over rollups + page snapshots (when configured).
5. Respond with findings, warnings, diagnostics, `trustworthy`, and `auditReport`.

### 6.1 Receipt export

`POST /api/phase2/insights/receipt` — identical request body to §6 (`siteId`,
`window`, optional `maxFindings`).

- **Default (`format=json`):** resolves `RunInsightsResponse` the same way, then wraps it in **`zybit.receipt.v1`**:
  `{ "schemaVersion": "zybit.receipt.v1", "exportedAt": "<ISO8601>", "run": { ... } }` inside the standard `{ success, data }` envelope.
- **`format=markdown`:** returns `Content-Type: text/markdown` with `Content-Disposition: attachment`, suitable for demos and email.

---

## 7. What customers must provide (Phase 2 onboarding checklist)

| Step | Action | Where |
| --- | --- | --- |
| 1 | Set storage env: `BLOB_READ_WRITE_TOKEN` and/or `DATABASE_URL` | deployment env |
| 2 | Apply Drizzle migration `drizzle/0000_phase2_canonical_events.sql` (Postgres path) | DB |
| 3 | Create a site: `POST /api/phase1/sites` | API |
| 4 | Declare site config: `PUT /api/phase2/sites/:siteId/config` | API |
| 5 | Send canonical events: `POST /api/phase1/events` (with `occurredAt`, `source`, `sourceEventId`) | API |
| 6 | Run insights: `POST /api/phase2/insights/run` | API |
| 7 | (Optional) Export receipt: `POST /api/phase2/insights/receipt` (`zybit.receipt.v1` or Markdown) | API |
Phase 1 tables, the migration is a baseline + alters. New deployments can
apply it as-is. Operators should review `drizzle/0000_phase2_canonical_events.sql`
and either run it or hand-write the additive `ALTER`s.

---

## 8. Versioning policy

- `CANONICAL_EVENT_SCHEMA_VERSION` is bumped only when **semantic** meaning
  changes; additive nullable fields do not require a bump.
- `Phase2SiteConfig` is unversioned today. If breaking shape changes are
  needed, add `schemaVersion` to the config and gate reads on it.
- Insight rule constants live in `src/lib/phase1/insights/rules.ts` and are
  intentionally stable; gate thresholds (`COHORT_MIN_SESSIONS = 30`,
  `LOW_SESSION_BLOCK = 10`, etc.) mirror them.

---

## 9. PostHog connector (first-class provider)

PostHog is the first integrated provider. Mapping lives in
`src/lib/phase2/connectors/posthog/` and is pure — connectors only do network
I/O; transformation is testable in isolation.

### 9.1 Credential & config checklist

A pilot using PostHog must provide:

| Item | Where it lives |
| --- | --- |
| **Personal API key** with read scope on the project | env var, name documented in `secretRef` (e.g. `POSTHOG_API_KEY__SITE_ABC`) — never in DB |
| **Project id** | `phase2_integrations.config.projectId` |
| **Host** | `phase2_integrations.config.host` (e.g. `https://us.posthog.com`) |
| **Zybit site id** | created earlier via `POST /api/phase1/sites` |

The Zybit service reads only the env-var name (`secretRef`) from the DB and
resolves the secret server-side at request time. The secret value is never
logged, never returned to clients, and never stored in JSONL.

### 9.2 PostHog → Canonical mapping

| PostHog field | Canonical event field | Notes |
| --- | --- | --- |
| `event` | `type` | `$pageview`→`page_view`, `$pageleave`→`page_leave`, `$autocapture`→`cta_click`, `$rageclick`→`rage_click`. Custom events pass through. |
| `timestamp` | `occurredAt` | Re-emitted as ISO. |
| `uuid` (or `id`) | `sourceEventId` | Powers `(siteId, source, sourceEventId)` dedupe. |
| `distinct_id` (or `person.distinct_id`) | `anonymousId` | Stable visitor handle. |
| `properties.$session_id` → `$window_id` → `session_id` → `distinct_id` | `sessionId` | Falls back to `"unknown_session"`. |
| `properties.$pathname` (or parsed `$current_url`) | `path` | Always begins with `/`. |
| `properties.$duration × 1000` (or `dwell_ms`) | `metrics.dwellMs` | |
| `properties.$scroll_percentage` | `metrics.scrollPct` | |
| `properties.intent` | `metrics.intent` | Clamped 0..1. |
| `$rageclick` event OR `$rage_click_count` | `metrics.rage` | |
| `properties.$revenue` finite | `metrics.conversion = 1` | Documented proxy; see `mapping.ts`. |
| `utm_*`, `$browser`, `$device_type`, `$referrer`, `$host` | `properties.*` | Renamed without `$`. |
| Autocapture: `$el_text`, `$el_attr__data-attr`, `tag_name` | `properties.cta_text`, `properties.cta_id`, `properties.cta_tag` | Powers `CtaConfig.match.property-equals`. |

PII guardrail: `$ip`, `$user_agent`, `email`, `name`, `phone`, raw cookies are
**never** copied across.

### 9.3 Connector API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/phase2/integrations` | Create or upsert by `(siteId, provider)`. Body: `{ siteId, provider, config, secretRef }`. |
| `GET /api/phase2/integrations` | List for the org; optional `siteId`/`provider` filters. |
| `GET /api/phase2/integrations/:id` | Fetch one. |
| `POST /api/phase2/integrations/:id/validate` | Read-only connectivity probe. Returns `{ ok, sampleEvents, recentEventTypes, warnings }`. |
| `POST /api/phase2/integrations/:id/sync` | Pull events, batch-insert with dedupe, advance cursor. Body: `{ since?, until?, maxEvents? }`. |

### 9.4 Sync semantics

- Cursor is `{ lastTimestamp, lastUuid }` persisted in `phase2_integrations.cursor`.
- On 401/403 the integration is marked `status="error"` with code
  `POSTHOG_AUTH`; cursor is preserved.
- 429/5xx are retried with exponential backoff inside the connector
  (`200ms → 800ms → 2400ms`); persistent failures surface as 502 with
  `lastErrorCode` set.
- Per-request timeout: 15s. Sync is page-atomic — partial progress is preserved
  via cursor advancement only after a page is mapped successfully.

### 9.5 Worked example

```bash
curl -X POST $BASE_URL/api/phase2/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "siteId": "site_123",
    "provider": "posthog",
    "config": { "host": "https://us.posthog.com", "projectId": "12345" },
    "secretRef": "POSTHOG_API_KEY__SITE_123"
  }'

# returns { id, ... }; export it
INTEGRATION_ID=...

curl -X POST $BASE_URL/api/phase2/integrations/$INTEGRATION_ID/validate
# { ok: true, sampleEvents: 42, recentEventTypes: ["cta_click","page_view","rage_click"], warnings: [] }

curl -X POST $BASE_URL/api/phase2/integrations/$INTEGRATION_ID/sync \
  -H "Content-Type: application/json" -d '{ "maxEvents": 1000 }'
# { fetched, inserted, deduped, skipped, errors, cursor, hasMore }
```

After sync, run `POST /api/phase2/insights/run` (§6) and findings are derived
from real PostHog data.

---

## 10. Page DNA snapshots (design audit grounding)

Behavioral data alone tells you *what* people clicked. To say *why* the
hierarchy is wrong, the audit needs a static read of the actual page —
its meta tags, heading hierarchy, CTA inventory, and visual-weight
signals. That's what page snapshots are.

### 10.1 What a snapshot captures

```
PageSnapshotData {
  schemaVersion: 1
  meta {
    title, ogTitle, ogDescription, ogImage,
    description, canonical, lang, charset,
    themeColor, viewport, robotsMeta
  }
  headings: { level: 1..6, text, documentIndex }[]
  ctas: {
    ref,                  // stable hash, safe to reference across rules
    tag: 'a' | 'button',
    text, href, ariaLabel,
    landmark,             // header | nav | main | aside | footer | dialog | unknown
    visualWeight,         // 0..1, heuristic
    visualWeightSignals,  // ['text-2xl', 'bg-primary', 'font-bold', ...]
    foldGuess,            // above | uncertain | below
    domDepth, documentIndex,
    disabled
  }[]
  forms: {
    ref, landmark, fieldCount,
    inputs: { type, name, required, labelText }[],
    hasSubmitButton
  }[]
  contentHash             // sha256 of normalized HTML — drift detector
  rawByteSize, parsedAt
}
```

Stored once per `(siteId, pathRef)`. Re-snapshotting overwrites the row;
drift across re-fetches is observable via `contentHash`.

### 10.2 Visual-weight scoring

A pure, deterministic heuristic over class hints + tag + landmark. Does
**not** render the page. Picks up Tailwind/utility tokens like
`text-2xl`, `bg-primary`, `font-bold`, `border-2`, `rounded-full`,
`px-8`, plus the tag base (button > anchor) and landmark bonus
(header/main > nav > footer). Each scoring contribution is recorded in
`visualWeightSignals`, so a downstream rule can name the literal tokens
that earned the score.

Heuristic, not measurement — paired with click-share data, it lets the
audit flag *hierarchy inversions*: the eye is drawn one place, the
clicks go another.

### 10.3 Fold guess

`foldGuess` is `'above' | 'uncertain' | 'below'`, derived from landmark
(`header` → above; `footer` → below) and the element's position among
top-level body children (first 25% → above; last 25% → below). v1 is
intentionally rough — without rendered geometry we cannot be exact, but
the signal is strong enough to power the *above-fold-coverage* rule
when combined with scroll-depth data from the connector.

### 10.4 API

```http
POST /api/phase2/sites/{siteId}/snapshots
Content-Type: application/json
x-org-id: org_*
{
  "baseUrl": "https://example.com",
  "paths":   ["/", "/pricing", "/signup"],
  "options": {                              # all optional
    "timeoutMs": 5000,                      # 1000..15000
    "userAgent": "ZybitAudit/1.0 (+...)",
    "followRedirects": 5,                   # 0..10
    "respectRobots": true,
    "maxBytes": 1500000                     # 10_000..5_000_000
  }
}
→ 200 {
  data: {
    siteId,
    report: {
      total, succeeded, failed,
      results: [{ path, pathRef, url, status: 'ok'|'error',
                  snapshotId? , errorCode? , errorMessage? }]
    }
  }
}
```

- Up to **10 paths per request** (cap; expand once cron orchestration
  lands).
- Per-path failures are **non-fatal** — the run continues; failures are
  reported with structured `errorCode` (`TIMEOUT`, `NON_HTML`,
  `STATUS_4XX`, `STATUS_5XX`, `BLOCKED_BY_ROBOTS`, `TOO_LARGE`,
  `INVALID_URL`, `PARSE_ERROR`, `NETWORK_ERROR`).
- Best-effort `robots.txt` check, max 5 redirects, 1.5MB body cap, 5s
  default fetch timeout.

```http
GET  /api/phase2/sites/{siteId}/snapshots
GET  /api/phase2/sites/{siteId}/snapshots?pathRef=/pricing
```

The list variant returns the latest snapshot per `pathRef`, ordered by
`fetchedAt desc`. The single variant returns one snapshot or `null`.

### 10.5 Where snapshots fit

```
PostHog events  ──┐
                  ├──►  Phase 2 rules ──►  designer-voiced findings
Page snapshots  ──┘
```

Layer A (this PR) ships the snapshot subsystem. Layer B (next PR)
extends the PostHog connector to extract richer event metadata
(`elements_chain` ancestry, `device_type`, `referrer`, `scroll_pct`,
rage targets). Layer C wires both into a new design-rules module that
produces findings like *hero-hierarchy-inversion* and
*above-fold-coverage* — naming the actual H1, the actual button, the
actual class signals.

---

## 11. PostHog mapping depth (extended properties)

Layer A grounded the audit in *what the page is*. Layer B grounds it in
*what PostHog actually saw* — the full `elements_chain` ancestry, device
type, scroll fraction, rage-click target, session-replay handle. The
mapping is still pure (no I/O, no clocks); just richer.

### 11.1 Properties added to canonical events

| Source on PostHog event | Canonical destination | Notes |
|---|---|---|
| `properties.$elements_chain` (or `$elements_chain_chain`) | `properties.element_tag`, `element_classes`, `element_role`, `element_landmark_distance`, `element_depth` | Full ancestry parse via `connectors/posthog/elementsChain.ts`. `element_role` = nearest landmark walking from leaf up (`header` \| `nav` \| `main` \| `aside` \| `footer` \| `dialog` \| `null`). `element_classes` = up to 5 leaf class tokens, space-joined. |
| `properties.$active_seconds` | `metrics.activeSeconds`; `properties.dwell_seconds` | Engaged time (PostHog's tracker). Distinct from `metrics.dwellMs` which is wall-time on page. Clamped 0..86_400. |
| `properties.$scroll_percentage` | `metrics.scrollPct` (0..100) **and** `metrics.scrollPctNormalized` (0..1) | Both kept; rules read whichever they prefer. |
| `properties.$session_recording_id` | `properties.recording_id` | Stable handle for downstream replay attach. |
| `properties.$feature_flag` + `$feature_flag_response` | `properties.flag_<key>` | Single-flag exposure. |
| `properties.$feature_flags` (object) | `properties.flag_<key>` (per entry) | Capped at 10 entries; only `string`/`boolean`/finite-number values. |
| `$rageclick` event + leaf | `properties.rage_target_text`, `rage_target_ref` | `rage_target_text` falls back through `$el_text` → first class → aria-label → tag. `rage_target_ref` = sha256 (16 chars) of the leaf signature so multiple sessions can be grouped. |

`elements_chain` parsing is bracket- and escape-aware (handles
`[data-cta="value"]`, `\"` and `\\` escapes, ignores `:nth-child(...)`
pseudos, treats ARIA `role` of `banner`/`navigation`/`complementary`/
`contentinfo` as semantic landmarks). Capped at 50 nodes per chain.

PII guardrails are unchanged: the mapper still never copies `$ip`,
`$user_agent`, `email`, `name`, `phone`, raw cookies, or unknown
property blobs.

---

## 12. Design rules (designer-voiced findings)

Snapshots tell us what the page is. Events tell us what users did. The
**design rules** (Layer C, `zybit/src/lib/phase2/rules/`) read both and
emit findings that name *the actual element* — not "promote A over B"
but "the most-clicked CTA on `/pricing` is `Start free trial` (38%
share); the visually heaviest one is `Book demo` (signals: text-2xl,
bg-primary, font-bold). Drop bg-primary or move trial into the hero."

### 12.1 Rule contract

```ts
interface AuditRule {
  id: string;
  category:
    // Design-shaped
    | 'hierarchy' | 'fold' | 'nav' | 'mismatch'
    // Pain-shaped
    | 'rage' | 'asymmetry' | 'abandonment' | 'help'
    | 'hesitation' | 'bounce' | 'error' | 'thrash'
    // Flow-shaped
    | 'flow'
    // Structural — Layer E
    | 'structural';
  evaluate(ctx: AuditRuleContext): AuditFinding[];
  proposeAnnotations?(finding: AuditFinding, ctx: AuditRuleContext): PreviewAnnotation[];
}

interface AuditFinding {
  id;          // stable, e.g. 'hero-hierarchy-inversion:/pricing'
  ruleId; category; severity;       // 'info' | 'warn' | 'critical'
  confidence;  priorityScore;       // both 0..1
  pathRef;     // page or null for site-wide
  title;  summary;
  recommendation: string[];          // 1-2 designer/researcher-voiced paragraphs
  evidence: { label, value, context? }[];
  refs?: { snapshotId?; ctaRef?; elementRef?; formRef?; };
}
```

Rules are pure, deterministic, and own their own minimum-sample
thresholds — they return `[]` rather than firing on shaky data.

`proposeAnnotations` is the preview-anchoring contract. Each
finding-bearing rule (9 of the 19) anchors its annotations to the
literal element its prescription names: `return-visit-thrash` places a
quick-answer placeholder above the hero; `help-seeking-spike` anchors
an inline FAQ above the primary CTA; `hesitation-pattern` adds a proof
line above the CTA; `above-fold-coverage` shows the duplicate-CTA
placement; `bounce-on-key-page` captions the first heading. The
contract is "anchor to what the prescription says", not "outline the
primary CTA".

#### Annotation helpers (`src/lib/phase2/rules/annotationHelpers.ts`)

Pure helpers shared by every `proposeAnnotations` implementation:

| Helper | Purpose |
|---|---|
| `missingPlaceholder(kind, selector)` | Synthesize a placeholder node when the prescription proposes inserting new content (quick-answer block, inline FAQ). |
| `annotationCaption(rule, prescription)` | Deterministic preview caption voiced from the prescription text. |
| `outlineMod({ selector, mode })` | Outline-only annotation for "look here" anchors without DOM mutation. |
| `snapshotHeadingSelector(snapshot, level, index)` | Resolve a stable selector for the nth heading at a given level. |
| `nthOfTypeIndex(snapshot, ref)` | Compute the `:nth-of-type` index needed to disambiguate repeated tags. |

> **Rename note (Layer D):** `DesignFinding`, `DesignRule`,
> `DesignRuleContext`, `runDesignRules`, `ALL_DESIGN_RULES` and the
> response field `designReport` were renamed to their `Audit*` /
> `auditReport` equivalents in this PR. The semantics are unchanged;
> the new naming captures the broader scope (design **and** pain).

### 12.2 Audit rules shipping in v1

Total: **19 rules** — 5 design + 7 pain + 1 flow + 6 structural (Layer E).

Design rules (5):

| Rule id | Trigger | Recommendation voice |
|---|---|---|
| `hero-hierarchy-inversion` | Most-clicked CTA on a page ≠ visually heaviest CTA on the same page (≥ 30 clicks/window) | *"Most-clicked CTA is `Start free trial` (38% / 1,420 clicks). Visually heaviest is `Book demo` (signals: text-2xl, bg-primary, font-bold). The eye should land where the value lands. Drop bg-primary on `Book demo` or promote `Start free trial` into the same header position."* |
| `above-fold-coverage` | A non-above-fold CTA has visualWeight > 0.4 AND > 50% of pageviews scroll < 40% | *"`Get started` sits inside the main landmark with foldGuess=below. 62% of pageviews never scroll past 40%. Most visitors never see the ask. Move it into the hero or duplicate above the fold."* |
| `rage-click-target` | ≥ 5 rage clicks on one target on one page AND ≥ 5% of sessions on that page rage-clicked it | *"`Read more` rage-clicked 23 times — that's 7% of sessions on `/faq`. The element looks clickable but probably isn't responding. If meant to expand, rebuild as an accordion; if meant to navigate, fix the handler."* |
| `mobile-engagement-asymmetry` | An onboarding step's mobile completion rate trails desktop by > 15 percentage points (≥ 50 mobile starts) | *"Mobile users complete `Verify email` at 18% vs 41% on desktop — a 23-point gap across 1,240 mobile starts. Touch targets and layout likely break at small viewports."* |
| `nav-dispersion` | Site-wide nav clicks: ≥ 50 clicks across ≥ 6 destinations with Gini < 0.3 | *"1,820 nav clicks across 9 destinations with Gini 0.18. Click distribution is essentially uniform — the IA isn't telling visitors where to start. Demote 5 entries into a secondary menu."* |

### 12.3 Impact estimate output shape

`impactEstimate` (in `src/lib/phase2/rules/impactEstimate.ts`) attaches a deterministic, configurable estimate to each finding. For revenue and ecommerce `goalType`s the output is now **conversion counts** (`~N conversions/month`), not currency amounts. Dollar figures were removed because most sites have not configured ARPU and synthetic dollar amounts were misleading PMs. Findings still carry a numeric `expectedLiftPct` and a confidence interval — only the formatted label changed.

### 12.4 Output

`POST /api/phase2/insights/run` now returns an `auditReport` field
(formerly `designReport` — see rename note above):

```jsonc
{
  "siteId": "...",
  "findings": [...],          // existing Phase 1 statistical findings
  "auditReport": {
    "findings": [...],        // AuditFinding[] sorted by priority×severity×confidence
    "diagnostics": [          // why each rule did/didn't fire
      { "ruleId": "hero-hierarchy-inversion", "emitted": 2 },
      { "ruleId": "above-fold-coverage", "emitted": 0, "skippedReason": "NO_SCROLL_DATA" }
    ],
    "groundedInSnapshots": true
  }
}
```

Audit findings are in addition to Phase 1 findings, not in place of
them. They are deliberately *designer- / researcher-voiced* — naming
elements, quoting class signals, citing share/click counts, quoting
actual error messages and form field labels — so the audit reads like a
critique instead of a dashboard.

### 12.5 Deferred design rules (future)

- `landing-promise-mismatch` — campaign tokens vs page H1/OG tokens
- `cta-form-mismatch` — high-intent CTA leading into long form
- `headline-collision` — multiple H1-equivalent visual weights
- `sticky-affordance-suggestion` — high-intent CTA available only above-fold

---

## 13. PostHog mapping addendum: `$exception`

To unlock the `error-exposure` rule (§14), the PostHog connector now
canonicalizes `$exception` events to type `'error'` and extracts the
following on the canonical event's `properties`:

| Source | Destination | Notes |
|---|---|---|
| `$exception_type` | `error_type` | Capped at 200 chars |
| `$exception_message` | `error_message` | Capped at 500 chars; first 120 used in finding summaries |
| `$exception_source` | `error_source` | Capped at 200 chars |
| `$exception_lineno` | `error_line` | Floored, `≥ 0` |
| `$exception_colno` | `error_column` | Floored, `≥ 0` |
| `$exception_handled` | `error_handled` | Boolean only; missing means unknown (treated as unhandled in audit) |

`$exception_personURL`, raw stack traces, and breadcrumb dumps are
intentionally *not* copied — they tend to carry user/session ids and
aren't needed for grouping (which keys on type + message + path).

---

## 14. Pain rules (user-pain audit)

Pain rules complement design rules with patterns that signal *user
friction* — abandonment, hesitation, errors, thrashing. They share the
`AuditRule` contract; the difference is the signal mix they read
(sessions, error events, form-page traffic) rather than snapshot
geometry.

### 14.1 Rules shipping in v1

| Rule id | Category | Trigger | Recommendation voice |
|---|---|---|---|
| `form-abandonment` | `abandonment` | Form has ≥ 2 fields; ≥ 100 sessions view its page; submit rate < 50% | *"Visitors view the 6-field form on `/signup` 2,140 times in the window but submit only 312 times — 85% abandonment. Required fields visible: `email`, `phone_number`, `company_size`. Audit each — `phone_number` and `company_size` look optional in the UI but block submission. Either drop them or move to a second step after the user is invested."* |
| `help-seeking-spike` | `help` | On a non-help page, help-CTA share ≥ 5% AND ≥ 2× site baseline; ≥ 50 page CTAs and ≥ 200 site CTAs | *"On `/pricing`, 9% of CTA clicks are help-seeking — 3.2× the site baseline of 2.8%. Visitors are on this page but reaching for help instead of acting. Inline the most-asked support questions as a FAQ accordion below the fold; quote the actual help-CTA labels visitors clicked: `Talk to sales`, `Need help?`."* |
| `hesitation-pattern` | `hesitation` | ≥ 30 sessions with `active_seconds ≥ 45` on the page where the next event is session-end or back-navigation (no following CTA click) | *"On `/pricing`, 412 sessions held the page in active view for ≥ 45s without acting — 71% of long-dwell sessions either left or back-navigated. Long active dwell with no follow-up is value-clarity friction. The page hands the visitor information but not a reason to commit."* |
| `bounce-on-key-page` | `bounce` | Landing path is a key page (config-declared OR snapshot CTA visualWeight > 0.6); single-page session with no CTA click; ≥ 100 entries; bounce rate > 50% | *"3,210 sessions land on `/` and 64% leave without clicking anything — a key page that costs visitors more than it gives. The most prominent CTA is `Start free trial` (visual weight 0.83). Audit hero copy, CTA prominence, and load performance — visitors should see something they want within 1.5 seconds."* |
| `error-exposure` | `error` | ≥ 5 `$exception` events on a `(path, error_type, error_message)` triple in the window; top 10 groups | *"`TypeError: Cannot read property 'id' of undefined` (unhandled) at `pricing.tsx:142:14` — 87 occurrences on `/pricing`, affecting 16% of sessions on the page. `/pricing` is referenced in your conversion funnel (config-declared CTA target). Bumping this fix above feature work is correct."* |
| `return-visit-thrash` | `thrash` | Same path visited 3+ times in one session AND no advancement to a config-declared narrative-next path between visits (or 4+ with no other path between visits when no narrative is declared); ≥ 50 sessions on path; > 5% thrash rate | *"94 sessions visit `/docs/api` 3+ times without progressing — 11% of sessions that touch this page get caught in a loop. They're searching for something the page doesn't surface clearly."* |
| `cohort-pain-asymmetry` | `asymmetry` | For each declared cohort dimension, top cohort's rage rate (events/session) ≥ 2× site median across cohorts AND ≥ 0.05 events/session; ≥ 50 sessions per cohort | *"On dimension `device`, the cohort `mobile` shows 0.42 rage-clicks per session — 3.5× the site median (0.12). 1,860 sessions in this cohort. Reference cohort: `desktop` (0.10 rage/sess). Mobile users are hitting friction the rest of the audience isn't."* |

All seven rules survive a strict-trigger necessity test:

- **`form-abandonment`** fires only on real form views, not transient visits.
- **`help-seeking-spike`** excludes help/docs/FAQ pages from being subjects of the rule, so a docs site doesn't trip on itself.
- **`hesitation-pattern`** anchors on **leave or back-nav** to discriminate "reading" from "stuck".
- **`bounce-on-key-page`** restricts to config-declared key pages or high-visual-weight CTAs to avoid noise on incidental landings.
- **`error-exposure`** caps at the top 10 groups so a broken site doesn't flood the report.
- **`return-visit-thrash`** uses narrative-aware progression detection; pages with no narrative use a stricter 4+/no-other-path trigger.
- **`cohort-pain-asymmetry`** uses a numeric **median** (not mean) and excludes the dimension's fallback bucket.

### 14.2 Shared helpers (`rules/helpers.ts`)

Three new helpers underpin the pain rules:

- `groupSessions(events)` — order events by `occurredAt`, bucket by
  `sessionId`. Returns `SessionTrace { sessionId, events, paths,
  pathCounts, firstAtMs, lastAtMs, durationMs }`. Filters out the
  fallback `'unknown_session'` so strangers aren't lumped together.
- `assignSessionCohort(session, dim)` — resolve a session's cohort
  label for one declared `CohortDimensionConfig`. Mirrors the rollup
  pipeline's per-event assignment but at session granularity.
- `siteBaselineRate(events, matches, totalPredicate?)` — site-wide
  rate, used by `help-seeking-spike` for the comparison.
- `isKeyPath(pathRef, config, snapshot?)` — true if the path is
  referenced in onboarding steps, narratives, declared CTAs, or has a
  high-visualWeight (> 0.6) CTA on its snapshot. Used by
  `bounce-on-key-page` and `error-exposure`.

### 14.3 Where pain rules fit

```
PostHog events  ──┐
                  ├──►  Audit rules ──►  AuditFinding[]
Page snapshots  ──┘                       (design + pain)
```

Pain rules read `AuditRuleContext` exactly like design rules; the
orchestrator (`runAuditRules`) doesn't distinguish flavors. The output
shape is one unified list, sorted by `priorityScore` then `severity`
then `confidence`.

---

## 15. Structural rules — Layer E (snapshot-only)

Layer E rules read only `ctx.pageSnapshotsByPath`. They ignore
behavioral events entirely, which means they fire on any site that
has page snapshots — even with zero events ingested. This is the
activation surface for the public URL-audit lead magnet and for new
sites still in connector setup.

| Rule id | Trigger |
|---|---|
| `heading-hierarchy-jump` | Headings skip levels (e.g., `h1` → `h3`). |
| `form-label-missing` | Form input has no associated `<label>` and no `aria-label`. |
| `image-alt-text-missing` | `<img>` has no `alt` attribute and no `aria-label`. |
| `link-text-generic` | Anchor text matches frequency-only generic patterns (`Learn more`, `Click here`, `Read more`, `Get started`, etc.). |
| `missing-meta-description` | `<head>` lacks `<meta name="description">`. |
| `missing-canonical-url` | `<head>` lacks `<link rel="canonical">`. |

Behavioral (event-based) rules are frozen at 12 (5 design + 7 pain).
New rules must follow the Layer E pattern: deterministic, snapshot-
grounded, no LLM calls, no invented numbers.

---

## 16. Variant modification types

`VariantModification` (`src/lib/experiments/types.ts`) supports **7
modification types**:

| Type | Purpose |
|---|---|
| `text-replace` | Replace the text content of an element. |
| `attribute-set` | Set or update an attribute on an element (allowlisted attribute names). |
| `css-inject` | Inject a `<style>` block scoped to the page. |
| `style-swap` | Add/remove class tokens on an element. |
| `element-hide` | Hide an element. |
| `element-reorder` | Reorder siblings within a parent. |
| `element-insert` | Splice new HTML next to an anchor; `insertPosition` ∈ `'before' \| 'after' \| 'prepend' \| 'append'`. |

`element-insert` payloads pass through
`src/lib/experiments/sanitizeInsertHtml.ts` — a tag + attribute
allowlist that drops `<script>`, `<iframe>`, and `<form>`, strips
`on*` handlers, rejects `javascript:` and `data:` URLs, fails closed
on parse error, and enforces a max input size cap. The sanitizer
runs at both the brief-validation and runtime-modifier boundaries.

---

## 17. Out of scope for Phase 2 (deferred)

- Other providers (Shopify Admin, Segment write-key receiver, GA4 BigQuery
  export). They reuse the same `Phase2Connector`-shaped path.
- Cron orchestration (Vercel Cron → `/api/phase2/integrations/:id/sync`
  + `/api/phase2/sites/:siteId/snapshots`).
- Identity stitching beyond the `anonymousId` carrier field.
- Headless-render snapshots (JS-rendered SPAs). v1 is HTML-only.
- LLM-narrated finding prose (current templates produce specific,
  designer- / researcher-voiced findings deterministically).
- Multi-signal `cohort-pain-asymmetry` (rage + bounce + abandonment
  blend). v1 uses rage-rate alone.
- Outcome/experiment loop (Phase 3).

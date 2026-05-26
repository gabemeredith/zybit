# Zybit — Audit Engine Handover

**Branch:** `feat/audit-rules-fired-industry`
**Prepared:** 2026-05-26 (original) · **Revised:** 2026-05-26
**Purpose:** Engineering handover for the developer picking up the audit engine after this session. Covers what shipped, what needs to come next to make the audit endpoint fully defensible, and the full roadmap for the premium interactive visualization.

> **Revision note (2026-05-26).** The original handover was written
> assuming PRs #76–79 were still in flight and migration `0016` was the
> next slot. Both turned out wrong; see inline `Status:` lines on each
> section. Sections 3c, 3d are shipped on this branch (commits `6ca4084`
> and `6ec19e7`). Section 4's merge sequence is **obsolete** — all
> referenced PRs merged 2026-05-26; PRs #80/#81/#82 also merged. The 6
> Layer E structural rules and migration `0022` (the work the original
> handover describes as "this session") shipped via PR #80.

---

## 1. What shipped this session

### A — Dollar figures removed from impact estimates

`impactEstimate.ts` no longer emits currency. `revenue` and `ecommerce` goal types now return:

```
unit: 'conversions'
formatted: '~N conversions/month'   (k notation above 1000)
value: Math.round(affectedMonthly × baselineConversionRate)
```

`formatCurrency` was deleted entirely. The `goalConfig.arpu` and `goalConfig.aov` fields are still accepted (they were on existing DB rows) but silently ignored. 16 tests updated; all pass.

**Why:** Revenue projections from behavioral inference are fabricated numbers. PMs can defend "150 affected sessions/month"; they cannot defend "$7,234/month" in a meeting when the number was inferred from site traffic patterns. Conversion counts are honest.

### B — Snapshot extended with image inventory

`PageSnapshotData.images` is now an optional `ImageItem[]` populated by `findImages()` in `parser.ts`. Each item carries:

```typescript
{ src, alt, hasAlt, width, height, isCtaChild, documentIndex }
```

`MAX_IMAGES = 200` cap prevents DoS on image-heavy pages. New Layer E rules that need image data consume `snapshot.data.images ?? []`.

### C — User profile schema + rules-fired join table (migration 0016)

Two changes to the DB:

**`app_users` extended:**
```
industry        text          -- e.g. 'SaaS', 'ecommerce', 'fintech'
role_title      text          -- PM job title from onboarding
last_audit_at   timestamptz   -- set each time the insights pipeline runs for their org
-- Acquisition source lives on app_users.source (added by the audit-funnel migration).
-- Do not duplicate as signup_source here.
```

**New table `app_user_rules_fired`:**
Tracks which rules fired for which user/org/site across all audits. Powers the "What rules ran against your product" analytics and downstream industry-level benchmarking.

```sql
id, user_id, org_id, site_id, finding_id, rule_id, fired_at, created_at
```

Four single-column indexes: `(user_id)`, `(rule_id)`, `(org_id)`, `(site_id)`. No `(finding_id)` index — queries filtering by `finding_id` will table-scan; add an index alongside the first real query path when that's built.

**To apply:** Run `npx drizzle-kit migrate` against Neon. The migration file landed as `drizzle/0022_user_profile_and_audit_tracking.sql` (renumbered when sibling PRs landed first) — **already applied to Neon** per `docs/sprints/REMEDIATION.md`.

### D — Six new structural/SEO/accessibility rules (Layer E)

All deterministic, snapshot-only (no behavioral events required). These fire on static HTML structure — no analytics connector needed.

| Rule | Category | Confidence | What it detects |
|------|----------|-----------|-----------------|
| `headingHierarchyJump` | seo | 0.92 | Heading level jumps > 1 (H1→H3, H2→H4) without intervening levels |
| `formLabelMissing` | accessibility | 0.90 | Form inputs without associated `<label>`, `aria-label`, or `aria-labelledby` |
| `imageAltTextMissing` | accessibility | 0.93 | `<img>` elements missing or empty `alt` attribute (excluding decorative `alt=""`) |
| `linkTextGeneric` | accessibility | 0.88 | `<a>` tags with link text "click here", "read more", "learn more", "here", "link" |
| `missingMetaDescription` | seo | 0.95 | Page has no `<meta name="description">` or it is empty |
| `missingCanonicalUrl` | seo | 0.90 | Page has no `<link rel="canonical">` |

All 6 rules are registered in `rules/index.ts` under `ALL_AUDIT_RULES`. Test coverage in `__tests__/structuralRules.test.ts` (~30 cases).

**Rule budget:** Behavioral rules remain frozen at 12 (7 pain + 5 design). Structural rules are at 6 and can grow further if deterministic + snapshot-grounded. With the 1 flow rule (`flowInterStepDropoff`) the registered total in `ALL_AUDIT_RULES` is **19**, not 18 as initially written.

### E — Doctrine updated

Three docs updated to reflect the new rule count and $ removal:
- `AGENTS.md` — rule count, build state table, "never build" clarification
- `DOCTRINE.md` — rule count, "where we are today", doctrine section
- `docs/ARCHITECTURE.md` — rule section, test count (193 → 545)

---

## 2. Current audit pipeline state

```
HTTP request to /api/phase2/insights/run
        │
        ▼
runInsightsPipeline(siteId, orgId)
        │
        ├─ fetchSnapshot(url)                    ← HTTP fetch + DOM parse (static sites only)
        │   └─ parseSnapshot()                   ← extracts ctas, headings, forms, meta, images
        │
        ├─ pullLatestEvents(siteId)              ← PostHog / Segment / GA4
        │
        ├─ buildInsightInput(snapshot, events)   ← aggregates into InsightInput
        │
        ├─ computeRuleCalibrations(siteId)       ← Layer 2: per-rule floor multipliers from past outcomes
        │
        ├─ runAllRules(input, calibrations)      ← 18 rules, each a pure function
        │   ├─ Layer C: 5 design rules           ← behavioral + snapshot
        │   ├─ Layer D: 7 pain rules             ← behavioral only
        │   └─ Layer E: 6 structural rules       ← snapshot only
        │
        ├─ generatePrescriptions(findings)       ← ranked findings with A/B prescriptions
        │
        ├─ applyLearnRerank(findings, siteId)    ← Layer 1: re-rank by past outcomes
        │
        └─ persistFindings(findings, siteId)     ← upsert to DB
```

**What works end-to-end:** Static HTML pages, PostHog/Segment/GA4 events, all 19 rules, outcome feedback loop (Layers 1+2), PM dashboard rendering.

**What doesn't work yet:**
- JS-rendered/SPA pages: ~~`browserFetcher.ts` fallback is a stub.~~ **Update 2026-05-26:** Browserless is wired and was live-verified 2026-05-22 against a real SPA (`snapshotMethod: 'browser'` records returned). Production needs `BROWSERLESS_KEY` set in Vercel.
- ~~Rules-fired write-through~~ **Shipped 2026-05-26** in the public-audit funnel — see commit `6ca4084`. The dashboard `runPhase2InsightsPipeline` path is deliberately not wired because `app_user_rules_fired.user_id` is `NOT NULL` and the in-app pipeline is org-scoped with multi-user ambiguity.
- ~~Industry auto-detection~~ **Shipped 2026-05-26** as `deriveIndustry()` (host > subdomain > path > page-copy cascade), wired into the public-audit `done` UPDATE.

---

## 3. Making the audit endpoint fully defensible — next steps

### 3a. PageDNA capture

> **Status (2026-05-26):** partially shipped. The design-snapshot table
> (`phase2_site_design_snapshot`, migration `0016`) and the full-fidelity
> capture writer (`buildFullDesignSnapshot` via Browserless) landed in
> PR #58. Design-token extraction (`extractDesignTokens`, `tokenExtractor.ts`)
> and the AI Variant Advisor API that consumes it landed in PR #66. So
> the "computed styles / design tokens" half of this section is done.
> Remaining items below (color contrast, viewport probes, weight signals)
> are still real gaps.

The snapshot parser currently extracts a subset of page data. The vision is a "PageDNA" — a lossless fingerprint of a page that makes every rule deterministic and every finding reproducible.

**What to add to `parseSnapshot()`:**

| Signal | Where to read | Why |
|--------|---------------|-----|
| Computed styles (font, color, spacing) | Requires Browserless (CSS-in-JS, Tailwind JIT) | Enables design-token drift rules |
| Full copy inventory | Already partially done via `textContent` | Complete extraction: H1-H6, all body paragraphs, button labels, meta content, OG tags |
| Inline `<script>` + third-party scripts | Script tags, `src` attributes | Detects analytics gaps, tracking bloat |
| Color contrast ratios | Computed from text/background CSS | Enables WCAG AA contrast rule |
| Font stack + load method | `@font-face`, `link[rel=preload]` | Detects FOUT/CLS risk |
| Page weight signals | `<img>` sizes + count, `<video>` presence | Detects LCP candidates |
| Viewport/mobile signals | `<meta name="viewport">`, media queries | Mobile conversion risk |
| Social/share metadata | OG tags, Twitter card | SEO completeness |
| Form complexity score | Input count, required count, field types | Form friction score |
| CTA inventory completeness | All clickable elements, not just primary CTAs | Comprehensive CTA coverage |

**Implementation path:**

1. Extend `PageSnapshotData` in `snapshots/types.ts` with new optional fields
2. Add extractors to `parser.ts` (static HTML extractors first, no Browserless dependency)
3. Write new rules that consume the new signals
4. For computed styles: add `browserFetcher.ts` CDP session that dumps `window.getComputedStyle()` for key elements after JS execution

### 3b. SPA support (Browserless)

> **Status (2026-05-26):** shipped. `browserFetcher.ts` is wired and was
> live-verified 2026-05-22 — a client-rendered SPA that returned an empty
> HTTP shell rendered fully via Browserless. The snapshot records
> `snapshotMethod: 'browser'` so downstream code can branch. Production
> needs `BROWSERLESS_KEY` set in Vercel. The example sketch below was
> the stub-era plan; the real implementation matches its shape.

This is the biggest gap. JS-rendered pages (React, Vue, Angular) return an empty shell on HTTP fetch.

**The path:**

```typescript
// browserFetcher.ts (currently a stub)
async function fetchWithBrowser(url: string): Promise<string> {
  const ws = await connect({ browserWSEndpoint: process.env.BROWSERLESS_WS_URL });
  const page = await ws.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });
  const html = await page.content();
  await ws.close();
  return html;
}
```

Environment variable needed: `BROWSERLESS_WS_URL` — already in the third-party-where-it's-better doctrine.

**Detection trigger:** `snapshotMethod === 'spa'` flag on `PageSnapshotData`. Already tracked in the schema, just not acted on in the rules yet.

### 3c. Industry auto-detection

> **Status (2026-05-26):** shipped on this branch in commit `6ca4084`.
> `src/lib/audit/deriveIndustry.ts` runs the host > subdomain > path >
> page-copy cascade and is called from `/api/audit/public/run` after the
> audit's `done` UPDATE, via `recordAuditUserActivity()`. Only writes
> when the column is currently NULL — never overwrites an explicit
> classification. The dashboard pipeline is *not* wired (see 3d).

`app_users.industry` should be populated automatically when an audit runs, without asking the PM.

**Two signals available:**

1. **URL pattern matching**: `shopify.com` → ecommerce, `app.salesforce.com` → SaaS, `checkout` in path → ecommerce checkout flow
2. **Structural content**: meta description, H1, `<title>` — classify via deterministic keyword matching (no LLM)

```typescript
function deriveIndustry(snapshot: PageSnapshotData): Industry | null {
  const signals = [
    snapshot.data.meta.description ?? '',
    snapshot.data.headings?.[0]?.text ?? '',
    snapshot.data.url,
  ].join(' ').toLowerCase();
  
  if (/shop|cart|checkout|product|price|buy|order/.test(signals)) return 'ecommerce';
  if (/saas|software|platform|api|dashboard|workspace/.test(signals)) return 'saas';
  if (/bank|invest|finance|loan|mortgage|trading/.test(signals)) return 'fintech';
  if (/health|patient|clinic|doctor|medical|pharmacy/.test(signals)) return 'healthtech';
  return null;
}
```

**Write-through point:** At the end of `runInsightsPipeline()`, after findings are persisted, update `app_users.industry` if currently null.

### 3d. Rules-fired write-through

`app_user_rules_fired` has the table and indexes. Nothing writes to it.

**The write-through should happen in `runInsightsPipeline()`** after `persistFindings()`:

```typescript
// After findings are persisted, record which rules fired
const ruleFiredRows = findings.map(f => ({
  id: generateId(),
  userId: context.userId,
  orgId: context.orgId,
  siteId: context.siteId,
  findingId: f.id,
  ruleId: f.ruleId,
  firedAt: new Date(),
}));
await db.insert(appUserRulesFired).values(ruleFiredRows).onConflictDoNothing();
```

Also update `app_users.last_audit_at = now()` at this point.

### 3e. Rule coverage gaps (rules to add next)

The 18 existing rules leave several high-value gaps. All of these are snapshot-grounded and deterministic:

| Rule name | Signals needed | Priority |
|-----------|---------------|----------|
| `colorContrastInsufficient` | Computed styles (Browserless) | High — WCAG AA is a real conversion barrier |
| `ctaAboveFoldMissing` | CTA inventory + viewport | High — already have above-fold rule; expand to "zero primary CTAs above fold" |
| `formFieldCountExcessive` | Form complexity from snapshot | Medium — 5+ fields on initial view correlates with drop-off |
| `mobileTapTargetSmall` | Rendered element size (Browserless) | Medium — mobile CRO |
| `largeUncompressedImages` | `<img>` width/height vs natural size | Medium — LCP impact |
| `noSocialProof` | Keyword scan for testimonial/review patterns | Medium — trust signal absence |
| `redirectChain` | HTTP response headers | Low — SEO + speed |
| `missingStructuredData` | `<script type="application/ld+json">` | Low — rich snippets |

### 3f. Snapshot freshness and re-audit cron

The `refresh-snapshots` cron (daily 03:00 UTC) re-fetches snapshots. When a snapshot changes significantly:

1. Re-run the full rules pipeline against the new snapshot
2. If a finding that was previously dismissed now re-fires, surface it as new
3. Update `app_users.last_audit_at`

This is already architecturally correct (the cron exists, the drift detection exists). The gap is that drift detection currently only compares `contentHash` — it doesn't trigger a rule re-run.

---

## 4. PR merge sequence — DONE

**Status (2026-05-26 revision):** All PRs in the original merge-sequence
plan landed on `main` earlier today. The merge-train cleanup commit is
`785b62d`. Concretely: **#73–#82 merged**, plus follow-up sanitizer/validator
fixes on #82 and #83. Migration numbering settled at `0022_*.sql`. There
is no longer a sequencing constraint blocking new feature work — the only
open PR is **#84** (this branch).

PR #84 status: **paused, draft, do-not-merge** while the bug list below
clears. The advisor + brand-DNA work (3c, 3d, AI Variant Advisor UI) is
all on this branch. See §10 below for the per-bug status.

---

## 5. Premium interactive visualization — full architecture

This is the ambitious goal: a PM opens Zybit, sees their actual live site rendered in a browser-like view, with the problem areas highlighted. They click a highlight, read what's wrong and why, click "Preview this fix", and see the page with the change applied — all without deploying anything.

### 5a. Architecture overview

```
/app/sites/[siteId]/audit
        │
        ├─ AuditCanvas.tsx                    ← full-width iframe rendering site URL
        │   └─ postMessage bridge             ← parent ↔ iframe communication
        │
        ├─ FindingOverlayLayer.tsx            ← SVG/absolute-positioned highlights
        │   └─ FindingBadge.tsx              ← colored ring around affected element
        │
        ├─ FindingPopup.tsx                   ← slides in from right on badge click
        │   ├─ EvidenceSummary               ← what the rule found, signal description
        │   ├─ PrescriptionSummary           ← what to change and why
        │   └─ PreviewChangeButton           ← triggers mutation preview
        │
        └─ MutationPreviewPane.tsx            ← applies variant to iframe via clientMutatorScript
```

### 5b. iframe rendering + element coordinates

The iframe loads the target site URL (proxied through Zybit to inject the `clientMutatorScript`). The parent page needs the bounding rect of each finding's affected element to render the highlight ring.

**The coordinate extraction problem:** An iframe can't directly expose DOM rects to the parent due to cross-origin restrictions if the site isn't on the same origin. Two solutions:

1. **Same-origin proxy route** (preferred): Load the site through `/api/proxy/preview/[siteId]?url=...` which serves the page under the Zybit origin. Now same-origin, `contentWindow.document.querySelector(selector).getBoundingClientRect()` works.

2. **postMessage from injected script** (fallback): `clientMutatorScript.ts` can call `getBoundingClientRect()` on each finding's selector and `postMessage` the rects to the parent window.

The proxy preview route already exists at `api/preview/[experimentId]`. Generalize it to work without an experiment (raw selector mode).

### 5c. Finding highlights

Each finding has a `selector` (CSS) or `targetPath` (XPath) pointing to the affected element. The highlight layer:

```typescript
interface FindingHighlight {
  findingId: string;
  selector: string;
  rect: DOMRect;               // from iframe via postMessage
  severity: 'critical' | 'warn' | 'info';
  category: AuditFindingCategory;
}
```

Highlight rendering: absolutely-positioned `<div>` with `pointer-events: none`, colored border ring (`critical` = red, `warn` = amber, `info` = blue), slight background tint. On hover, opacity increases. On click, opens popup.

**Color coding by category:**
- `design` → purple
- `pain` → red  
- `accessibility` → blue
- `seo` → green

### 5d. Finding popup

Slides in from the right (or bottom on mobile) when a badge is clicked. Contains:

```
┌─────────────────────────────────────────────┐
│  [category badge]  Finding title            │
│  ─────────────────────────────────────────  │
│  Evidence                                   │
│  "47% of users who reach /pricing abandon   │
│   without clicking any CTA — rage-click     │
│   signal on the primary button (0.6×)"      │
│  ─────────────────────────────────────────  │
│  What to change                             │
│  "Replace generic 'Submit' button text      │
│   with action-specific copy, e.g.           │
│   'Start my free trial'"                    │
│  ─────────────────────────────────────────  │
│  [Preview this fix]   [Add to backlog]      │
└─────────────────────────────────────────────┘
```

The popup is already partially implemented in `AnnotatedFindingPreview.tsx` from PR #78/#79 — that work should be pulled forward and wired to the highlight layer.

### 5e. Live mutation preview

"Preview this fix" triggers `clientMutatorScript.ts` to apply the variant modification to the live iframe. This lets the PM see the change without deploying it.

**The flow:**

1. PM clicks "Preview this fix"
2. Parent posts `{ type: 'APPLY_MUTATION', modification: { selector, action, value } }` to iframe
3. `clientMutatorScript.ts` in the iframe receives the message and applies `applyModification()`
4. Element changes in the iframe — PM sees the result instantly
5. "Revert" button posts `{ type: 'REVERT_MUTATION' }` which restores the original DOM

**`clientMutatorScript.ts`** (WIP on this branch, uncommitted) already handles the core `applyModification()` logic via MutationObserver for SPA re-renders. It needs:
- A `postMessage` listener added
- A "revert" stack (save original `textContent`/`className`/`style` before mutating)

### 5f. Side-by-side view

For findings where the mutation is significant (e.g., layout change, full section replacement), add a "Split view" toggle that renders:

```
┌──────────────────┬──────────────────┐
│   Current        │   With fix       │
│   (control)      │   (variant)      │
│                  │                  │
└──────────────────┴──────────────────┘
```

This is two iframes side by side. Left loads the unmodified page. Right loads the same page with the mutation applied via `clientMutatorScript.ts`.

The `api/preview/[experimentId]` endpoint already does this for experiments. Extend it to work for individual findings (no experiment needed — just a finding ID and the user's site).

### 5g. Build sequence for the visualization

**Phase 1 — Foundation** (unblocks everything else):
1. Generalize `api/preview/[experimentId]` → `api/preview` (accepts `findingId` or `experimentId`)
2. Wire `clientMutatorScript.ts` to listen for `postMessage` from parent
3. Build the "Apply mutation" + "Revert" message protocol

**Phase 2 — Canvas + coordinates**:
1. Build `AuditCanvas.tsx` with the same-origin proxy iframe
2. After iframe load, extract element rects for all current page's findings via postMessage
3. Render `FindingHighlight` badges over the iframe

**Phase 3 — Popup + interaction**:
1. Build `FindingPopup.tsx` (adapt `AnnotatedFindingPreview.tsx` from PR #79)
2. Wire badge click → popup
3. Wire "Preview this fix" → apply mutation to iframe
4. Wire "Revert" → restore original

**Phase 4 — Polish**:
1. Side-by-side toggle
2. Filter panel (show only `critical`, filter by category)
3. Animate findings in as page loads (staggered entry)
4. Keyboard navigation (Tab between findings, Escape to close popup)

---

## 6. Environment variables needed

| Variable | Purpose | Where to add |
|----------|---------|--------------|
| `BROWSERLESS_WS_URL` | Headless browser for SPA rendering + computed styles | Vercel + local `.env.local` |
| `AXIOM_DATASET=axiom-audit` | Activate structured log drain | Vercel env vars (token already verified) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Live Stripe round-trip verification | Stripe CLI test mode |

---

## 7. File map for the next developer

| What you're working on | Where to look |
|------------------------|---------------|
| Adding a new structural rule | `src/lib/phase2/rules/` — copy `missingMetaDescription.ts` as a template |
| Extending the snapshot parser | `src/lib/phase2/snapshots/parser.ts` + `types.ts` |
| Writing snapshot parser tests | `src/lib/phase2/rules/__tests__/fixtures.ts` — `makeSnapshot()` + `makeImage()` factories |
| Rules-fired write-through | `src/lib/phase2/rules/runInsightsPipeline.ts` — after `persistFindings()` |
| Industry detection | Add `deriveIndustry()` to `src/lib/phase2/snapshots/` |
| SPA support | `src/lib/phase2/snapshots/browserFetcher.ts` |
| Interactive visualization | `src/app/app/sites/[siteId]/` (new route) |
| Mutation preview postMessage | `src/lib/experiments/proxy/clientMutatorScript.ts` |
| Preview API endpoint | `src/app/api/preview/[experimentId]/route.ts` |
| DB migration | `drizzle/` — next sequential number is `0020` (after the open PRs land their 0017-0019) |

---

## 8. Test baseline

`npm run verify` must pass before any commit. As of this session:

- **46 test files, 545 tests, 0 failures**
- TypeScript: clean
- ESLint: clean
- Build: clean

Key test files for the audit engine:
- `__tests__/structuralRules.test.ts` — all 6 Layer E rules
- `__tests__/impactEstimate.test.ts` — conversion count format, no-$ invariant
- `__tests__/pipeline.e2e.test.ts` — end-to-end insights pipeline
- `__tests__/parser.test.ts` — snapshot parsing including images

---

## 9. What deliberately isn't being built

Per doctrine — do not attempt these even if they seem useful:

- Behavioral (event-based) rule count above 12. The bottleneck is loop closure, not rule count.
- LLM calls inside rule logic. Rules are pure deterministic functions.
- Dollar figures in `impactEstimate`. Conversion counts only.
- Cross-site priors before 50+ customers with outcome data.
- GitHub PR generation, sentiment analysis, PostHog replacement.
- Voice-of-customer / NLP pipelines (PII + consent complexity, not loop-advancing).

---

## 10. PR #84 follow-up fixes (this session — 2026-05-26 second pass)

Status as of close-of-session:

| PR #84 item | Status | Notes |
|---|---|---|
| **Bug #1** — posthog.com capture crash on >2 MB DOM | ✅ **Fixed** | `parser.ts` — every `el.text.trim()` now uses `(el.text ?? '').trim()` (`findHeadings`, `findCtas`, `directText` paths). A truncated/malformed DOM no longer poisons the audit run. |
| **Bug #2** — silent screenshot upload failures | ✅ **Observability fixed** | `capture/screenshots.ts` now logs `capture.screenshot.skipped` (no token) and `capture.screenshot.failed` (upload error) via the structured logger under `service: 'capture-record'`. Failure is no longer silent. Root-cause trace deferred until Axiom shows where the failures cluster (need a fresh capture to see). |
| **Bug #3** — CTA vocabulary contaminated by nav | ✅ **Fixed** | `/api/audit/public/run` + `/api/dashboard/experiments/ai-suggest` both filter `cta.landmark !== 'nav' && !== 'header'` before building `ctaVocabulary`. Audit funnel additionally ranks by `visualWeight` before taking the top 5 so hero CTAs win over footer links. |
| **Bug #4** — advisor never proposes element-insert + never sees headings | ✅ **Fixed end-to-end** | (a) `HeadingItem` now carries `cssSelector` (parser computes via `computeCssSelector`); (b) `buildMinimalHtml` re-emits heading attrs so the validator agrees; (c) `collectAllowedSelectors` in `ai-suggest/route.ts` now includes heading selectors; (d) `aiAdvisor.ts` schema offered to Gemini lists `element-insert` with `position` + `html`; (e) validator runs `sanitizeInsertHtml` and rejects empty-after-sanitize payloads; (f) 3 new tests cover the happy path, invalid position, and all-stripped HTML. |
| **Bug #5** — paired with #4 above | ✅ **Fixed** | Same diff. Heading selectors now in the allowlist. |
| **Brand-DNA terminology rename** | ✅ **Fixed in email** | `auditReportEmail.ts` relabeled: "Primary"→"CTA fill", "Secondary"→"Heading", "Type scale"→"Observed type sizes", "CTA voice"→"Conversion copy". Section heading "Your brand DNA"→"What we observed". `cssSystem: null` now renders an "unknown (compiled or hashed utility classes)" row instead of being silently skipped. Storage field names (`primaryColor`/`secondaryColor`/`typeScale`) kept as-is to stay drop-in with the existing `extractDesignTokens` writer; a future storage-side rename is non-blocking. |

**Still NOT in this branch (carried forward, scope-out per the PR description):**

- Phase 2 — confirm-time rebinding (synthetic org → real org). Cofounder-locked spec; ~half day.
- Multi-viewport brand-DNA. Blocked on a schema change — `phase2_site_design_snapshot` is keyed `(siteId, pathRef)` and needs a `breakpoint` column added to the primary key before mobile won't clobber desktop on upsert. Capture-layer array shape is already forward-compatible.
- Computed-styles pipeline expansion (the prerequisite for color-contrast, tap-target, and design-token-drift rules — multi-day, depends on Browserless permanent activation).
- New evidence rules (`colorContrastInsufficient`, `mobileTapTargetSmall`, `largeUncompressedImages`, `noSocialProof`, `formFieldCountExcessive`, `ctaAboveFoldMissing`, `redirectChain`, `missingStructuredData`) — all snapshot-grounded, ~8 rules; sequenced after the Browserless activation.
- Resend sender domain verification (env config, not code).

**`npm run verify` baseline after this session:** 74 test files, 931 tests, 0 failures; TypeScript clean; ESLint clean (4 pre-existing warnings); build clean.

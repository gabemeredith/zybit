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

---

## 11. Public-audit legitimacy hardening (2026-05-26 third pass)

Live-verifying the audit against vercel.com surfaced four output-quality
issues that pre-dated PR #84 and would have shipped fabricated evidence
to the first paying prospect. All four were closed in this session.

| Issue | Mechanism | Fix |
|---|---|---|
| `Skip to content` reported as "what visitors click most" | Parser included accessibility skip-links in the CTA inventory. Synthetic generator weights clicks by `1/(docIndex+1)`, so on most accessible sites the skip link won. Public audit then said "your visitors want `Skip to content`" — nonsense. | `parser.ts:findCtas` now filters skip-link patterns at the source. Match by text (`/^(skip\|jump) (to\|past\|over) (main\|content\|nav)/i`), href (`#main`/`#content`/`#skip`/`#primary`/etc.), or class (`skip-link`/`sr-only`/`visually-hidden`/`usa-skipnav`). Every downstream rule benefits — single chokepoint fix. |
| `(unnamed CTA)` artifact | Hero-hierarchy-inversion stringified `'(unnamed button)'` when the visually heaviest CTA had no parseable text (icon-only buttons, SVG-only CTAs). Output was gibberish: "your visitors want X but your page points them at `(unnamed CTA)`". | Both `evaluate()` paths in `heroHierarchyInversion.ts` now bail when either side resolves to no text. Better silence than fabrication. The vision pass is the real fix — see §12.B below. |
| `rage_click` events fabricated on every audit | `groundedEvents.ts` fired `rage_click` at `RAGE_PROB=0.08` per session on the page's first non-disabled affordance. Even though the public route blocklisted the rule from the email, the fake findings still persisted to `zybitFindings` for the prospect's auto-provisioned dashboard to leak. | Removed the entire rage-click emission from the synthetic generator. The blocklist remains as defense-in-depth, plus the post-pipeline DELETE pass below. |
| Fabricated counts in persisted evidence (`Nav clicks: 111`) | Email used `structuralPublicAuditCopy()` to rewrite evidence for hero/fold/nav — but only at email-render time. The DB rows kept the original synthetic counts. The prospect signed into the dashboard and saw "Nav clicks: 111" — that's a fabricated number. | `/api/audit/public/run` now does a post-pipeline DB scrub: (a) DELETE rows in `SYNTHETIC_AUDIT_RULE_BLOCKLIST`; (b) DELETE rows whose evidence contains `(unnamed button)`/`(unnamed CTA)`; (c) UPDATE the three overrideable rules' `title`/`summary`/`evidence`/`prescription.whyItMatters` in-place so the email and the dashboard show the same structural framing. |
| Rage-click insight gone (but PMs still need the signal) | Without `rage-click-target` the public audit has nothing to say about broken interactivity. | New rule `dead-click-target` (`src/lib/phase2/rules/deadClickTarget.ts`). Pure structural — fires on `<a href="#">`, `<a href="javascript:void(0)">`, `<a href="">`, and `<a>` with no `href`. Severity scales with count (≥5 → warn). This is the real "rage-click precursor" PMs can fix today, before any analytics data exists. |

**Live verification on vercel.com (same site, before vs. after this pass):**

| | Before | After |
|---|---|---|
| Total findings | 12 | 6 |
| `hero-hierarchy-inversion` | 3 (all unnamed-CTA artifacts) | 0 (correctly silent — vercel.com hero CTAs are icon-only) |
| `rage-click-target` | 3 (all fabricated) | 0 (rule removed from synthetic path) |
| `dead-click-target` | rule didn't exist | 0 on vercel.com (they ship clean) — fires correctly on test fixtures with `href="#"` |

The legitimacy contract is now: **everything the prospect sees — email AND dashboard — is grounded in their actual HTML or PostHog-flagged as needing real data.** No fabricated counts anywhere.

---

## 12. AI-leveraged roadmap — what the audit needs next to stop being structural-only

The audit today is honest but thin: 7 structural rules + 3 design rules with
behavioral overrides. To deliver findings PMs would actually pay for, we
need to stop treating the audit as a parser and start treating it as a
PM-grade reviewer that just happens to use a parser as one input.

**Doctrine still holds:** deterministic rules don't call LLMs (one input,
one output, every time). But LLMs are first-class citizens for:
1. **Filling capture gaps** (icon-only CTAs, visual hierarchy without
   computed-styles)
2. **Rewriting prescriptions** in the customer's voice
3. **Compounding signals** that no single rule can express
4. **Page-context classification** so rules apply correctly

### A. Mandatory vision pass on every audit (today: opt-in single-shot)

> **Status (2026-05-26):** shipped on this branch. `captureVisualSignals`
> in `src/lib/audit/captureVisualSignals.ts` runs structured-output
> Gemini 2.0 Flash with a strict validator (`validateVisualSignals`),
> producing `VisualSignals` (visualPrimaryCta, visualSecondaryCta,
> pageType, heroBlock). Wired into the snapshot loop in `runUrlAudit`
> with a `visionPagesLimit` opt — `/api/audit/public/run` passes 3.
> `heroHierarchyInversion` reads `visualPrimaryCta.text` as a fallback
> when the parser's CTA text is empty (the icon-only "Get started"
> case). 11 validator + capture tests + 2 hero-rule fallback tests.
> Still TODO: per-rule consumers of `pageType` (§D); AI copy-critique
> rules (§C) — `heroBlock` is the input they need but the rules don't
> exist yet.

`src/lib/audit/visionPass.ts` runs at most once per audit and writes a
2-sentence observation. Promote it to a true pipeline stage:

1. **Above-fold screenshot per page** (not just homepage). Browserless
   capture is already wired; budget impact: ~$0.001/page × 3 pages = $0.003.
2. **Structured vision extraction** via Gemini 2.0 Flash:
   - Identify the *visual* primary CTA (what the eye actually lands on)
     and the *visual* secondary CTA. Returns bbox coords + extracted text.
     Solves the unnamed-CTA problem at its root — icon-only "Get started"
     buttons get their semantic label back.
   - Classify page purpose: `landing` / `pricing` / `signup` / `checkout`
     / `docs` / `about` / `blog` / `support` / `legal` — feeds rule
     context-awareness (§D below).
   - Extract the hero copy + sub-hero + the first body paragraph,
     verbatim, into a structured object. This is the input to AI copy
     critique (§C) and to the brand-voice prescription rewriting (§E).
3. **Pull vision output into `PageSnapshotData`** as a new
   `data.visualSignals` field so rules can read it as if it were any
   other parser output. Rules stay deterministic; the LLM call is
   capture-layer, not rule-layer.

**Closes:** unnamed-CTA gap, brand-color limitation (vision sees colors
the way humans do, not as mode-of-bg-color), CTA-vocab quality (icon-only
CTAs get named), hero-hierarchy false negatives (vision sees emphasis
the way humans do).

**Effort:** 1-2 days. The hardest bit is the prompt schema + validator
(borrow the `aiAdvisor.ts` pattern: structured-output mode + selector
allowlist + sanitized output).

### B. Computed-styles capture must ship — this is the rate-limiter on everything

§3a of this handover (PageDNA capture gaps) is on the critical path for
half of §12. `capture/styles.ts` measures CTA bg/fg and heading color —
that's it. Every "more colors" / "color contrast" / "tap target" / "LCP
candidate" rule wants more.

**One-day-job extensions to `styles.ts`:**
- CTA: also capture `borderColor`, `borderRadius`, `fontFamily`,
  `fontWeight`, `padding`
- Heading: also capture `fontFamily`, `fontWeight`, `letterSpacing`
- Body / main / dominant `<section>`: capture `backgroundColor`, `color`,
  `fontFamily` — so the token extractor can emit page background, surface
  color, link color
- Image elements: `width`/`height` rendered vs `naturalWidth`/`naturalHeight`
  → enables `largeUncompressedImages` rule

**Three-day-job extensions to `tokenExtractor.ts`:**
- Emit `accentColor` (mode of CTA borderColor, fallback link color)
- Emit `surfaceColor` (mode of section/body backgroundColor)
- Emit `fontFamily` (mode of CTA fontFamily — usually the brand font)
- Emit `borderRadiusScale` (sorted unique radii — "rounded" vs "sharp")

**Critical-path env var:** `BROWSERLESS_URL` + `BROWSERLESS_KEY` must be
set in prod. Without these the entire vision + computed-styles + brand-DNA
path fails-soft and the audit degrades to structural-only.

### C. New rule family — AI copy critique (Layer F)

Once vision pass extracts hero copy verbatim, a deterministic-on-LLM-output
rule can fire:

- `vague-claim-detected` — input: hero claim. LLM returns
  `{ specificity: 0-1, vague_phrases: [...], suggested_rewrites: [...] }`.
  Rule fires when `specificity < 0.4`. PM-actionable: shows the vague
  phrase + 3 concrete alternatives ranked by clarity.
- `proof-missing` — input: hero block + first 3 body paragraphs.
  LLM returns `{ proof_signals: [...], proof_gaps: [...] }`. Rule fires
  when zero proof signals present.
- `cta-verb-mismatch` — input: page purpose (from vision §A) + CTA copy.
  LLM returns `{ matches_purpose: bool, suggested_verbs: [...] }`. Rule
  fires when CTA copy is mismatched to page intent (e.g. "Book a demo"
  on a help-docs page).

These are not "LLM in the loop" — the rule itself is deterministic
(threshold on a structured LLM output, run once at capture time, cached
in the snapshot). Same trust model as the vision pass.

**Effort:** 2-3 days for the three rules + their prompt validation.

### D. Page-purpose context-awareness across the whole rule pipeline

Once vision pass classifies pages, every existing rule can apply
*differently* per page type. The current rule output is full of false
positives because all pages get the same treatment.

Examples:
- `nav-dispersion`: 9 nav items is fine on a docs site, friction on a
  pricing page.
- `above-fold-coverage`: a blog index *should* have content below the
  fold; a pricing page shouldn't.
- `cta-above-fold-missing`: doesn't apply to legal/about pages.

Implementation: add `data.pageType` to `PageSnapshotData`, populated by
vision pass. Each rule's `evaluate()` reads it and either changes
thresholds, suppresses entirely, or emits with a contextual confidence
adjustment. Effort: 1 day to plumb, then per-rule (15-30 min each).

### E. AI prescription rewriting in the customer's voice

Today every finding's `prescription.whatToChange` is a templated string.
Once we have brand-DNA captured (vision-extracted colors + CTA vocabulary +
hero copy register), Gemini can rewrite the prescription in the customer's
own voice. Same loop as the AI Variant Advisor (`aiAdvisor.ts`) but
operating on `prescription` rather than `VariantModification`.

Constraints (mirror the advisor):
- Pure prompt + structured output + validator
- Validator rejects anything that drifts from the source prescription's
  semantics (use Gemini as judge with a second pass)
- Cache rewrites by finding-id + brand-DNA hash so we don't re-spend on
  every email render

**Effort:** 1 day. Reuse 80% of `aiAdvisor.ts` infrastructure.

### F. The architectural shift — `PublicAuditMode` as a first-class context

> **Status (2026-05-26):** shipped on this branch. `AuditMode` is now a
> field on `AuditRuleContext`; every rule in `ALL_AUDIT_RULES` declares a
> `publicAuditBehavior` of `'as-is'` / `'structural-only'` / `'empty'`;
> the `'structural-only'` rules colocate their rewrite as
> `structuralPublicAuditCopy`. `runAuditRules` reads `ctx.mode` and
> applies the per-rule contract before findings return. The route no
> longer DELETE/UPDATEs after persistence — the pipeline writes
> prospect-safe rows the first time. A registry-level test in
> `publicAuditMode.test.ts` enforces every rule has a declaration so
> new rules cannot ship without an explicit choice (fail-closed).
> Defense-in-depth `(unnamed CTA)` / `(unnamed button)` scrub moved to
> `src/lib/audit/publicAuditScrub.ts` and is shared between the route
> and `runUrlAudit` — closes §13.3.

The current public audit pipeline is "run the full rule set, then
DELETE/UPDATE findings after the fact." That works but leaks the moment
a new rule that consumes synthetic events is added without anyone
updating the blocklist or override map.

The architecturally correct fix: introduce a `mode: 'public-audit'` flag
in `AuditRuleContext`. Each rule then either:
1. Returns its findings as-is (pure structural rules)
2. Returns a structural-only version of its findings (the 3 overrideable
   design rules)
3. Returns `[]` (rules that need real behavioral data)

The route just runs the pipeline in public mode and trusts the output.
No post-hoc scrubbing. A new rule that doesn't explicitly handle public
mode emits nothing — fail-closed, which is the right default for a
prospect-facing surface.

**Effort:** 1 day (refactor + new test that every rule declares its
public-audit behavior). High value — this is what stops the next
synthetic-leak class of bug.

### G. Cross-page intelligence — page-relationship inference

Single-page analysis ignores 80% of what an audit could say. A real
reviewer would observe: "Your /pricing page says 'Start free trial' but
the trial signup at /signup uses the verb 'Get started' — visitors arrive
expecting the former and see the latter, eroding trust."

This is purely a rule over multiple `PageSnapshotData` rows + an LLM
consistency check. The capture is already in place; we don't even need
the vision pass for the first version (CTA vocab comparison across pages).

**Effort:** 0.5 day for the deterministic version, +1 day for LLM-judged
copy consistency.

### H. AI-driven prescription validation loop

For every prescription we emit, ask Gemini: "If I made this change to a
page that currently has [evidence], would the change improve [the metric
the prescription claims to move]? Return `{ likely_improves: bool,
confidence: 0-1, alternative: string | null }`." Findings whose
prescriptions don't pass the validation step ship with lower priority
scores or get dropped.

This is the dogfood version of the AI Variant Advisor pointed inward at
our own rule output. Catches "we're suggesting the right thing for the
wrong reason" — the failure mode behavioral rules have when synthetic
data feeds them.

**Effort:** 1 day.

### I. The compound rule — vision + structure + behavior at the same time

Today every rule consumes one or two of {snapshot, capture, behavioral}.
A compound rule reads all three and fires on patterns no single rule
sees:

- "Your visually heaviest CTA (vision) is below the fold (structure) and
  has zero clicks (behavior)" → much higher confidence than any single
  rule.
- "Your hero copy promises X (vision-extracted) but your /signup form
  asks for Y (structure) and 60% of submitters abandon at field 3
  (behavior)" → the promise/delivery gap rule.

This is the long-term shape of where rules go once vision + computed
styles + PostHog data are all present. Each compound rule needs a test
fixture that constructs all three inputs; the rule itself stays pure
deterministic. **Effort: 2-3 days per compound rule** — the cost is in
test fixtures, not logic.

### J. Sequencing — what to land in what order

The dependency graph collapses to one critical path and three parallel tracks:

**Critical path (must precede everything else in this list):**
1. `BROWSERLESS_URL` + `BROWSERLESS_KEY` set permanently in Vercel prod.
   Without this, §A–C, §E, §G are all dead.
2. Vision pass elevated from opt-in to mandatory (§A). 1-2 days.
3. `PublicAuditMode` context refactor (§F). 1 day.

**Parallel track 1 — capture upgrades (§B):** unblocks the new evidence
rules from the original handover §3a. ~3-4 days.

**Parallel track 2 — AI rule family (§C, §E, §H):** depends only on §A.
~4-5 days for all three.

**Parallel track 3 — context-aware rule application (§D, §G, §I):**
depends on §A + §B + §F. ~3-4 days.

**Total to make the audit defensible as a paid product feature: ~3 weeks
of focused work.** The single biggest unlock is mandatory vision pass —
it converts every "structural blindness" gap in this handover into a
solvable problem.

### K. What we deliberately are NOT doing (even though AI could)

Per `DOCTRINE.md` and `AGENTS.md`:
- **LLM calls inside rule logic.** Rules stay pure functions. LLM output
  is consumed as another deterministic data source (capture-time, cached,
  validated). The rule is the contract; the LLM is just a more capable
  parser.
- **AI-generated impact estimates / dollar figures.** Already removed
  (impactEstimate.ts emits conversion counts only). Don't re-add.
- **AI-generated rules.** Every rule has a written specification, a test
  suite, and a human reviewer. Adding rules autonomously breaks the trust
  contract with PMs.
- **Cross-customer learning before 50+ customers.** Even with vision +
  AI prescriptions, per-customer Layer 1/2 calibration is the only
  learning loop today.

---

## 13. Known open architectural risks (carry forward to next session)

1. ~~**The structural-override map (`structuralPublicAuditCopy`) and the
   blocklist (`SYNTHETIC_AUDIT_RULE_BLOCKLIST`) are policy-only.**~~ **Closed
   2026-05-26.** Every rule in `ALL_AUDIT_RULES` declares a
   `publicAuditBehavior` and the registry test fails CI on an
   undeclared rule. Adding `flow-inter-step-dropoff` to the public
   audit no longer leaks — it's declared `'empty'` and skipped.

2. ~~**The post-pipeline scrub in `/api/audit/public/run` mutates
   `zybit_findings` rows that were just written.**~~ **Closed 2026-05-26.**
   The pipeline accepts `mode: 'public-audit'` and refuses to emit
   blocklisted findings; structural-only rewrites land in the persisted
   row the first time. The route's DELETE/UPDATE block is gone.

3. ~~**The lighthouse `runUrlAudit` runner writes findings directly
   without the scrub.**~~ **Closed 2026-05-26.** Defense-in-depth
   `(unnamed CTA)` scrub lives in `src/lib/audit/publicAuditScrub.ts`
   and is imported by both surfaces; runner applies it when
   `mode === 'public-audit'`.

4. **`dead-click-target` only covers `<a>` — handler-less `<button>`s
   are still invisible.** Capturing this needs either `cursor: pointer`
   measurement in `styles.ts` (cheap, ship with §B) or DOM event listener
   inspection (expensive, defer).

5. ~~**Vision pass is best-effort and runs once per audit**~~ **Partial
   2026-05-26.** Structured vision (`captureVisualSignals`) runs at
   capture time for the first 3 pages in public-audit mode and writes
   `data.visualSignals` to the snapshot row. `heroHierarchyInversion`
   reads `visualPrimaryCta.text` as a fallback when CTA text is empty.
   Still TODO: per-page coverage beyond 3 if budget allows;
   `pageType`-driven threshold modulation across all rules (§12.D); AI
   copy-critique rules (§12.C) that consume `heroBlock`.

6. **`AUDIT_FROM_EMAIL` is `noreply@mail.getzybit.com`** — send-only.
   Prospects who reply to the report email reach nothing. Either set up
   a forwarding rule on that mailbox to a real human inbox, or change the
   sender to a monitored address before scaling. Pre-existing, not in
   scope for this session.

7. **The advisor's "headings in scope" expansion needs real-world
   verification.** Tests prove the schema flows through; we haven't
   measured what fraction of real customer headings actually carry a
   stable `cssSelector`. On vercel.com it was 27/78 (35%). If that's the
   typical rate, the advisor will frequently propose options with CTA-only
   anchors, which is fine, but worth measuring before promising "the AI
   can edit your headings" externally.

**`npm run verify` baseline after this third pass:** 76 test files,
945 tests, 0 failures; TypeScript clean; ESLint clean (4 pre-existing
warnings); build clean.

**`npm run verify` baseline after the Ring 1 + Ring 2 pass (2026-05-26):**
79 test files, 980 tests, 0 failures; TypeScript clean; ESLint clean
(4 pre-existing warnings); build clean.

---

## 14. Ring 1 + Ring 2 — what landed this session (2026-05-26 fourth pass)

This session shipped the architectural shift in §12.F and the structured
vision pass in §12.A. Together they convert the public-audit pipeline
from "run + scrub" to "run-in-mode + write-once," and they close the
unnamed-CTA root cause at capture time. Three of the seven risks in §13
are closed; §13.5 is partially closed.

### Ring 1 — `PublicAuditMode` as first-class context

Files added / changed:
- `src/lib/phase2/rules/types.ts` — `AuditMode`, `PublicAuditBehavior`,
  `StructuralPublicAuditRewrite`, `AuditRuleContext.mode`,
  `AuditRule.publicAuditBehavior`, `AuditRule.structuralPublicAuditCopy`.
- `src/lib/phase2/rules/index.ts` — `runAuditRules` reads `ctx.mode`,
  drops findings from `'empty'` rules in public mode, applies
  `structuralPublicAuditCopy` to `'structural-only'` rules in place.
- Every rule in `ALL_AUDIT_RULES` declares its behavior:
  - `'as-is'`: all 7 Layer E structural rules.
  - `'structural-only'`: hero-hierarchy-inversion, above-fold-coverage,
    nav-dispersion — rewrites colocated with the rule.
  - `'empty'`: rage-click, mobile-asymmetry, error-exposure,
    form-abandonment, bounce-on-key-page, help-seeking-spike,
    hesitation, return-visit-thrash, cohort-pain-asymmetry,
    flow-inter-step-dropoff.
- `src/lib/phase2/runInsightsPipeline.ts` — accepts `mode`, threads
  through to `runAuditRules`.
- `lighthouse/lib/runner/runUrlAudit.ts` — accepts `mode`, threads
  through, applies the defense-in-depth scrub when public-audit.
- `src/app/api/audit/public/run/route.ts` — passes
  `mode: 'public-audit'` to `runUrlAudit`. Post-pipeline DELETE/UPDATE
  scrub block removed (-94 lines).
- `src/lib/audit/publicAuditScrub.ts` — shared `(unnamed CTA)` /
  `(unnamed button)` filter, imported by route + runner.
- `src/lib/phase2/rules/__tests__/publicAuditMode.test.ts` —
  registry-level enforcement + orchestrator behavior + per-rule
  rewrite contract (11 tests).
- `src/lib/audit/__tests__/publicAuditScrub.test.ts` — pure-function
  correctness (7 tests).

PR #85 review nits closed in the same change:
- `collectBrandDna` in the route now uses `normalizePathRef` (issue #1).
- `colorSwatch` in `auditReportEmail.ts` validates against a strict
  hex regex and drops the swatch on mismatch (issue #2 — CSS
  injection vector).

### Ring 2 — structured vision pass as a capture stage

Files added / changed:
- `src/lib/phase2/snapshots/types.ts` — `PageType`, `VisualCtaSignal`,
  `VisualHeroBlock`, `VisualSignals`; `PageSnapshotData.visualSignals?`.
- `src/lib/audit/captureVisualSignals.ts` — Gemini 2.0 Flash
  structured-output call with `validateVisualSignals` validator.
  Mirrors `aiAdvisor.ts`'s trust model: API key in header, REST not
  SDK, strict JSON schema, fail-soft on validation error.
- `src/lib/audit/captureAboveFoldBuffer.ts` — above-fold-only
  Browserless screenshot returning a Buffer (separate from
  `visionPass.ts`'s screenshot helper which also uploads to Blob).
- `lighthouse/lib/runner/runUrlAudit.ts` — `visionPagesLimit` opt;
  per-page vision capture loop, attaches `data.visualSignals` to the
  snapshot before upsert.
- `src/app/api/audit/public/run/route.ts` — passes
  `visionPagesLimit: 3` so the first three crawled pages get vision.
- `src/lib/phase2/rules/heroHierarchyInversion.ts` — reads
  `visualSignals.visualPrimaryCta.text` / `visualSecondaryCta.text`
  as fallback labels when the parser CTA text is empty. The bail-on-
  unnamed-side guard remains but is much narrower now.
- `src/lib/audit/__tests__/captureVisualSignals.test.ts` — validator
  edge cases + capture function fail-soft contract (11 tests).
- `src/lib/phase2/rules/__tests__/heroHierarchyInversion.test.ts` —
  added 2 vision-fallback tests (uses-vision-label, still-bails-when-
  no-vision).

### Live verification

Two e2e scripts in `scripts/` exercise the new functionality against
real targets without needing the public-audit HTTP route's external
service dependencies (Firecrawl / Browserless / Gemini / Resend):

  - **`scripts/e2e-public-audit-mode.mjs`** — drives `runSnapshot` +
    `runAuditRules` against real product landing pages. Default targets
    are `github.com`, `vercel.com`, `linear.app`, `stripe.com`; the
    script gracefully skips any host that returns 403 (sandbox / WAF
    bot-mitigation) so a partial run on a restricted network still
    asserts something real.
    - Verifies all 10 `'empty'`-declared rules skip in public mode (the
      orchestrator logs `PUBLIC_AUDIT_BEHAVIOR_EMPTY` in diagnostics).
    - Verifies zero behavioral findings leak in public mode.
    - Verifies no `(unnamed CTA)` / `(unnamed button)` artifacts.
    - Verifies `applyDefenseInDepthScrub` is a no-op against clean
      Ring-1 output (the orchestrator already produced safe rows).
    - Injects synthetic `visualSignals` and verifies the hero rule's
      vision-fallback path: `visualPrimaryCta.text = "Get started"`
      is used as the heavy CTA label instead of bailing on empty text.
    - Last run (2026-05-26, github.com reachable; vercel/linear/stripe
      skipped from sandbox): 8 assertions passed, 0 failed.
      Report: `/tmp/e2e-public-audit-mode-report.json`.

  - **`scripts/e2e-audit-email-strict-hex.mjs`** — Playwright
    (chromium-core) render of the audit-report email with three
    `brandDna.primaryColor` scenarios: clean hex, CSS-injection payload,
    `rgb()` non-hex. Asserts the PR #85 review issue #2 fix:
    - Clean hex renders the swatch with the color applied.
    - Injection payload (`#ff0000; }body{display:none;}{`) does not
      appear anywhere in the rendered HTML.
    - `rgb(...)` values are dropped (the brand-DNA writer is expected
      to normalize to hex; if it doesn't, the email surfaces the gap
      as a missing swatch rather than risk injection).
    - The drop is per-swatch — the secondary clean swatch + the rest
      of the brand-DNA section still render.
    - Last run: 9 assertions passed; HTML + PNG artifacts in
      `/tmp/audit-email-strict-hex-{clean,injection,non-hex}.{html,png}`.

The existing `scripts/e2e-audit-email-visual.mjs` regression suite
(brand-DNA terminology rename verification) was re-run and stayed
green — the strict-hex change did not regress the swatch rendering
for the sample-fixture colors.

### What's still TBD (next session)

In handover-priority order:

1. **Per-rule consumers of `pageType`** (§12.D). Vision now produces it
   per page; nav-dispersion, above-fold-coverage, etc. should modulate
   their thresholds. ~1 day to plumb + per-rule (15-30 min each).
2. **Layer F AI copy critique** (§12.C) — `vague-claim-detected`,
   `proof-missing`, `cta-verb-mismatch`. `heroBlock` is already the
   input they need. 2-3 days.
3. **Computed-styles expansion** (§12.B) — `capture/styles.ts`
   borderColor / fontFamily / fontWeight / page background; image
   rendered-vs-natural; `tokenExtractor.ts` accent + surface +
   borderRadius scale. Rate-limiter on new evidence rules. 3-4 days.
4. **dead-click-target button extension** (§13.4). Ships with §12.B —
   piggybacks on `cursor: pointer` measurement.
5. **AI prescription rewriting** (§12.E) and the AI validation loop
   (§12.H). Both depend on §12.A and reuse 80% of `aiAdvisor.ts`. 2 days.
6. **Compound rules + cross-page intelligence** (§12.G / §12.I) — the
   long-term shape, depends on §12.B + §12.D.

Total remaining to "audit endpoint as a defensible paid product
feature" per the handover's own math: ~2 weeks (down from 3 — Rings
1 + 2 closed the architectural blockers and the structured-vision
plumbing).

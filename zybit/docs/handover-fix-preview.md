# Zybit — Audit Fix-Preview Handover

**Branch:** `claude/ecstatic-knuth-JPuBz` (continued from `claude/audit-fix-preview-handover-N2TVH`)
**Last updated:** 2026-05-27 (Step 2 shipped — perceptual pixel-diff gates Tier 1)
**Purpose:** Engineering handover for the public-audit before/after fix-preview pipeline. Covers architecture, what shipped, live verification results, and the prioritised next steps.

> **Start here if you're cold:** Read §9 (branch state + quick commands), then §6 (next steps), then §2 (what's already built). Everything else is reference.

> **Canonical one-liner:** `AGENTS.md` → `Public URL-audit lead magnet` row — "Step 2 shipped 2026-05-27" paragraph.

---

## 1. Context

The `/audit` lead magnet (`src/app/audit/[id]`) currently shows findings + an annotated screenshot. The product gap: prospects see what's *wrong* but not what *right* looks like. This pipeline fills that gap with a real before/after screenshot pair per top finding, shown as a drag-slider on the audit page and a side-by-side in the report email.

### Three-tier ladder (per finding)

```
Tier 1 — deterministic mutation render           ← screenshot-grounded as of Step 1
  renderBeforeOnly() → before.png → base64
  suggestAuditFix(screenshot=base64) → VariantModification[]
  applyModifications(fetchedHtml, mods)
  renderBeforeAfter(prefetchedHtml, mods) → before.png + after.png (Browserless)

Tier 2 — vision inpaint                          ← fallback when Tier 1 declines
  Nano Banana 2 (gemini-3.1-flash-image-preview) edits the real before.png
  brand-tokens + finding-prescription prompt

Tier 3 — annotated-before fallback               ← always available
  existing renderFindingScreenshot path; audit shows before-only + "sign up to see the fix"
```

Each tier degrades to the next on failure so the audit always ships *some* visual.

---

## 2. What's built

### A — Audit-mode AI advisor
**`src/lib/audit/fixPreview/auditFixAdvisor.ts`**

Purpose-built sibling of `src/lib/experiments/aiAdvisor.ts`. Key differences:

| | Production advisor | Audit advisor |
|---|---|---|
| Returns | 3 options for PM review | 1 best fix |
| Selector gate | Strict allowlist (CTAs/forms/headings) | None — screenshot is the ground truth |
| `element-insert` cap | 4 KB | 16 KB |
| Vision channel | — | `beforeScreenshotBase64: string \| null` → `inline_data` part |

Safety guards **reused from production** (not duplicated): `sanitizeInsertHtml`, `isSafeCssDeclarations`, `isSafeReplacementText`, `isSafeAttributeName`. Adds `isSafeAuditInsertHtml` with 16 KB cap.

**Prompt (as of Step 1):** "GROUND TRUTH" block tells the model the screenshot IS the live page; every selector MUST target a visible element. Explicit hash-class warning. `availableSelectors` hint list removed — screenshot is the sole selector signal.

Entry point: `suggestAuditFix(input, opts?)` → `AuditFixAdvisorResult | null`. Never throws.

### B — Renderer
**`src/lib/audit/fixPreview/renderBeforeAfter.ts`**

Two exports:

**`renderBeforeAfter({findingId, originUrl, modifications, prefetchedHtml?})`**
- If `prefetchedHtml` provided, skips SSRF fetch (reuses HTML from the before render).
- Applies mods, bails if byte-identical no-op.
- One Browserless connection, two parallel `page.route()` + `page.goto()` renders at 1280×900.
- **As of Step 2:** runs `isVisiblyChanged(before, after)` (`pixelmatch` + `pngjs`, threshold 0.1, > 100 changed pixels). If the pair is perceptually indistinguishable the function returns `null` and the orchestrator falls to Tier 2 (silent-no-op gate).
- Uploads both PNGs to Vercel Blob, returns `{ beforeUrl, afterUrl, beforeBuffer }`.

**`isVisiblyChanged(before: Buffer, after: Buffer): boolean`** — exported helper. Safe defaults: PNG parse error → `true`; different dimensions → `true`. Used by the renderer and by the live harness so the two surfaces stay in lockstep.

**`renderBeforeOnly({findingId, originUrl})`**
- Runs one `page.route()` + `page.goto()` render of the live page.
- Returns `{ beforeUrl, beforeBuffer, fetchedHtml }` — the `fetchedHtml` is handed to `renderBeforeAfter` to skip the second SSRF fetch.

**Why `page.route()` not `setContent`:** `setContent` has no document URL, so relative `<link href="/style.css">` 404s → unstyled screenshot. `page.route()` + `page.goto(originUrl)` intercepts only the main-document response; all other requests (CSS, fonts, images) pass through to the real origin. Same model the experiment proxy uses at runtime.

Both functions: `ignoreHTTPSErrors: true`, desktop UA, `waitUntil: 'load'` + 1.5s settle, 25s timeout.

### C — Vision inpaint
**`src/lib/audit/fixPreview/visionInpaint.ts`**

Calls Nano Banana 2 (`gemini-3.1-flash-image-preview`, overridable via `INPAINT_MODEL` env). Three gotchas — **do not remove these**:
1. `generationConfig.responseModalities: ['TEXT', 'IMAGE']` is **mandatory** — without it the endpoint returns text only.
2. Response uses camelCase (`inlineData`/`mimeType`); request uses snake_case. Parser handles both.
3. Model sometimes returns JPEG for PNG input. Upload uses the model's actual `mimeType`.

### D — Orchestrator
**`src/lib/audit/fixPreview/generateFixPreviews.ts`**

Sequential per-finding loop (Browserless rate-limits aggressively; concurrency would surprise us). Per-finding order as of Step 1:

1. `renderBeforeOnly` — get before.png + fetchedHtml
2. `suggestAuditFix(beforeScreenshotBase64=…)` — advisor sees the live page
3. If mods returned → `renderBeforeAfter(prefetchedHtml=…)` → Tier 1 result
4. If Tier 1 declines → `inpaintFixAfter(beforeBuffer=…)` → Tier 2 result
5. If Tier 2 fails → tier-3 outcome with before-only URL

All external deps are **injectable** via `FixPreviewDeps` (production callers pass nothing, tests substitute stubs). Feature-flagged: returns tier-3-fallback outcomes when `AUDIT_FIX_PREVIEW_ENABLED !== '1'`.

### E — Database
**`drizzle/0023_finding_fix_preview.sql`** — 5 new columns on `forge_findings`:
- `screenshot_before_url`, `screenshot_after_url` — Vercel Blob URLs
- `fix_preview_tier` — `smallint` (1, 2, or 3)
- `fix_modifications` — `jsonb` (Tier 1 only, so the dashboard can replay as an experiment later)
- `fix_preview_generated_at` — `timestamptz`

Schema mirror in `src/lib/db/schema.ts`. URLs inlined on `public_audits.findings` JSON so `/audit/[id]` + the email don't need an extra query.

**Migration NOT applied to Neon yet** (see §6 Step 3).

### F — BeforeAfterSlider
**`src/components/audit/BeforeAfterSlider.tsx`**

Client component — drag pointer + arrow keys (Home/End/PgUp/PgDn). No external deps. Falls back to before-only + "Sign up to see the fix" hint when `afterUrl` is null. Wired into `src/app/audit/[id]/page.tsx`.

### G — Email template
**`src/lib/email/auditReportEmail.ts`** — `fixPreviewRow` per finding card. Side-by-side table layout for tier 1/2 (email-client-safe, no flexbox), single image + "sign up" note for tier 3.

### H — Route wiring
**`src/app/api/audit/public/run/route.ts`** — calls `generateFixPreviews` on top 4 findings, merges results into `topFindings` before email send. Fail-soft try/catch.

**`src/app/api/audit/public/status/route.ts`** — extends `PublicFinding` with new fields, threads through to `/audit/[id]` polling.

### I — Models
| Layer | Model | Override |
|---|---|---|
| Tier 1 advisor | `gemini-3.5-flash` | — |
| Tier 2 inpaint | `gemini-3.1-flash-image-preview` | `INPAINT_MODEL` env |
| Tier 2 budget upgrade | `gemini-3-pro-image-preview` | set `INPAINT_MODEL` |

### J — Live harness
**`scripts/live-fix-preview.ts`**

Standalone verification script — local Chromium, real Gemini, no Browserless/Blob/DB writes.

```bash
GEMINI_API_KEY=… npx tsx scripts/live-fix-preview.ts https://example.com
```

Outputs to `/tmp/audit-live/<host>/` — `before.png`, `<rank>-<ruleId>-after.png`, `<rank>-<ruleId>-nano.jpg`, `index.json`. Now feeds the before-screenshot base64 to the advisor (Step 1 update). **Note: the snapshot fetcher has no UA spoof, so anti-bot sites (browserless.io, example.com in this sandbox) will 403 — use URLs that accept plain fetches or host a local page.**

---

## 3. Architecture decisions

### Why three tiers
Trust is fragile on a lead-magnet demo surface. Tier 1 is deterministic (same mod + HTML → same render) but only fires when the advisor picks selectors that actually resolve. Tier 2 always produces *something* because it edits the screenshot directly. Tier 3 is the existing path. We degrade, we never show nothing.

### Why no selector allowlist on the audit advisor
The production allowlist defends against PM-review fatigue. The audit has no PM in the loop — the validator that matters is "did the screenshot visibly change?" Step 1 added the screenshot as the upstream ground truth. Step 2 adds the downstream pixel-diff check to close the loop.

### Why `page.route()` not `setContent`
See §2B. Short: `setContent` = unstyled raw HTML. `page.route()` = real styled page. Applies to both before and after renders.

### Why dependency injection on the orchestrator
The tier-fallback ladder is the only non-trivial business logic. DI lets the 9 unit tests exercise every branch without mocking a single module. Production callers pass `{}` and get the real impls.

### Why feature-flagged
`BROWSERLESS_KEY`, `BLOB_READ_WRITE_TOKEN`, `GEMINI_API_KEY`, and migration 0023 all need to be in place before the pipeline is live. The flag (`AUDIT_FIX_PREVIEW_ENABLED=1`) is the safe-by-default gate.

---

## 4. Live verification results (2026-05-27)

### Pre-Step-1 harness run (original session, `scripts/live-fix-preview.ts`)

| Site | Tier 1 | Tier 2 |
|---|---|---|
| `browserless.io` | Advisor returned mods, but selectors didn't resolve (hash classes). No visible after.png. | Both findings produced clean, brand-coherent edits. |
| `example.com` | Hero-hierarchy + meta-description both produced real renders. | All three findings produced strong edits. |

**Headline finding:** Tier 2 was the reliable surface; Tier 1 missed on hash-class sites.

### Step 1 live verification (this session, real Gemini API call + local Chromium)

Ran a targeted integration test — local HTML page → Chromium screenshot → Gemini advisor call with and without the screenshot. Result:

| | Selector emitted | Would it resolve against the page HTML? |
|---|---|---|
| **With screenshot** | `a:not(header a)` | ✅ Yes — model saw the nav and excluded it, targeted the CTA |
| **Without screenshot** | `a.learn-more` | ❌ No — `.learn-more` class doesn't exist; a no-op apply |

This is the exact Tier 1 miss pattern Step 1 was designed to fix. The vision channel works end-to-end with real Gemini API calls. Acceptance screenshot saved at `docs/step1-acceptance-before.png`.

---

## 5. Known gaps (current state)

| # | Gap | Status |
|---|---|---|
| 1 | **Migration 0023 not on Neon** | ⬛ Required before flipping flag in prod. Step 3 (now the top blocker). |
| 2 | ~~No pixel-diff "did this resolve?" check~~ | ✅ Shipped Step 2 (2026-05-27) — `isVisiblyChanged` gates the Tier 1 return. 5 unit tests. |
| 3 | **No cost guard on fix-preview** | ⬛ Step 5. 4-finding audit ≈ 4 advisor + 4 inpaint + 8 Browserless renders ≈ $0.02–0.05/audit extra. |
| 4 | **No per-finding timeout in orchestrator** | ⬛ Step 5. A wedged Browserless call can hold the pipeline open for the full Vercel `maxDuration: 300`. |
| 5 | **`AnnotatedFindingPreview` (dashboard) not wired to new columns** | ⬛ Step 4. Only the public `/audit/[id]` uses the slider; the signed-in findings view still shows the old screenshot. |
| 6 | **Browserless connection count doubled** | ⚠️ Low priority. Tier 1 now opens one connection for the before render + one for the pair. Could be collapsed into a single connection if cost becomes a concern. |
| 7 | **No live Browserless blob-upload verification** | ⬛ First prod run will be the real test of the Vercel Blob path. |

---

## 6. Next steps — prioritised

### Step 2 — Perceptual pixel-diff after Tier 1 render ✅ Shipped + hardened 2026-05-27

`isVisiblyChanged(before, after)` (exported from `renderBeforeAfter.ts`) runs after `screenshotPair` and bails to `null` when the after PNG is perceptually indistinguishable from the before. Uses `pixelmatch` v7 + `pngjs` v7.

**Threshold `PIXEL_DIFF_THRESHOLD = 1 000` (≈ 0.09 % of 1280×900 frame)** — raised from the initial 100 after live-verification showed a "ghost case": Vercel's heavily-specific CSS overrides a css-inject mod that has no `!important`, leaving only 172 px of render jitter. 172 > 100 was passing the old check but is invisible to humans. Real visible changes produce ≥ 8 000 px (button re-style) to ≥ 70 000 px (hero card insert). 1 000 cleanly separates noise from signal with a 8× margin.

Live-verification diff counts per before/after pair (post-hardening):

| Site | Finding | px changed | % of frame | Verdict |
|------|---------|-----------|------------|---------|
| stripe.com | link-text-generic | 28 249 | 2.45 % | ✅ VISIBLE |
| stripe.com | hero-hierarchy-inversion | 8 962 | 0.78 % | ✅ VISIBLE |
| iana.org | hero-hierarchy-inversion | 40 696 | 3.53 % | ✅ VISIBLE |
| iana.org | missing-meta-description | 70 144 | 6.09 % | ✅ VISIBLE |

Safe defaults: PNG parse error → `true`, dimension mismatch → `true`.

The live harness uses the same helper instead of byte-equality, so both surfaces agree.

5 unit tests in `__tests__/renderBeforeAfter.test.ts`: identical PNGs, > threshold diff, < threshold ghost (172 px Vercel case), dimension mismatch, invalid PNG. Tests import `PIXEL_DIFF_THRESHOLD` so they track the constant automatically.

**Advisor prompt hardening (same session):**
- `element-insert` mods must give the top-level element a unique `id` (e.g. `id="zb-fix-hero"`) and pair it with companion `css-inject` mods targeting that id for all visual styling — because `sanitizeInsertHtml` strips inline `style` attributes, framework utility classes are useless unless the host site's build includes them.
- All `css-inject` declarations must end with `!important` — without it the host's more-specific selectors win and the change is invisible.
- Stripe hero-hierarchy-inversion run with new prompt: advisor emitted `element-insert` + 5 `css-inject` mods all with `!important`, 8 962 px diff, fully styled brand-tinted quick-answer card visible above hero CTAs.

---

### Step 3 — Apply migration 0023 + flip the flag in Vercel ← START HERE

1. Apply `drizzle/0023_finding_fix_preview.sql` to Neon
2. Vercel env: `AUDIT_FIX_PREVIEW_ENABLED=1`
3. Vercel env: `INPAINT_MODEL=gemini-3.1-flash-image-preview` (or omit — that's the default)
4. Run one real audit through `/audit` end-to-end. Verify:
   - `forge_findings.screenshot_before_url` + `screenshot_after_url` populated
   - `public_audits.findings` JSON has the new fields
   - Report email renders side-by-side images per finding
   - `/audit/[id]` renders the drag-slider

Step 2 is in, so silent Tier 1 no-ops will now degrade to Tier 2 instead of shipping an identical-looking pair.

---

### Step 4 — Wire fix-previews into the signed-in dashboard

`AnnotatedFindingPreview` (`src/app/app/findings/[id]`) still shows the legacy annotated screenshot. After Step 3 ships, point it at `screenshot_before_url` / `screenshot_after_url` and reuse `BeforeAfterSlider` — same component, different mount point.

---

### Step 5 — Cost guard + per-finding timeout

Mirror `aiAdvisorRateLimit.ts`:
- New `phase2_audit_fix_preview_usage` table (orgId, dayUtc, callCount)
- Daily cap — start at 100 audits/day org-wide
- Per-finding wall-clock budget (~25s) inside `runOneFinding` via `Promise.race`

---

### Step 6 — Pixel-diff regression test

After a few real audits have run, snapshot produced PNGs and add a smoke test against a stable fixture URL. Catches Gemini model regressions and Browserless API drift.

---

### Step 7 — Operator review queue (optional)

For the first ~100 audits, gate email delivery on a manual approve in `/admin/ops`. Catches bad Nano Banana 2 outputs before they reach prospects. Disable once you're satisfied with quality at scale.

---

## 7. File map

| File | What | Notes |
|---|---|---|
| `src/lib/audit/fixPreview/auditFixAdvisor.ts` | Tier 1 advisor — `suggestAuditFix`, `buildAuditFixPrompt` | Screenshot-grounded prompt as of Step 1 |
| `src/lib/audit/fixPreview/renderBeforeAfter.ts` | Before+after Browserless render | route() interception (Step 1); `isVisiblyChanged` pixel-diff gate (Step 2) |
| `src/lib/audit/fixPreview/__tests__/renderBeforeAfter.test.ts` | 5 tests — pixel-diff helper | New in Step 2 |
| `src/lib/audit/fixPreview/visionInpaint.ts` | Tier 2 Nano Banana 2 | See §2C gotchas — do not remove the protocol workarounds |
| `src/lib/audit/fixPreview/generateFixPreviews.ts` | Orchestrator | Tier ladder, DI, feature flag |
| `src/lib/audit/fixPreview/types.ts` | `FixPreview`, `FixPreviewTier`, `FixPreviewOutcome` | — |
| `src/lib/audit/fixPreview/index.ts` | Barrel | — |
| `src/lib/audit/fixPreview/__tests__/auditFixAdvisor.test.ts` | 12 tests — prompt, validation, screenshot-grounded language | — |
| `src/lib/audit/fixPreview/__tests__/generateFixPreviews.test.ts` | 9 tests — tier-fallback ladder | Update when Step 2 lands |
| `src/components/audit/BeforeAfterSlider.tsx` | Client drag-slider | — |
| `src/app/api/audit/public/run/route.ts` | Pipeline hook | Search `generateFixPreviews` |
| `src/app/api/audit/public/status/route.ts` | Status surface | Search `PublicFinding` |
| `src/app/audit/[id]/page.tsx` | Public audit page | Renders the slider |
| `src/lib/email/auditReportEmail.ts` | Email template | `fixPreviewRow` |
| `drizzle/0023_finding_fix_preview.sql` | Migration | Apply before flipping the flag |
| `scripts/live-fix-preview.ts` | Live harness | Feeds before-screenshot to advisor as of Step 1 |
| `docs/step1-acceptance-before.png` | Screenshot used in Step 1 live verification | Reference |
| `docs/handover-fix-preview.md` | This doc | — |

---

## 8. Quick commands

```bash
# Run just the fix-preview tests
npx vitest run src/lib/audit/fixPreview

# Full verify (lint + tsc + 1100 tests)
npm run verify

# Live harness against a URL that accepts plain fetches
GEMINI_API_KEY=… npx tsx scripts/live-fix-preview.ts https://iana.org

# Flip on in dev (still needs GEMINI_API_KEY + BROWSERLESS_KEY + BLOB_READ_WRITE_TOKEN)
export AUDIT_FIX_PREVIEW_ENABLED=1

# Optional: upgrade Tier 2 to Nano Banana Pro
export INPAINT_MODEL=gemini-3-pro-image-preview
```

---

## 9. Branch state

**Branch:** `claude/ecstatic-knuth-JPuBz` (continued from `claude/audit-fix-preview-handover-N2TVH`)
**Commits ahead of `main`:**

| Commit | What |
|---|---|
| `bd516c3` | Initial pipeline — auditFixAdvisor, renderBeforeAfter, visionInpaint, orchestrator, migration 0023, BeforeAfterSlider, email, route wiring, tests (19) |
| `29f5084` | Swap Tier 2 to Nano Banana 2 + first live harness |
| `764a405` | Harness reliability — route() interception, base href, UA spoof, timeout widening |
| `8ef5fa0` | First version of this handover doc |
| `d415cb6` | **Step 1** — screenshot-into-advisor + renderer route() port + prompt tightening |
| `af9468a` | AGENTS.md updated with Step 1 live-verified status |
| `8f70531` | Handover doc rewrite — accurate, cold-start-ready, Step 2 implementation sketch |
| _(this session)_ | **Step 2** — perceptual pixel-diff gate (`isVisiblyChanged`) + 5 unit tests + harness alignment |
| _(this session)_ | **Step 2 hardening** — threshold 100→1000 (`PIXEL_DIFF_THRESHOLD`); advisor prompt: `element-insert` id+companion css-inject pattern + mandatory `!important`; live-verified Stripe/IANA |

**Test counts (current):** 26 fix-preview tests (12 advisor + 9 orchestrator + 5 renderer pixel-diff), 1107 full suite.

**Pick up at: §6 Step 3 (apply migration 0023 + flip the Vercel flag).** Step 2 is the last code-only blocker; from here on it's environment work.

---

## 10. Step 1 detailed record

### What changed

**`renderBeforeAfter.ts`**
- `setContent` → `page.route()` + `page.goto(originUrl)`. Intercepts only the main-document response; everything else (CSS/fonts/images) passes through to the live origin.
- `renderBeforeOnly` now returns `fetchedHtml` alongside `beforeBuffer` + `beforeUrl`.
- `renderBeforeAfter` accepts `prefetchedHtml?` — when provided, skips the SSRF fetch.
- Timeout 15s → 25s. `ignoreHTTPSErrors: true`. Desktop UA.

**`generateFixPreviews.ts`**
- Reordered: `renderBeforeOnly` → `suggestAuditFix(screenshot=base64)` → `renderBeforeAfter(prefetchedHtml)`.
- If `renderBeforeOnly` fails: bail to `{ preview: null, reason: 'no-html' }` immediately. No before image → no vision channel, no Tier 2 input, no Tier 3 URL.

**`auditFixAdvisor.ts`** (`buildAuditFixPrompt`)
- "GROUND TRUTH" block: branches on `beforeScreenshotBase64 !== null`. When present: "every selector MUST target an element you can SEE", hash-class warning.
- `availableSelectors` hint list removed from the prompt.

**`scripts/live-fix-preview.ts`**
- Reads the before PNG bytes after render, passes `base64` to `suggestAuditFix`.

### Before → after system behaviour

**Before Step 1:**
1. Advisor got structural data only → invented hash-class selectors.
2. Renderer used `setContent` → unstyled screenshot even when selectors resolved.

**After Step 1:**
1. Renderer produces a real styled before.png via `page.route()` + `page.goto()`.
2. Advisor sees the live page → picks semantic selectors that target visible elements.
3. After render reuses the fetched HTML → saves one SSRF round-trip.

### Verification

- `npx vitest run src/lib/audit/fixPreview` — 21/21.
- `npx vitest run` — 1100/1100, no regressions.
- `npx tsc --noEmit` — clean.
- **Live Gemini API call:** real Chromium screenshot → advisor with screenshot returned `a:not(header a)` (resolves); same advisor without screenshot returned `a.learn-more` (class doesn't exist). Acceptance screenshot: `docs/step1-acceptance-before.png`.

### What Step 1 opened up

1. **Step 2 is now the top blocker.** Route interception produces styled renders — silent no-ops are no longer visually obvious. Pixel-diff is needed to detect them.
2. **Browserless connection count increased.** Now 2 per finding (before + pair) vs 1 before. Not urgent, worth tracking.
3. **Cost guard still ungated.** Step 5 still applies.

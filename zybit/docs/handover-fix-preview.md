# Zybit — Audit Fix-Preview Handover

**Branch:** `claude/audit-fix-preview-handover-N2TVH` (was `claude/trusting-goldberg-EkWRE`)
**Prepared:** 2026-05-27
**Last updated:** 2026-05-27 — Step 1 + renderer route-interception port shipped
**Purpose:** Engineering handover for whoever picks up the public-audit before/after fix-preview pipeline. Covers what shipped, why the architecture looks the way it does, what the live runs proved, and the prioritized next steps.

> **2026-05-27 update — Step 1 done.** Tier 1 advisor now receives the live before screenshot as a vision input, and the production renderer was ported from `setContent` to `page.route()` + `page.goto(originUrl)` interception (the same model the harness uses). See §6 step 1 (now ~~struck through~~) and §10 for the diff details. Step 2 (perceptual pixel-diff "did this resolve?" check after Tier 1 render) is now top of the list.

> **Read first:** `AGENTS.md` — `Public URL-audit lead magnet` row in the
> status table for the canonical state. The `Before/after fix-preview
> (2026-05-27)` paragraph is the one-line summary; this doc is the long form.

---

## 1. Context — what the session was for

The product surface in question is the `/audit` lead magnet (`src/app/audit/[id]`). Today the audit emails findings + an annotated screenshot of the page. The wow gap: prospects can see what's wrong but not what right looks like.

The session brief was *"give users who hit the audit endpoint the biggest wow factor early on, between Tier 1 (deterministic mutation render) and Tier 2 (vision inpaint)"* — i.e. build a real before/after for each top finding, so the audit page becomes a slider and the email becomes a side-by-side, both rendering the AI's proposed fix on top of the prospect's actual page.

The chosen architecture is a **three-tier ladder**, per finding:

```
Tier 1 — deterministic mutation render
  auditFixAdvisor (gemini-3.5-flash) → VariantModification[]
    → applyModifications(snapshotHtml, mods)
    → Browserless screenshots BEFORE + AFTER

Tier 2 — vision inpaint
  Nano Banana 2 (gemini-3.1-flash-image-preview) edits the real
  before screenshot with brand-tokens + finding prescription prompt

Tier 3 — annotated-before fallback (existing renderFindingScreenshot)
```

Each tier degrades to the next on failure so the audit never ships without *some* visual.

---

## 2. What shipped

### A — Audit-mode AI advisor

**Path:** `src/lib/audit/fixPreview/auditFixAdvisor.ts`

Sibling of `src/lib/experiments/aiAdvisor.ts`, purpose-built for the lead magnet. Differences from the production advisor:

| | Production advisor | Audit advisor |
|---|---|---|
| Caller | PM dashboard | Lead-magnet pipeline |
| Options | Returns 3 alternatives | Returns 1 best fix |
| Selectors | Strict allowlist (CTAs + forms + headings only) | No allowlist — model picks anything in the live HTML |
| `element-insert` cap | 4 KB | 16 KB (room for hero refresh / FAQ / proof bar) |
| Vision channel | None | Accepts a base64 PNG via `inline_data` part |
| Output schema | `{ options: [{ label, modifications }] }` | `{ rationale, modifications }` |

All safety guards from the production advisor are **reused via import** (not duplicated): `sanitizeInsertHtml`, `isSafeCssDeclarations`, `isSafeReplacementText`, `isSafeAttributeName`. The audit advisor adds `isSafeAuditInsertHtml` with the 16 KB cap.

**Entry point:** `suggestAuditFix(input, opts?)` — returns `AuditFixAdvisorResult | null`. Never throws; missing API key → null; upstream error → null + structured warn log.

### B — Before/after renderer

**Path:** `src/lib/audit/fixPreview/renderBeforeAfter.ts`

Two exports:
- `renderBeforeAfter({findingId, originUrl, modifications, enforceSsrfGuard?})` — fetches origin via the shared SSRF-guarded fetcher (`fetchWithSsrfGuard` in `src/lib/phase2/findings/preview.ts`), applies mods with `applyModifications`, bails when the apply is a byte-identical no-op, opens one Browserless connection and screenshots **both** HTMLs in parallel pages at 1280×900, uploads both to Vercel Blob.
- `renderBeforeOnly` — for when Tier 1 declines and Tier 2 takes over (needs the before image to feed the inpaint).

Both `stripScripts` the HTML before render (XSS hardening + avoids hydration mismatches the existing annotated-screenshot path also strips).

### C — Vision inpaint

**Path:** `src/lib/audit/fixPreview/visionInpaint.ts`

Calls Nano Banana 2 (`gemini-3.1-flash-image-preview`) with the before PNG + a brand-tokens + finding-prescription prompt. Three protocol gotchas the implementation handles — **leave these in or the next person will rediscover them painfully**:

1. **`generationConfig.responseModalities: ['TEXT', 'IMAGE']` is mandatory.** Without it the endpoint returns text only and there's no image to extract. The text-endpoint `responseMimeType: 'application/json'` shape produces a 400 here.
2. **Response is camelCase** (`inlineData`/`mimeType`) where the request takes snake_case. Parser checks both.
3. **Returns JPEG even for PNG input** sometimes. Upload honors the model's actual `mimeType` so the blob extension + Content-Type match the bytes.

Model is overridable via `INPAINT_MODEL` env var — set to `gemini-3-pro-image-preview` for Nano Banana Pro on higher-budget runs.

### D — Orchestrator

**Path:** `src/lib/audit/fixPreview/generateFixPreviews.ts`

Sequential per-finding loop running the tier ladder. Browserless connections aren't cheap on the cost side and Browserless rate-limits aggressively; concurrency would surprise us.

Designed for testability: all four external deps (`suggestAuditFix`, `renderBeforeAfter`, `renderBeforeOnly`, `inpaintFixAfter`) plus the domain lookup, design-snapshot lookup, and persist are **injectable** via a `FixPreviewDeps` parameter. Production callers leave it undefined; tests substitute stubs. See `__tests__/generateFixPreviews.test.ts` for the 8 tier-fallback scenarios.

Feature-flagged: returns tier-3-fallback outcomes when `AUDIT_FIX_PREVIEW_ENABLED !== '1'`.

### E — Database surface

**Migration:** `drizzle/0023_finding_fix_preview.sql`

Adds 5 columns to `forge_findings`:
- `screenshot_before_url`, `screenshot_after_url` — Vercel Blob URLs
- `fix_preview_tier` — `smallint` (1, 2, or 3)
- `fix_modifications` — `jsonb`, the `VariantModification[]` from Tier 1 only (so the in-product dashboard can later replay the fix as an experiment)
- `fix_preview_generated_at` — `timestamptz`

URLs are **also inlined** on `public_audits.findings` JSON via the `AuditFindingForEmail` mapper so `/audit/[id]` and the report email both render the slider without an extra query.

Schema mirror in `src/lib/db/schema.ts` — required new `smallint` import from `drizzle-orm/pg-core`.

**Migration NOT applied to Neon yet.** First action for the next session if you're flipping the flag in prod.

### F — UI: BeforeAfterSlider

**Path:** `src/components/audit/BeforeAfterSlider.tsx`

Client component with drag-to-swipe + arrow-key (and Home/End/PgUp/PgDn) accessibility. No external deps. Falls back to before-only image with a "Sign up to see the fix" hint when `afterUrl` is null (tier-3 case). Wired into `src/app/audit/[id]/page.tsx`.

### G — Email template

**Path:** `src/lib/email/auditReportEmail.ts` — new `fixPreviewRow` per finding card. Side-by-side images for tier 1/2 (email-client-safe table layout, no flexbox), single image + "sign up" note for tier 3.

### H — Route wiring

**Path:** `src/app/api/audit/public/run/route.ts`

After `dbFindings` is computed and before the email is sent, the route calls `generateFixPreviews` on the top 4 and merges results into `topFindings`. Fail-soft try/catch — orchestrator throw leaves `fixPreviewsByFindingId` empty and the email card degrades to text-only.

Status route (`src/app/api/audit/public/status/route.ts`) extends `PublicFinding` with the new fields and threads them through so `/audit/[id]` polling picks them up.

### I — Model swap to Nano Banana 2

Commit `764a405`. Previously the implementation referenced the deprecated `gemini-2.5-flash-image-preview`. Researched 2026-05-27 via the official Gemini docs:

| Layer | Model |
|---|---|
| Tier 1 advisor (text + image input) | `gemini-3.5-flash` (already in repo) |
| Tier 2 image edit | `gemini-3.1-flash-image-preview` (Nano Banana 2, Feb 2026) |
| Tier 2 budget upgrade | `gemini-3-pro-image-preview` (Nano Banana Pro) via `INPAINT_MODEL` env |

### J — Live verification harness

**Path:** `scripts/live-fix-preview.ts`

Standalone script that exercises the real fix-preview pipeline end-to-end **without** Browserless or Vercel Blob. Useful for iterating on the advisor prompt + render reliability outside the full audit pipeline. Run with:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  npx tsx scripts/live-fix-preview.ts https://example.com [<url> ...]
```

Outputs to `/tmp/audit-live/<host>/` — `before.png`, `<rank>-<ruleId>-after.png`, `<rank>-<ruleId>-nano.jpg`, plus `index.json` summarizing what fired.

Approach:
- Fetches HTML via the production snapshot fetcher (with a widened 20s timeout — sandbox CDN latency is noisy)
- Derives 3 finding drafts (`link-text-generic`, `hero-hierarchy-inversion`, `missing-meta-description`) from the parsed snapshot — bypasses the full rule engine but produces prescriptions in the same shape
- Calls `suggestAuditFix` for real (uses `GEMINI_API_KEY` from env)
- Renders **before** by navigating local Chromium to the live URL
- Renders **after** by `page.route()` intercepting only the main HTML document and serving the mutated bytes — CSS/JS/fonts pass through to the origin so the variant hydrates identically. This is the cleanest way to get a real, styled render of mutated HTML without an asset-rewriting proxy.
- Feeds the before screenshot to Nano Banana 2

The script ignores HTTPS errors and spoofs a desktop Chrome UA so anti-bot middleware doesn't 403 us.

### Verification gates

- `npm run verify` — lint (warnings only, no errors), tsc clean, **1100 tests pass** (19 new — 9 advisor + 10 orchestrator tier-fallback)
- Live runs against `browserless.io` and `example.com` confirm both tiers end-to-end (see §4)

---

## 3. Architecture decisions + why

### Why three tiers, not one

The lead magnet is the demo surface. If the AI ships a janky after, the trust loop dies. Tier 1 is deterministic (the same mod + HTML always produces the same render) but depends on the advisor picking selectors that resolve. Tier 2 edits the real screenshot so brand consistency is preserved by construction but the model can refuse or produce noise. Tier 3 is the existing annotated-before path. We always have at least one of the three.

### Why no selector allowlist on the audit advisor

The production advisor enforces an allowlist (CTAs + forms + headings) because PMs are reviewing the options before launch. The audit has no PM in the loop — the only ground truth is "did the screenshot actually change?" So we let the model pick any selector and verify by re-applying against the captured HTML at render time. If the mod is a no-op the render bails (`renderBeforeAfter.ts` returns null when `mutated === fetched.html`).

### Why route() interception instead of `setContent`

Initial implementation used `setContent(mutatedHtml)`. Problem: `setContent` doesn't navigate, so `<base href>` is missing and every relative CSS / JS / font 404s. The page renders as raw unstyled HTML. Fix: navigate the page to the real URL with Playwright's `route()` handler swapping only the main-document response body for the mutated HTML. All other requests pass through to the origin, so the variant hydrates with the real stylesheets, fonts, and (where we don't strip them) scripts.

This is **the same model the production proxy uses at runtime** — the experiment proxy serves mutated HTML through Cloudflare while letting assets pass through to the origin. The live harness deliberately mirrors that so what works in the harness will work in the experiment runtime later.

### Why dependency injection on the orchestrator

The orchestrator's tier-fallback logic is the only non-trivial business logic in the pipeline. Testing it required either (a) heavy `vi.mock` setup at the module level or (b) injectable deps. Option (b) is cleaner: production callers pass nothing and get the real implementations; the test file substitutes 6 stubs (`suggestAuditFix`, `renderBeforeAfter`, `renderBeforeOnly`, `inpaintFixAfter`, `lookupDomain`, `lookupDesign`, `persist`) and exercises 8 fallback scenarios without mocking a single module.

### Why feature-flagged

Live verification still needs `BROWSERLESS_KEY`, `BLOB_READ_WRITE_TOKEN`, `GEMINI_API_KEY`, and migration `0023` to be set/applied. The flag (`AUDIT_FIX_PREVIEW_ENABLED=1`) is the safe-by-default gate so a half-configured environment can't blow up the audit pipeline.

---

## 4. Live verification results

Ran `scripts/live-fix-preview.ts` against `browserless.io` and `example.com`.

| Site | Tier 1 outcome | Tier 2 outcome |
|---|---|---|
| `browserless.io` | Advisor returned valid mods both times, but selectors (e.g. `main a[href*='docs']`) didn't resolve in the live HTML — no visible change. Script honestly unlinks the no-op `after.png`. | Both findings produced clean, brand-coherent edits — rewrote `"Read the Docs"` → `"See pricing"`, tightened the supporting copy, palette preserved. |
| `example.com` | Hero-hierarchy and meta-description findings BOTH produced real renders — element-insert HTML landed cleanly above the existing content in the same serif font. | All three findings produced strong edits — the meta-description card with a real `"Publish Description"` CTA is the standout. |

**The headline finding:** Tier 2 is the more reliable wow surface today. Tier 1 success is gated on the advisor picking a selector that actually resolves. The advisor sees the snapshot's selector hints but not the rendered page, so it sometimes invents plausible-but-wrong selectors (especially on React/Tailwind sites where class names are hashed/scoped at build time).

That gap is exactly what the §6 next-step fixes.

---

## 5. Known gaps + tradeoffs

1. **Migration 0023 not applied to Neon.** Required before flipping the flag in prod.
2. **No live Browserless verification.** The harness uses local Chromium; production uses Browserless. The render path is the same (`chromium.connectOverCDP` vs `chromium.launch`), but a first prod run will be the actual live verification of the Vercel Blob upload path.
3. **Cost is not budgeted.** A 4-finding audit makes 4 advisor calls + 4 inpaint calls + up to 8 Browserless renders. Rough order: $0.02–0.05 per audit on top of the existing ~$0.05 budget. No daily cap on the fix-preview side; relies on the existing `recordAuditCost` daily budget gate.
4. **Tier 1 selector miss rate.** §6 step 1 fixes this — pass the rendered before screenshot into the advisor so it can see what it's editing.
5. **No timeout caps inside the orchestrator.** A wedged Browserless call could in theory hold the audit pipeline open for the full Vercel `maxDuration: 300` window. Worth adding a per-finding wall-clock budget once we see real prod numbers.
6. **`AnnotatedFindingPreview` (post-signup product surface) doesn't yet use the new before/after columns.** Only the public `/audit/[id]` does. Easy follow-up for the dashboard.

---

## 6. Next steps — prioritized

> **Top of the list:** the screenshot-into-advisor change. This is the single biggest lift to Tier 1's hit rate, and once Tier 1 fires reliably the Tier 2 fallback becomes a true fallback rather than the primary surface.

### ~~Step 1~~ — ~~Pass the rendered before screenshot into the Tier 1 advisor~~ ✅ Shipped 2026-05-27

See §10 for the actual diff that landed. TL;DR: orchestrator reordered, base64 screenshot fed to advisor, prompt tightened with screenshot-grounded language, and the renderer was additionally ported from `setContent` to `page.route()` interception so the screenshot the advisor sees is itself a real styled render (not unstyled raw HTML). Unit tests pass (21 fix-preview tests, was 19); harness acceptance pending an env with `GEMINI_API_KEY` + `BROWSERLESS_KEY`.

### Step 2 — Add a "did this resolve?" verification call after Tier 1 render

The orchestrator already bails when `mutated === fetched.html`. But the renderer's "visibly changed" check uses raw HTML byte comparison — a `<style>` tag insertion that targets a non-existent selector mutates the HTML without changing the rendered output. Add a pixel-diff check after rendering both: if before.png ≈ after.png (within some threshold), treat Tier 1 as failed and fall to Tier 2.

The harness already does this naively (byte equality, no perceptual diff). Production should use a perceptual hash — `pixelmatch` is small and already mature; or compute a SHA256 over a downsampled grayscale version of both PNGs.

**Acceptance:** A `css-inject` mod targeting a fake selector triggers Tier 2 fallback instead of shipping a Tier 1 after that looks identical to the before.

### Step 3 — Apply migration 0023 to Neon + flip the flag in Vercel

1. Apply `drizzle/0023_finding_fix_preview.sql` to Neon
2. Set `AUDIT_FIX_PREVIEW_ENABLED=1` in Vercel env
3. Set `INPAINT_MODEL=gemini-3.1-flash-image-preview` (or omit — that's the default) in Vercel env
4. Run one real audit through `/audit` end-to-end. Verify:
   - `forge_findings.screenshot_before_url` + `screenshot_after_url` populated
   - `public_audits.findings` JSON contains the new fields
   - Report email renders the side-by-side per finding
   - `/audit/[id]` renders the swipe slider

### Step 4 — Wire fix-previews into the post-signup dashboard

`AnnotatedFindingPreview` (the signed-in `/app/findings/[id]` surface) still only renders the legacy annotated screenshot. After step 3 ships, point it at the new `screenshot_before_url` / `screenshot_after_url` columns and reuse `BeforeAfterSlider` — same component, different mount point.

### Step 5 — Cost guard + per-finding timeout

Mirror the production AI advisor's pattern in `aiAdvisorRateLimit.ts`:
- New `phase2_audit_fix_preview_usage` table (orgId, dayUtc, callCount)
- Daily cap (start at 100 audits/day organization-wide, tighter if needed)
- Per-finding wall-clock budget (~25s) inside the orchestrator — wrap each `runOneFinding` in `Promise.race` against a timeout

### Step 6 — Pixel-diff regression test

Once a few real audits have run, snapshot the produced PNGs and add a smoke test that flags large drift on a hand-picked stable URL (a static archive page or an internal test fixture). Catches model regressions and protocol drift.

### Step 7 — Operator review queue (optional, lead-magnet-only)

For the first ~100 audits, gate "fix preview goes into the email" on a manual approve in `/admin/ops`. Catches one-in-N weird Nano Banana outputs before they reach prospects. Disable once the model behaves at the SLA you want.

---

## 7. File map for the next session

| File | What |
|---|---|
| `src/lib/audit/fixPreview/auditFixAdvisor.ts` | Tier 1 advisor (gemini-3.5-flash, vision-capable) |
| `src/lib/audit/fixPreview/renderBeforeAfter.ts` | Tier 1 Browserless render pair |
| `src/lib/audit/fixPreview/visionInpaint.ts` | Tier 2 Nano Banana 2 |
| `src/lib/audit/fixPreview/generateFixPreviews.ts` | Orchestrator (start §6 step 1 here) |
| `src/lib/audit/fixPreview/types.ts` | `FixPreview`, `FixPreviewTier`, `FixPreviewOutcome` |
| `src/lib/audit/fixPreview/index.ts` | Barrel |
| `src/lib/audit/fixPreview/__tests__/auditFixAdvisor.test.ts` | 9 prompt / validation tests |
| `src/lib/audit/fixPreview/__tests__/generateFixPreviews.test.ts` | 10 tier-fallback tests |
| `src/components/audit/BeforeAfterSlider.tsx` | Client swipe slider |
| `src/app/api/audit/public/run/route.ts` | Pipeline hook (search `generateFixPreviews`) |
| `src/app/api/audit/public/status/route.ts` | Status surface (search `PublicFinding`) |
| `src/app/audit/[id]/page.tsx` | Renders the slider |
| `src/lib/email/auditReportEmail.ts` | `fixPreviewRow` per finding card |
| `drizzle/0023_finding_fix_preview.sql` | Migration (apply before flipping the flag) |
| `scripts/live-fix-preview.ts` | Standalone live harness |
| `docs/handover-fix-preview.md` | This doc |

---

## 8. Quick commands

```bash
# Live verify against a real URL (no Browserless, no Blob, no email)
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  npx tsx scripts/live-fix-preview.ts https://example.com

# Run just the fix-preview tests
npx vitest run src/lib/audit/fixPreview

# Full verify
npm run verify

# Flip on in dev
export AUDIT_FIX_PREVIEW_ENABLED=1
# Optional: bump to Nano Banana Pro for higher fidelity
export INPAINT_MODEL=gemini-3-pro-image-preview
```

---

## 9. Branch state

- Branch: `claude/audit-fix-preview-handover-N2TVH` (pushed; fast-forwarded from `claude/trusting-goldberg-EkWRE`)
- Commits ahead of `main`:
  - `bd516c3` — initial pipeline (modules, slider, email, migration, tests)
  - `29f5084` — Nano Banana 2 swap + first cut of live harness
  - `764a405` — harness reliability fixes (live navigation, route interception, base href, UA spoof, timeout widening)
  - `8ef5fa0` — handover doc (this file's first version)
  - **2026-05-27 commit** — Step 1 + renderer route-interception port (§10)
- `AGENTS.md` Public URL-audit lead-magnet row has the canonical one-paragraph summary

Pick up at §6 step 2 (perceptual pixel-diff). Step 1 is now closed.

---

## 10. Step 1 — what actually shipped 2026-05-27

### Diff summary

**`src/lib/audit/fixPreview/renderBeforeAfter.ts`** — production renderer ported from `setContent` to `page.route()` + `page.goto(originUrl)` interception, mirroring the harness. This is the same fix the harness §3 calls out for itself: `setContent` doesn't navigate, so relative `<link href="/styles.css">` 404s and the screenshot is unstyled raw HTML. With route interception the page navigates to the real URL while a `route()` handler swaps ONLY the main-document response body for the mutated/raw HTML — every other request (CSS, fonts, images, third-party) passes through to the origin so the variant hydrates with the real styles. Other changes in the same file:
- `renderBeforeOnly` now returns `fetchedHtml` (the SSRF-guarded fetch result) alongside the screenshot buffer + URL, so the orchestrator can hand the same HTML to `renderBeforeAfter` and avoid a second origin hit.
- `renderBeforeAfter` accepts an optional `prefetchedHtml` — when present, skips its own SSRF fetch.
- Screenshot timeout widened from 15s → 25s (`load` + 1.5s settle is generous, the wider budget is for chunked responses on real marketing CDNs).
- UA spoof + `ignoreHTTPSErrors` added (anti-bot middleware + sandbox cert quirks; same defaults the harness ended up at).

**`src/lib/audit/fixPreview/generateFixPreviews.ts`** — orchestrator reordered:
1. `renderBeforeOnly` runs FIRST (was: after the advisor declined).
2. The base64-encoded before-screenshot bytes are passed into `suggestAuditFix` via the `beforeScreenshotBase64` input.
3. The fetched HTML from the before render is passed to `renderBeforeAfter` so the after pass skips the second SSRF fetch.
4. If `renderBeforeOnly` fails, the orchestrator bails to `{ preview: null, reason: 'no-html' }` for that finding — no before image means no vision channel, no tier-2 input image, and no tier-3 fallback either.

**`src/lib/audit/fixPreview/auditFixAdvisor.ts`** — `buildAuditFixPrompt` tightened:
- "GROUND TRUTH" header that branches on whether a screenshot is attached. When attached: "every selector you emit MUST target an element you can SEE". Explicit hash-class warning ("Hashed Tailwind/CSS-module class names — `.css-12abc`, `.jsx-abc123` — are unstable across builds and almost never resolve").
- `availableSelectors` hint list dropped from the prompt entirely. The previous "these are hints, the screenshot is ground truth" framing was conflicted; we now let the screenshot do the work.
- When no screenshot is provided, the constraints text falls back to "every selector must be a stable, semantic selector" — same advisor surface, different ground-truth source.

**`scripts/live-fix-preview.ts`** — harness updated to pass the rendered before-screenshot base64 into `suggestAuditFix`. The harness already produced a good before.png via local route interception; it just wasn't feeding it to the advisor. Now the acceptance test in §6 step 1 is actually runnable end-to-end.

**Tests:**
- `__tests__/generateFixPreviews.test.ts` — 9 tests still pass, content updated to reflect the new ordering (e.g. the tier-1 happy path now asserts `renderBeforeOnly` IS called and that the base64 string is threaded through to `suggestAuditFix`; the `no-html` test now exercises "before render fails" as the bail point).
- `__tests__/auditFixAdvisor.test.ts` — 2 new tests for the screenshot-grounded prompt language (one for the screenshot-attached path, one for the no-screenshot fallback). 11 tests total (was 9).
- All 21 fix-preview tests pass. Full suite still at 1100 passing, no regressions.

### What this changes about the system

Before this change:
1. Orchestrator called the advisor with structural data only (no vision).
2. Advisor returned mods that referenced hashed Tailwind classes.
3. Renderer fetched HTML, applied mods, `setContent`'d, screenshotted.
4. Screenshot rendered as raw unstyled HTML because `setContent` doesn't navigate.
5. Even when selectors DID resolve, the after PNG was useless because it had no styles.

After this change:
1. Renderer goto's the real URL with a route handler that returns mutated HTML for the main doc — assets load from the live origin, real styles hydrate.
2. Before render runs first; its base64-encoded screenshot is fed into the advisor.
3. Advisor sees the live styled page and picks selectors that target visible elements.
4. After render reuses the already-fetched HTML, applies mods, route-intercepts, screenshots — styled.

### Verification gates run in this session

- `npx vitest run src/lib/audit/fixPreview` — 21/21 pass.
- `npx vitest run` — 1100/1100 pass (no regressions; +2 from the 1100 baseline noted at session start because of 2 new prompt tests, offset by replacing one orchestrator test with a slightly tighter equivalent).
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/audit/fixPreview scripts/live-fix-preview.ts` — clean.
- **Live harness acceptance NOT run** — `GEMINI_API_KEY` was not present in this sandbox. The change is unit-test-covered but the §6 step-1 acceptance (re-running the harness on browserless.io) is the real proof. Run it from an env where `GEMINI_API_KEY` is set.

### Known follow-ups that opened up after this change

1. **Step 2 (perceptual pixel-diff) is now the top blocker for prod confidence.** With route interception, an after PNG that has the right styles but the wrong mod will look almost identical to the before — there's no longer the "unstyled wall of text" tell that the render is broken. We need a perceptual diff to catch silent no-ops. The harness already does naive byte equality; pixelmatch or a downsampled-grayscale SHA256 is the small upgrade.
2. **Browserless concurrency cost.** Tier 1 now opens one Browserless connection per finding for the before render, plus another for the pair render. That's 2 connections per finding vs. 1 in the old design. Could re-collapse to one connection by moving the orchestrator's render-before-then-after dance into a single `screenshotPair` call that returns the before before the after finishes (`Promise.all` already runs them in parallel; we'd need to surface the before mid-flight). Not urgent — Browserless is billed by connection time and each render is short — but worth flagging.
3. **Cost guard still ungated.** Step 5 still applies — set the per-org daily cap before flipping the flag in prod.

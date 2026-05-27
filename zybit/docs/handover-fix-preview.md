# Zybit — Audit Fix-Preview Handover

**Branch:** `claude/trusting-goldberg-EkWRE`
**Prepared:** 2026-05-27
**Commits this session:** `bd516c3`, `29f5084`, `764a405`
**Purpose:** Engineering handover for whoever picks up the public-audit before/after fix-preview pipeline. Covers what shipped, why the architecture looks the way it does, what the live runs proved, and the prioritized next steps — starting with the screenshot-into-advisor change that will materially lift Tier 1's hit rate.

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

### Step 1 — Pass the rendered before screenshot into the Tier 1 advisor

**Why:** Today the advisor sees structured snapshot data (selectors, design tokens, CTA vocabulary) but not the rendered page. On hash-class CSS frameworks (Tailwind/Emotion/CSS-Modules — the majority of modern marketing sites) it invents selectors that look plausible against the snapshot but don't resolve against the live HTML. Giving it the screenshot lets it cross-check: it can SEE the hero button, the nav, the copy, and pick selectors that map to elements actually present in the page it just looked at.

`auditFixAdvisor.ts` already accepts a `beforeScreenshotBase64` field in `AuditFixAdvisorInput` and threads it through the multimodal `callAuditAdvisor`. Today the orchestrator passes `null`. The change is plumbing.

**Implementation:**

1. **Reorder the orchestrator so the before render runs first** (`src/lib/audit/fixPreview/generateFixPreviews.ts`, `runOneFinding`):
   - Call `renderBeforeOnly` BEFORE `suggestAuditFix`
   - Pass `before.beforeBuffer.toString('base64')` as `beforeScreenshotBase64`
   - Reuse the before buffer for Tier 2 (don't render twice)
   - If `renderBeforeOnly` fails → bail to no-preview outcome (we have no before either way)
2. **Update Tier 1 path** to call `renderBeforeAfter` with the already-fetched HTML rather than re-fetching. This is a small `renderBeforeAfter` API change: take an optional pre-fetched HTML so the second call doesn't re-hit the origin.
3. **Tighten the advisor prompt** in `auditFixAdvisor.ts` (`buildAuditFixPrompt`):
   - Add a line that explicitly tells the model "the screenshot below shows the live page — use selectors that target elements you can SEE in the screenshot"
   - Remove or de-emphasize the `availableSelectors` hint list — let the screenshot be the ground truth
4. **Update the orchestrator's `suggestAuditFix` call** to pass the rendered base64.

Estimated diff: ~80 lines + 1–2 test updates. Per-finding cost goes up by 1 Browserless screenshot (already happening for Tier 2; just moves earlier).

**Acceptance:** Re-run `scripts/live-fix-preview.ts` against the same browserless.io URL the harness flagged today. Tier 1 should produce visible-change `after.png` for both findings (it produced zero today).

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

- Branch: `claude/trusting-goldberg-EkWRE` (pushed)
- Three commits ahead of `main`:
  - `bd516c3` — initial pipeline (modules, slider, email, migration, tests)
  - `29f5084` — Nano Banana 2 swap + first cut of live harness
  - `764a405` — harness reliability fixes (live navigation, route interception, base href, UA spoof, timeout widening)
- `AGENTS.md` Public URL-audit lead-magnet row has the canonical one-paragraph summary as of 2026-05-27

Pick up at §6 step 1. The orchestrator refactor is the single highest-leverage change.

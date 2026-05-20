# Sprint 3 — Design Capture & AI Variant Advisor

**Duration:** 3 weeks
**Goal:** PM goes from finding → AI-drafted variant options grounded in their real design system → launch in under 10 minutes. This is the product's main differentiator sprint.

**Architecture decisions locked (do not re-litigate):**
- Visual picker = DOM tree view + Browserless screenshot thumbnail. No iframe embedding (CSP/CORS).
- Design capture degraded mode = AI advisor still runs with `captureMethod: 'structural'` flag. PM sees "Visual confidence: limited."
- AI output constrained to `VariantModification[]` schema with selectors from the snapshot only.
- PM approval before anything deploys. No autonomous action.

---

## Gate criteria

- [ ] Full-fidelity DesignCapture running on Browserless and storing to Vercel Blob
- [ ] `phase2_site_design_snapshot` table populated for all active sites
- [ ] AI Variant Advisor generating 3 schema-valid modifications per finding
- [ ] DOM tree picker live with thumbnail — selector selection working
- [ ] Side-by-side preview shows control vs. selected variant before launch
- [ ] Degraded-mode flag surfaced in UI when computed styles unavailable

---

## Zybit-141 — `phase2_site_design_snapshot` schema + migration
**Estimate:** 0.5d | **Owner:** —

**What:** New table to store full-fidelity design capture results alongside the existing structural snapshot.

```sql
phase2_site_design_snapshot (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siteId      UUID NOT NULL REFERENCES phase1_sites(id),
  pathRef     TEXT NOT NULL,
  capturedAt  TIMESTAMPTZ NOT NULL,
  captureMethod  TEXT NOT NULL CHECK (captureMethod IN ('full', 'structural')),
  screenshotUrl  TEXT,                    -- Vercel Blob URL
  computedStyles JSONB,                   -- per-element computed styles
  designTokens   JSONB,                   -- extracted color, type, spacing tokens
  cssSystem      TEXT,                    -- from parser (tailwind/styled-components/etc)
  UNIQUE (siteId, pathRef)
)
```

**Files:** `src/lib/db/schema.ts`, new migration in `drizzle/`

---

## Zybit-142 — Full-fidelity DesignCapture via Browserless
**Estimate:** 3d | **Owner:** —

**What:** New capture module that uses Browserless to take a full-page screenshot and extract computed styles for key elements, storing results in `phase2_site_design_snapshot`. Screenshots stored in Vercel Blob — free tier includes 5 GB storage and 10 GB bandwidth/month; at ~200 KB per screenshot this supports ~25,000 pages before needing a paid plan.

**Data to extract per page:**
- Full-page screenshot → Vercel Blob (`@vercel/blob`)
- Per-element computed styles for all `data-zybit-ref` CTAs and headings:
  - `color`, `background-color`, `font-size`, `font-weight`, `font-family`
  - `padding`, `margin`, `border-radius`, `box-shadow`
  - Bounding box: `x, y, width, height` (from `getBoundingClientRect`)
- Page-level tokens: `document.body` background, primary text color from first `<p>`
- CSS framework: passed through from structural parser's `cssSystem`

**Degraded mode:** If Browserless fails or token is unavailable, set `captureMethod: 'structural'`, `screenshotUrl: null`, `computedStyles: null`. Store what we have. AI advisor reads `captureMethod` from this record.

**New file:** `src/lib/phase2/snapshots/designCapture.ts`
**Files also:** `src/lib/phase2/snapshots/index.ts` (wire into snapshot pipeline), `vercel.json` (add to nightly refresh cron)

---

## Zybit-143 — Design token extraction
**Estimate:** 1.5d | **Owner:** —

**What:** From computed styles, derive a compact token set that represents the site's design language. This is what the AI advisor uses as its design system context.

**Token extraction rules:**
- Primary color: most common `background-color` across CTA elements
- Secondary color: most common `color` across heading elements  
- Accent color: any `border-color` or `outline-color` not matching primary/secondary
- Font family: `font-family` from `h1` element
- Type scale: sorted unique `font-size` values from headings + body
- Border radius: most common `border-radius` from CTA elements
- Spacing unit: GCD of all `padding-top` values (approximates base spacing)
- CTA vocabulary: text content of all CTA elements (for copy register)

Store as `designTokens` jsonb. Format example:
```json
{
  "primaryColor": "#1a56db",
  "fontFamily": "Inter, sans-serif",
  "typeScale": [14, 18, 24, 36, 48],
  "borderRadius": "8px",
  "ctaVocabulary": ["Get started", "Start free trial", "Book a demo"]
}
```

**Files:** `src/lib/phase2/snapshots/designCapture.ts` (extend), `src/lib/phase2/snapshots/tokenExtractor.ts` (new)

---

## Zybit-144 — AI Variant Advisor API route
**Estimate:** 3d | **Owner:** —

**What:** The core AI call. Takes a finding + design capture data and returns 3 pre-built modification options.

**Endpoint:** `POST /api/dashboard/experiments/ai-suggest`
**Auth:** Magic-link session, org-scoped

**Request:**
```ts
{ findingId: string }
```

**Process:**
1. Load finding (prescription, evidence, pathRef, refs.snapshotId)
2. Load structural snapshot (selectors, headings, CTAs)
3. Load design capture for this pathRef (`captureMethod`, `designTokens`, `computedStyles`, `screenshotUrl`)
4. Build prompt (see below)
5. Call Gemini API (`gemini-2.0-flash` — fast and cheap; this is a non-critical creative assist). Use `@google/generative-ai` SDK.
6. Parse response as `VariantModification[][]` (3 arrays of modifications, one per option)
7. Validate each modification against the schema; drop invalid ones
8. Validate each selector exists in the snapshot's element list; drop or flag unknown selectors
9. Return `{ options: Array<{ label: string; modifications: VariantModification[]; confidence: 'high' | 'low' }> }`

**Prompt structure (locked):**
```
You are generating A/B test modifications for a production website.

DESIGN SYSTEM (extracted from the real site):
${JSON.stringify(designTokens)}

CSS FRAMEWORK: ${cssSystem}
CAPTURE METHOD: ${captureMethod}  // 'structural' → less visual context available
${captureMethod === 'structural' ? 'Note: computed styles unavailable. Base CSS on design tokens and site patterns.' : ''}

KEY ELEMENT COMPUTED STYLES:
${JSON.stringify(computedStyles ?? 'unavailable')}

FINDING:
Rule: ${finding.ruleId}
What to change: ${prescription.whatToChange}
Why it works: ${prescription.whyItWorks}
Variant description: ${prescription.experimentVariantDescription}

AVAILABLE SELECTORS (use ONLY these):
${JSON.stringify(availableSelectors)}

MODIFICATION SCHEMA (output ONLY valid instances of these types):
${JSON.stringify(variantModificationSchema)}

Generate exactly 3 different modification options that implement this finding.
Each option must use selectors from the AVAILABLE SELECTORS list only.
Return a JSON array of 3 arrays. Each inner array is one option's modifications.
Return JSON only — no explanation, no markdown.
```

**Files:**
- `src/app/api/dashboard/experiments/ai-suggest/route.ts` (new)
- `src/lib/experiments/aiAdvisor.ts` (new — prompt builder + response parser + validator)
- Add `@google/generative-ai` to `package.json`; env var: `GEMINI_API_KEY`

---

## Zybit-145 — AI Variant Advisor UI
**Estimate:** 2d | **Owner:** —

**What:** Surface the 3 AI-drafted options in the experiment builder. PM picks one (or skips to manual entry).

**UI flow:**
1. Experiment builder page loads → if design capture exists for this pathRef, show "AI suggestions loading..." spinner
2. Call `/api/dashboard/experiments/ai-suggest` client-side after initial render
3. Render 3 cards: each shows `label`, a preview description of what will change, and a "Use this" button
4. If `captureMethod === 'structural'`: show amber badge "Visual confidence: limited — Zybit hasn't captured computed styles for this page yet"
5. "Use this" → populates the manual form fields below with the option's modifications (selector, change type, new value)
6. PM can still edit before saving
7. "Build manually instead" link always visible — AI suggestions are an enhancement, not a gate

**Files:**
- `src/app/app/findings/[id]/experiment/page.tsx`
- `src/components/app/AiVariantAdvisor.tsx` (new)
- `src/components/app/ExperimentBuilderForm.tsx` — accept pre-filled values from advisor selection

---

## Zybit-146 — DOM tree element picker with screenshot thumbnail
**Estimate:** 7d | **Owner:** —

**Context:** No iframe embedding — CORS and CSP make that path unreliable. Instead: screenshot thumbnail (Browserless, stored in Vercel Blob) alongside a collapsible DOM element tree. PM clicks an element in the tree → selector populates in the builder form → thumbnail highlights the selected element.

**Steps:**
1. The screenshot URL is already stored in `phase2_site_design_snapshot.screenshotUrl` (Zybit-142)
2. Build `ElementTree` component:
   - Render a collapsible tree from the snapshot's `headings`, `ctas`, `forms`, `landmarks` data
   - Each node shows: element tag, text preview (truncated 50 chars), landmark context
   - Click → `onSelectSelector(selector)` callback → fills selector field in `ExperimentBuilderForm`
3. Thumbnail highlight: on element select, draw a semi-transparent orange box overlay on the screenshot at the element's bounding box coordinates (from `computedStyles[ref].boundingBox`). Use a `<canvas>` overlay on top of the `<img>` tag.
   - If no bounding box available (structural-only capture) → highlight is skipped; show text note "Element position unavailable"
4. Layout: screenshot thumbnail (fixed width, right column) + element tree (left column, scrollable). Mobile: tree above thumbnail.
5. "Pick from page" toggle shows the picker; "Type selector manually" toggle hides it

**Files:**
- `src/components/app/ElementPicker.tsx` (new)
- `src/components/app/ScreenshotThumbnail.tsx` (new — canvas overlay logic)
- `src/app/app/findings/[id]/experiment/page.tsx` — integrate picker

**Acceptance:** PM can select any CTA or heading from the tree and see the selector populate. Bounding-box highlight shown on screenshot when computed styles available. Picker fully usable without Browserless if structural snapshot exists.

---

## Zybit-147 — Side-by-side live preview while editing
**Estimate:** 2d | **Owner:** —

**What:** Re-use the existing preview iframe infrastructure. As PM edits the modification fields, debounce and POST to the preview route to show control vs. variant side-by-side in real time.

**Details:**
- Debounce: 800ms after last change to selector or new value
- Preview route already exists at `/api/preview/[experimentId]` — create an ephemeral preview endpoint that accepts modifications without requiring a saved experiment: `POST /api/preview/ephemeral` with `{ siteId, pathRef, modifications }`
- Side-by-side: control iframe (unmodified) | variant iframe (with modifications applied)
- "Preview unavailable" state if snapshot fetch fails (non-fatal)

**Files:**
- `src/app/api/preview/ephemeral/route.ts` (new)
- `src/components/app/ExperimentBuilderForm.tsx` — add preview panel
- `src/components/app/PreviewPanel.tsx` (new)

---

## Zybit-148 — Rate limiting + cost guard for AI advisor
**Estimate:** 0.5d | **Owner:** —

**What:** Prevent runaway AI API costs. Simple controls.

- Max 10 AI suggestions per org per day (enforced in `/api/dashboard/experiments/ai-suggest` via the rate-limits table from Zybit-115)
- Log token usage per call to structured logger for cost tracking
- If over limit: return 429 with "AI suggestion limit reached for today — build manually or try again tomorrow"

**Files:** `src/app/api/dashboard/experiments/ai-suggest/route.ts`, `src/lib/observability/logger.ts`

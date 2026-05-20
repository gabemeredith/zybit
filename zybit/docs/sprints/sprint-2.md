# Sprint 2 — Selector Robustness

**Duration:** 1.5 weeks
**Goal:** A customer's experiment never silently breaks after they redeploy their site. PM is warned before they discover a broken test through bad data.

---

## Gate criteria

- [ ] Selector staleness cron detects and emails PM on 0-match selectors
- [ ] Stable selector ranking surfaced in suggestion dropdown
- [ ] Snapshot drift dashboard visible in cockpit

---

## Zybit-133 — Selector staleness cron
**Estimate:** 3d | **Owner:** —

**What:** Nightly job re-fetches each live experiment's target page, re-runs selector match against the fresh snapshot, and emails PM if match count drops to 0.

**Key details:**
- Only runs for experiments with `status: 'running'`
- Re-fetch uses same `snapshotMethod` as the original capture (HTTP or Browserless)
- Match algorithm: same `selectorMatcher.ts` built in Sprint 1
- On 0 matches: set `selectorStale: true` on experiment record, send Resend email ("Your experiment's target element may have moved — check the selector before results are affected"), surface amber badge on experiment detail page
- On match restored (was stale, now matches): clear flag, send recovery email
- Cron: nightly at 3am UTC, defined in `vercel.json`

**Files:** `src/app/api/phase2/cron/check-selector-staleness/route.ts` (new), `src/lib/db/schema.ts` (add `selectorStale` bool to `forge_experiments`), `src/lib/email/selectorStaleEmail.ts` (new), `vercel.json`

---

## Zybit-134 — Stable selector ranking in suggestion dropdown
**Estimate:** 2d | **Owner:** —

**What:** The "Suggest" dropdown in `ExperimentBuilderForm` currently lists selectors in snapshot order. Rank them by stability so the best selectors surface first.

**Stability tiers (highest to lowest):**
1. `[data-zybit-ref="..."]` — injected by Zybit parser, stable across deploys
2. `#id` — stable if site uses semantic IDs
3. Semantic tag + known landmark context (`header button`, `main h1`)
4. Class-based — if CSS system is `tailwind` (utility classes are stable)
5. Class-based — if CSS system is `styled-components`/`emotion`/`css-modules-hashed` (fragile — labeled "⚠ may break on redeploy")
6. Positional (`nth-of-type`) — labeled "positional — use with care"

**Files:** `src/app/app/findings/[id]/experiment/page.tsx` (`buildSuggestions` function), `src/components/app/ExperimentBuilderForm.tsx`

---

## Zybit-135 — Snapshot drift dashboard
**Estimate:** 2d | **Owner:** —

**What:** Per-site view in the cockpit showing snapshot health: how old the snapshot is, whether content hash has changed since last insights run, and how many running-experiment selectors are currently stale.

**UI:** A collapsible "Snapshot health" card in `CockpitView.tsx`:
- "Last captured: 2 days ago" with refresh button
- "Content changed since last insights run: Yes / No" (compare `contentHash` on snapshot vs. `lastInsightsAt` timestamp)
- "Selector warnings: 2 experiments may have broken selectors" (link to experiment detail)

**Files:** `src/app/api/dashboard/status/route.ts` (add snapshot health fields), `src/components/app/CockpitView.tsx`

---

## Zybit-136 — `data-zybit-ref` injection audit
**Estimate:** 1d | **Owner:** —

**What:** The parser injects `data-zybit-ref` on CTAs during snapshot. Verify this actually makes it into the stored snapshot data and that the proxy preserves these attributes on the origin HTML (the proxy doesn't strip `data-` attributes).

**Steps:**
1. Capture a test page, inspect `phase2_page_snapshots.data.ctas[0].ref`
2. Verify the proxy's `htmlModifier.ts` doesn't strip `data-` attributes on non-targeted elements
3. Verify the selector `button[data-zybit-ref="..."]` matches in `selectorMatcher.ts`

**Files:** `src/lib/phase2/snapshots/parser.ts`, `src/lib/experiments/htmlModifier.ts`, `src/lib/experiments/selectorMatcher.ts`

---

## Zybit-137 — Segment webhook schema guard
**Estimate:** 1d | **Owner:** —

**What:** The Segment webhook currently accepts any JSON. If a customer sends events missing `sessionId`, `type`, or `occurredAt`, they silently corrupt the event store. Add a Zod schema guard at the intake boundary.

**Required fields:** `sessionId: string`, `type: string`, `occurredAt: ISO8601 string`, `siteId: string`
- Missing required fields → 400 with field-level error
- Unknown extra fields → accepted (forward-compatible)
- `occurredAt` in the future by > 1h → reject (clock skew guard)

**Files:** `src/app/api/phase2/intake/route.ts`

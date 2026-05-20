# Sprint 1 — Demo Readiness

**Duration:** 1.5 weeks
**Goal:** Full demo script runnable end-to-end without ad-hoc fixes or live debugging. Gate: any engineer can run the demo cold without prep.
**Zybit-120 (E2E smoke test) completes this sprint in parallel.**

---

## Gate criteria

- [ ] Demo script runs cold (audit → finding → experiment launched) in < 20 min
- [ ] Selector validation surfaces match count on selector input
- [ ] SPA/hybrid auto-detection replaces binary SSR/SPA toggle
- [ ] Insights dead-state UX shows minimum-data requirements per rule
- [ ] Copy-hint heuristic active on experiment builder
- [ ] PostHog bridge health probe live in cockpit
- [ ] Synthetic demo environment seeded and stable

---

## Zybit-121 — Selector validation in experiment builder
**Estimate:** 2d | **Owner:** —

**Context:** PM types or picks a selector with no feedback on whether it actually matches anything in the current snapshot. Zero-match selectors silently do nothing at proxy time.

**Steps:**
1. Create `src/lib/experiments/selectorMatcher.ts`:
   - `matchSelector(selector: string, snapshotData: PageSnapshotData): { count: number; examples: string[] }`
   - Parse snapshot's element list (`ctas`, `headings`, `forms`, `landmarks`) and check whether the selector matches any of their `data-zybit-ref` attrs, tag names, or positional patterns
   - Return match count + up to 3 example element text previews
2. In the experiment builder page server component (`experiment/page.tsx`), call `matchSelector` for the pre-filled selector from the prescription; pass result as `initialMatchResult` prop
3. In `ExperimentBuilderForm.tsx`:
   - On selector input change (debounced 400ms), POST to `/api/dashboard/experiments/validate-selector` with `{ siteId, selector }`
   - Render inline badge: green "Matches 3 elements", amber "Matches 1 element — verify it's the right one", red "No matches — selector may be stale"
   - Red state blocks form submission with message: "Fix selector before launching"
4. Add `GET /api/dashboard/experiments/validate-selector` route (auth-guarded, org-scoped)

**Files:**
- `src/lib/experiments/selectorMatcher.ts` (new)
- `src/app/app/findings/[id]/experiment/page.tsx`
- `src/components/app/ExperimentBuilderForm.tsx`
- `src/app/api/dashboard/experiments/validate-selector/route.ts` (new)

**Acceptance:** Selector with 0 snapshot matches → red badge, form blocked. Valid selector → green with count. Badge updates within 500ms of typing.

---

## Zybit-122 — CSS-system detector + fragility warning
**Estimate:** 1.5d | **Owner:** —

**Context:** Styled-components, CSS Modules with hashing, and Emotion all produce class names that change on every build. A selector like `.sc-abc123` will break the day the customer deploys. We can detect this deterministically from class name patterns in the snapshot.

**Steps:**
1. In `src/lib/phase2/snapshots/parser.ts`, add `detectCssSystem(html: string): CssSystem`:
   - `'styled-components'` — `sc-` prefix on class names
   - `'emotion'` — `css-` prefix or `data-emotion` attribute
   - `'tailwind'` — `tw-` prefix OR prevalence of known Tailwind utility names (`flex`, `text-`, `bg-`, `p-`, `m-`)
   - `'css-modules-hashed'` — class names matching `/^[a-z_-]+_[a-z0-9]{5,}$/i` pattern
   - `'unknown'` — none of the above
2. Store `cssSystem` on `phase2_page_snapshots.data` (no schema change needed — it's jsonb)
3. In `selectorMatcher.ts`, if `cssSystem` is `styled-components`, `emotion`, or `css-modules-hashed`, add a `fragilityWarning: string` to the match result
4. Surface fragility warning in `ExperimentBuilderForm.tsx` below the selector badge: amber callout "This site uses styled-components — class names change on each deploy. Use the `data-zybit-ref` attribute selectors instead."
5. The "Suggest" dropdown already prefers `data-zybit-ref` selectors — make it show fragility warning for any positional or class-based suggestion

**Files:** `src/lib/phase2/snapshots/parser.ts`, `src/lib/experiments/selectorMatcher.ts`, `src/components/app/ExperimentBuilderForm.tsx`

**Acceptance:** A styled-components site shows amber fragility warning when PM types a `.sc-*` class selector. Suggestion dropdown labels `data-zybit-ref` selectors as "stable" and class-based ones as "may break on redeploy."

---

## Zybit-123 — SPA/hybrid auto-detection replaces binary toggle
**Estimate:** 1.5d | **Owner:** —

**Context:** The onboarding wizard currently has a binary SSR/SPA toggle. Most modern sites are hybrid (Next.js App Router, Remix, Astro). The toggle confuses PMs and gives wrong answers for hybrids. `isSpaHtml()` already exists in `fetcher.ts` — use it.

**Steps:**
1. Remove the SSR/SPA radio from `OnboardingWizard.tsx`
2. During the snapshot step of onboarding, run `isSpaHtml()` on the fetched HTML
3. If `isSpaHtml()` returns `true`: show a confirmation card — "This page appears to use client-side rendering. Zybit will use headless browser capture to ensure accurate results. This costs approximately $0.03/page and takes ~5s longer."
   - "Confirm" → sets `snapshotMethod: 'browserless'` on the site config
   - "My content actually loads without JavaScript" → proceeds with HTTP fetch
4. If `isSpaHtml()` returns `false`: proceed silently with HTTP fetch; store `snapshotMethod: 'http'`
5. If ambiguous (e.g., SSR shell with hydration markers but substantial content): skip the card, use HTTP fetch, set a `snapshotAmbiguous: true` flag for later review

**Files:** `src/components/app/OnboardingWizard.tsx`, `src/lib/phase2/snapshots/fetcher.ts`, `src/lib/db/schema.ts` (add `snapshotMethod` to site config if not present)

**Acceptance:** SPA-detected site shows confirmation card. Non-SPA proceeds silently. Hybrid (ambiguous) falls back to HTTP fetch without blocking onboarding. No binary toggle in the UI.

---

## Zybit-124 — Insights dead-state UX
**Estimate:** 1.5d | **Owner:** —

**Context:** A new customer connects PostHog, runs insights, gets zero findings. They see a blank backlog with no guidance. This is the most common early churn moment for analytics SaaS: "it doesn't work" when it's actually "you need more data."

**Steps:**
1. Add per-rule minimum data requirements to rule metadata in `src/lib/phase2/rules/types.ts`:
   - `minSessions: number` — sessions needed to trigger this rule
   - `minEvents: number` — total events needed
   - E.g., `formAbandonment` needs ~200 form_start events; `hesitationPattern` needs ~500 sessions
2. After an insights run that produces 0 findings, instead of empty state, render `InsightsDeadState`:
   - "You need more data before findings appear" header
   - Per-rule checklist: "Form abandonment rule: needs 200 form interactions — you have 47"
   - Progress bars for the closest-to-firing rules
   - ETA estimate: "At your current traffic volume (~80 sessions/day), expect first findings in 3–4 days"
3. ETA computed from `(requiredSessions - currentSessions) / avgSessionsPerDay` where `avgSessionsPerDay` from the last 7 days of events

**Files:**
- `src/lib/phase2/rules/types.ts` — add `minSessions`, `minEvents` to `AuditRule` interface
- Each rule file — add metadata constants
- `src/components/app/` — new `InsightsDeadState.tsx`
- `src/app/app/findings/page.tsx` — render `InsightsDeadState` when backlog is empty and insights have been run

**Acceptance:** Empty findings backlog post-insights-run shows per-rule requirements, current counts, and ETA. Never shows a blank page with no guidance.

---

## Zybit-125 — Copy-hint heuristic in experiment builder
**Estimate:** 1d | **Owner:** —

**Context:** The prescription says "give this CTA more visual weight." PM stares at the blank "Variant copy" field. A simple deterministic heuristic — current CTA length vs. known better patterns — gives them something concrete to act on without inventing data.

**Heuristics to implement (all deterministic, from snapshot data):**
1. **CTA length:** If current CTA text > 5 words, show "CTAs under 5 words typically perform better at this position. Current: N words."
2. **Action verb:** If CTA doesn't start with an action verb (common list: Get, Start, Try, Join, See, Book, Download, Learn), show "Consider starting with an action verb."
3. **Existing copy patterns:** Mine other CTAs from the same page snapshot. If the page has CTAs like "Start free trial" and "Get started", surface them as "Reuse an existing voice pattern from this page."
4. **Form field count:** For form-related findings, if the form has > 3 fields, show "Forms with ≤ 3 fields convert ~30% better. Current: N fields."

All hints are dismissible per session. Never shown for `element-hide` change type (no copy involved).

**Files:**
- `src/lib/experiments/copyHints.ts` (new) — pure functions, testable
- `src/components/app/ExperimentBuilderForm.tsx` — render hint cards below the "Variant copy" field
- `src/lib/phase2/rules/types.ts` — ensure snapshot data accessible to hint engine

**Acceptance:** CTA finding with 8-word current copy shows length hint. Form finding shows field-count hint. Hints dismissible. No hints shown for hide-type changes.

---

## Zybit-126 — PostHog bridge health probe
**Estimate:** 1.5d | **Owner:** —

**Context:** The visitor-ID bridge script injects a PostHog property (`zybit_vid`). If it silently fails (CSP rejection, script collision, PostHog not initialised yet), conversion events undercount and Learn data corrupts — without any alert.

**Steps:**
1. In `bridgeScript.ts`, after the PostHog `register()` call, emit a minimal analytics event: `posthog.capture('_zybit_bridge_loaded', { experimentId, visitorId })`
2. PostHog will receive this event with `zybit_vid` in the properties — confirming the bridge is working
3. In the PostHog pull-sync job (`posthog/sync.ts`), add a probe: query PostHog for `_zybit_bridge_loaded` events in the last 24h for sites with running experiments
4. If a site has a running experiment but zero `_zybit_bridge_loaded` events in 24h → set `bridgeHealthy: false` on the integration record
5. Surface in `CockpitView.tsx` as a red alert: "Visitor bridge not detected — conversion events may be undercounted. Check your Content Security Policy."

**Files:** `src/lib/experiments/proxy/bridgeScript.ts`, `src/lib/phase2/connectors/posthog/sync.ts`, `src/lib/dashboard/cockpit.ts`, `src/components/app/CockpitView.tsx`

**Acceptance:** Running experiment → `_zybit_bridge_loaded` events appear in PostHog. 24h without them → red cockpit alert. PM has actionable guidance (CSP check link).

---

## Zybit-127 — Demo site seed + stable demo environment
**Estimate:** 1.5d | **Owner:** —

**Context:** The demo must be runnable without a live customer site. We need a seeded org with realistic findings, a real (but controlled) proxy target, and snapshot data.

**Steps:**
1. Create `scripts/seed-demo.ts` — idempotent seeding script:
   - Demo org: `{ name: "Acme Corp", plan: "growth" }`
   - Demo site: `{ domain: "demo.zybit.run", slug: "acme-demo" }`
   - 3 findings pre-populated (one design, one pain, one form) with full evidence and prescriptions
   - 1 running experiment with `status: 'running'` and 200 assignment events
   - Snapshot data from a real captured page (can be zybit.run homepage itself)
2. Host a simple demo target page at `demo.zybit.run` (static Vercel deployment) that the proxy wraps
3. Add `npm run seed:demo` script to `package.json`
4. Document demo credentials in `docs/DEMO_RUNBOOK.md` (new, not committed to git — template only)

**Files:** `scripts/seed-demo.ts` (new), `docs/DEMO_RUNBOOK.md` (new, gitignored for credentials)

**Acceptance:** `npm run seed:demo` → demo org exists with 3 findings, 1 running experiment, seeded events. Proxy wraps `demo.zybit.run` correctly. Demo runs cold in < 20 min.

---

## Zybit-128 — Synthetic outcome data for demo measurement view
**Estimate:** 1d | **Owner:** —

**Context:** Showing measurement data in a demo requires either waiting 7+ days or pre-seeded outcome data. We need a believable synthetic outcome for the demo experiment.

**Steps:**
1. In `seed-demo.ts`, add a pre-computed outcome to the demo experiment:
   - `result: 'positive'`, `liftPct: 12.4`, `confidence: 0.94`, `guardrailBreached: false`
   - Control: 847 visitors, 142 conversions (16.8%). Variant: 831 visitors, 164 conversions (19.7%)
2. Set demo experiment `status: 'concluded'` so the outcome page renders
3. Verify measurement tab shows lift, confidence bar, and "Variant wins" summary

**Files:** `scripts/seed-demo.ts`

**Acceptance:** Demo experiment shows outcome with realistic lift%, confidence, and statistical narrative. No live traffic required to show measurement view.

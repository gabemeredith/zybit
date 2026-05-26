# Lighthouse — 5 new scenarios spec

Scope: 5 deterministic scenarios, one per rule. Goal is to eyeball the iframe
overlay and confirm each rule outlines the right element with the right color.
rage-click-target and hesitation-pattern are **descoped** — both have driver
gaps (§13 #3 and #5) and won't fire deterministically until the driver emits
`rage_click` events and `activeSeconds≥45` on page_view. Open a follow-up
ticket for those two after the driver work lands.

Naming convention per scenario:

- `scenario.id`: `rule-<ruleId>` (e.g. `rule-above-fold-coverage`)
- `scenario.name`: `<SiteName> — fires <ruleId>`
- Files: `lighthouse/fake-sites/<slug>/*.html` + `lighthouse/lib/scenarios/<slug>.ts`
  where slug is the SiteName lowercased (e.g. `kilnandclay`)
- All CTAs **must** carry `data-testid` attributes so `cssSelector` resolves
  and the iframe overlay can outline them. No `data-testid` → no highlight.

Experiment-title prefix: modify `generateSyntheticExperiment` to prefix
`[<ruleId>] ` to the experiment title when `org.id` starts with
`lighthouse_org_` (or equivalent site marker). Keeps production titles clean.

---

## Build order

1. **Kiln & Clay (above-fold-coverage)** — proof of concept. Simplest single-CTA
   annotation; validates the end-to-end loop (fake-site HTML → driver session
   → rule fires → annotation cssSelector → iframe overlay → synthetic experiment
   titled `[above-fold-coverage] …`) before batching the rest.
2. Northwind Analytics (hero-hierarchy-inversion)
3. Verdant Health (form-abandonment)
4. Plot & Patio (return-visit-thrash)
5. Quill Tax (help-seeking-spike)

Commit each scenario separately. Per-step review loop: review → test → run/verify
in the iframe → commit, before moving to the next.

---

## Scenario: rule-above-fold-coverage

- **Site**: Kiln & Clay — small-batch ceramics studio, DTC, seed stage.
  Tagline: "Hand-thrown ceramics from a Portland studio."
- **PM persona**: Maya, founding PM at a 6-person DTC brand, prepping for a
  Mother's Day push.
- **Pages**: `/` (home / hero), `/collections` (shop the spring drop),
  `/products/cobalt-mug` (PDP), `/about` (studio story).
- **Specific flaw**: `/collections` hero is a 90vh autoplay video of a potter
  throwing a bowl with a soft tagline. The "Shop the Spring drop" CTA sits at
  ~110vh — looks intentional (cinematic brand moment), but the primary CTA
  never enters the first viewport.
- **primaryCtaSelector**: `[data-testid=shop-spring-drop]`
- **transitionWeights** (sketch):
  - `/` → `/collections` 0.65, `/` 0.20, `/about` 0.15
  - `/collections` → `/products/cobalt-mug` 0.45, `/collections` 0.30, `/` 0.25
  - `/products/cobalt-mug` → `/collections` 0.45, `/products/cobalt-mug` 0.30, `/` 0.25
  - `/about` → `/` 0.50, `/collections` 0.40, `/about` 0.10
- **exitHazard**: `{ '/collections': 0.55 }` — most sessions bail from the
  collections page because the CTA is below the fold.
- **personaMix** (e-commerce skew, matches WovenBasics): casual 0.55,
  evaluator 0.18, power-user 0.12, churning 0.07, bot-ish 0.08.
- **defaultSessions**: 300.
- **businessProfile**: `{ mrr: null, aov: 4800 }` (small-batch ceramics, ~$48 AOV).
- **How I'll know the right rule fired**: top finding = `above-fold-coverage`
  on `/collections`. Overlay outlines `[data-testid=shop-spring-drop]`. Color
  per `annotationColors.ts` for above-fold-coverage.

---

## Scenario: rule-hero-hierarchy-inversion

- **Site**: Northwind Analytics — Series A warehouse-observability tool, B2B SaaS.
  Tagline: "See every query before your warehouse bill does."
- **PM persona**: Priya, growth PM at a 40-person B2B SaaS, owns the marketing
  site's signup funnel.
- **Pages**: `/` (hero with dual CTAs), `/pricing`, `/customers`, `/docs`.
- **Specific flaw**: Hero has two side-by-side CTAs: "Start free trial"
  (primary, *ghost outline button*, transparent background) and "Watch 2-min
  demo" (secondary, *filled solid-blue button*). Visual weight is inverted;
  visitors click the demo button at ~2× the rate of trial. A real ship-mistake
  — designer wanted the demo to "feel inviting".
- **primaryCtaSelector**: `[data-testid=start-free-trial]` (the intended primary)
- **Secondary CTA**: `[data-testid=watch-demo]` (the visually-heavy one that wins clicks)
- **transitionWeights**:
  - `/` → `/pricing` 0.30, `/customers` 0.20, `/docs` 0.15, `/` 0.35
    (note: demo button click currently routes back to `/` — modal-ish — but
    weights below should bias evaluators who clicked it back to `/pricing`)
  - `/pricing` → `/` 0.40, `/customers` 0.30, `/pricing` 0.30
  - `/customers` → `/` 0.50, `/pricing` 0.30, `/customers` 0.20
  - `/docs` → `/` 0.45, `/docs` 0.35, `/pricing` 0.20
- **exitHazard**: `{}` (no specific page chokepoint; the rule fires on click distribution within the hero, not exit behavior)
- **personaMix** (B2B SaaS skew — evaluator-heavy):
  evaluator 0.40, casual 0.30, power-user 0.10, churning 0.08, bot-ish 0.12.
- **defaultSessions**: 300 (need ≥30 clicks on hero CTAs; with elevated
  clickIntent personas this should clear).
- **businessProfile**: `{ mrr: 85000, aov: null }` (Series A SaaS, ~$85k MRR).
- **How I'll know the right rule fired**: top finding = `hero-hierarchy-inversion`
  on `/`. Overlay outlines BOTH `[data-testid=start-free-trial]` AND
  `[data-testid=watch-demo]` in contrasting colors (rule has two-annotation
  proposeAnnotations).

---

## Scenario: rule-form-abandonment

- **Site**: Verdant Health — direct-to-consumer mental-health telehealth, ~20 employees.
  Tagline: "Therapy that fits your life. Match in 24 hours."
- **PM persona**: Sam, PM at a 20-person telehealth startup, owns the intake funnel.
- **Pages**: `/` (home), `/how-it-works`, `/get-started` (intake form), `/therapists` (browse).
- **Specific flaw**: `/get-started` form is 8 fields: name, email, DOB,
  insurance carrier, current medications (dropdown w/ 200 entries), presenting
  symptom (long-form text), preferred therapist gender, availability window.
  Users bail at "current medications" — feels invasive before they've talked
  to anyone. PM added the field at clinical ops' request without UX-checking.
- **primaryCtaSelector**: `[data-testid=intake-submit]`
- **transitionWeights**:
  - `/` → `/how-it-works` 0.40, `/get-started` 0.35, `/therapists` 0.15, `/` 0.10
  - `/how-it-works` → `/get-started` 0.55, `/` 0.20, `/therapists` 0.15, `/how-it-works` 0.10
  - `/therapists` → `/get-started` 0.40, `/` 0.25, `/therapists` 0.25, `/how-it-works` 0.10
  - `/get-started` → `/how-it-works` 0.30, `/` 0.30, `/get-started` 0.40
    (no transition to a confirmation page — most "form_submit" never happens)
- **exitHazard**: `{ '/get-started': 0.70 }` — the abandonment behavior.
- **personaMix** (healthtech skew — evaluators researching options heavy,
  modest casual, low power, low bot):
  evaluator 0.50, casual 0.30, power-user 0.05, churning 0.10, bot-ish 0.05.
- **defaultSessions**: 600 (need ≥100 views of `/get-started`; with ~50% of
  sessions reaching the form, 600 sessions safely clears).
- **businessProfile**: `{ mrr: 42000, aov: null }` (~$42k MRR, $80/session).
- **How I'll know the right rule fired**: top finding = `form-abandonment` on
  `/get-started`. Overlay outlines `[data-testid=intake-form]` (the whole
  form, not just submit). Submit rate <50% confirmed in finding metadata.

---

## Scenario: rule-return-visit-thrash

- **Site**: Plot & Patio — two-sided marketplace for small-group vacation
  rentals (cabins, cottages, A-frames). ~30 employees.
  Tagline: "Cabins for crews of 4–10."
- **PM persona**: Quinn, marketplace PM owning demand-side conversion.
- **Pages**: `/` (home / search), `/listings` (results grid), `/listings/aspen-a-frame`
  (detail), `/listings/lakeside-cabin` (detail), `/listings/redwood-cottage`
  (detail), `/book` (booking start — most never reach).
- **Specific flaw**: Group trips need consensus — users open 3 detail pages,
  hit back to the grid, refilter, open another 2 detail pages, back to grid,
  loop. Listings detail pages have a "Save for later" CTA but no comparison
  view, so users browser-thrash. Realistic flaw: PM cut the comparison feature
  for v1 to ship faster.
- **primaryCtaSelector**: `[data-testid=book-now]` (on listing detail pages)
- **transitionWeights**:
  - `/` → `/listings` 0.65, `/` 0.25, `/listings/aspen-a-frame` 0.10
  - `/listings` → `/listings/aspen-a-frame` 0.30, `/listings/lakeside-cabin` 0.25, `/listings/redwood-cottage` 0.20, `/listings` 0.20, `/` 0.05
  - `/listings/aspen-a-frame` → `/listings` 0.55, `/listings/lakeside-cabin` 0.15, `/listings/redwood-cottage` 0.15, `/book` 0.05, `/listings/aspen-a-frame` 0.10
  - `/listings/lakeside-cabin` → `/listings` 0.55, `/listings/aspen-a-frame` 0.15, `/listings/redwood-cottage` 0.15, `/book` 0.05, `/listings/lakeside-cabin` 0.10
  - `/listings/redwood-cottage` → `/listings` 0.55, `/listings/aspen-a-frame` 0.15, `/listings/lakeside-cabin` 0.15, `/book` 0.05, `/listings/redwood-cottage` 0.10
  - `/book` → `/listings` 0.50, `/` 0.30, `/book` 0.20
- **exitHazard**: `{}` — thrash fires from in-session loop behavior, not exits.
- **personaMix** (marketplace skew — heavy evaluator, modest casual,
  small power):
  evaluator 0.45, casual 0.30, power-user 0.10, churning 0.07, bot-ish 0.08.
- **defaultSessions**: 300 (need ≥50 path sessions looping — at 300 with
  ~70% reaching listings, comfortably clears).
- **businessProfile**: `{ mrr: null, aov: 1200 }` (~$1200 per stay).
- **How I'll know the right rule fired**: top finding = `return-visit-thrash`.
  Overlay outlines `[data-testid=book-now]` on one of the listing detail
  pages (the unprogressed CTA).

---

## Scenario: rule-help-seeking-spike

- **Site**: Quill Tax — consumer DIY tax filing for freelancers and
  side-hustlers. ~12 employees. Tagline: "Taxes for the 1099 life."
- **PM persona**: Casey, growth PM at consumer fintech, owns the pricing-to-signup conversion.
- **Pages**: `/` (home), `/pricing` (3-tier pricing matrix), `/features`, `/signup`.
- **Specific flaw**: `/pricing` matrix has 3 tiers (Solo $29, Hustle $59,
  Empire $99) with a checkmark grid: 14 rows including "Schedule C support",
  "Form 1099-NEC handling", "QBI deduction calc", "State filing (1 state /
  3 states / unlimited)", etc. Jargon-heavy. A "Chat with a CPA" link sits
  in the top nav AND below the matrix — gets hammered when users can't tell
  which tier they need. PM ran A/B and added the second link "to be helpful"
  but it cannibalizes signups.
- **primaryCtaSelector**: `[data-testid=start-filing]` (intended primary on `/pricing`)
- **Help CTA**: `[data-testid=chat-with-cpa]` (the over-clicked help link)
- **transitionWeights**:
  - `/` → `/pricing` 0.50, `/features` 0.25, `/signup` 0.15, `/` 0.10
  - `/pricing` → `/signup` 0.20, `/features` 0.20, `/` 0.30, `/pricing` 0.30
  - `/features` → `/pricing` 0.45, `/signup` 0.20, `/` 0.25, `/features` 0.10
  - `/signup` → `/pricing` 0.30, `/` 0.30, `/signup` 0.40
- **exitHazard**: `{ '/pricing': 0.40 }` (users give up after clicking chat
  and not getting an answer).
- **personaMix** (consumer fintech skew — casual heavy, evaluator moderate,
  low power since tax filing is annual):
  casual 0.50, evaluator 0.30, power-user 0.05, churning 0.05, bot-ish 0.10.
- **defaultSessions**: 1000 (need ≥200 site clicks AND ≥50 page clicks on
  the chat CTA; clickIntent ~0.2 → 1000 sessions × 0.2 = 200 baseline clicks,
  enough to clear).
- **businessProfile**: `{ mrr: null, aov: 59 }` (median tier $59/yr).
- **How I'll know the right rule fired**: top finding = `help-seeking-spike`
  on `/pricing`. Overlay outlines `[data-testid=chat-with-cpa]` (the
  over-clicked help link, not the primary CTA).

---

## Driver / generator changes required

- **`generateSyntheticExperiment`** (or wherever experiment titles are minted):
  detect `lighthouse_site_*` sites and prefix the experiment title with
  `[<ruleId>] `. Keep production paths untouched. Confirm `org.id` or `site.id`
  is available at title-generation time.
- **`fake-sites-server`** or whatever serves the static HTML: confirm each new
  slug directory (kilnandclay, northwind, verdant, plotandpatio, quilltax) is
  picked up automatically. If route registration is manual, add the 5 routes.
- **Scenario registration**: add `import './kilnandclay'` etc. to
  `lighthouse/lib/scenarios/index.ts` so they register.

## Verification checklist (per scenario)

For each of the 5, the build is "done" when:

1. `npm run lighthouse:run -- --scenario rule-<ruleId>` completes without
   error.
2. The iframe at `/lighthouse/<slug>` renders with the colored overlay outlining
   the *exact* `data-testid` element named in "How I'll know the right rule
   fired" above.
3. The top finding by priority score is `<ruleId>` for that scenario.
4. The synthetic experiment title starts with `[<ruleId>] `.
5. The element/color combo is visually distinct from the other 4 scenarios
   (the whole point — each rule produces a different overlay).

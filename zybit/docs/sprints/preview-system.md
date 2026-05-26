# Preview system — render the suggested fix without deploying it

**Status:** Proposal. **Date:** 2026-05-23.
**Partial progress (2026-05-26):** the per-rule annotation surface
underneath this spec has filled in — PR #76 added the "why this is
highlighted" callout to `AnnotatedFindingPreview`, and PR #82 rewrote
`proposeAnnotations` across all 9 currently-annotated rules so each
preview anchor matches the rule's prescription (e.g. quick-answer
above hero for `return-visit-thrash`, FAQ above CTA for
`help-seeking-spike`). That is the *anchor* layer Option A relies on;
the **side-by-side iframe preview surface on the finding page** (the
core of Phase A below) is still unbuilt.
**Owner:** triggered by founder ask — adds the depth missing today
("show me what the page would look like with this fix applied")
without unfreezing the deploy loop. Sits squarely inside PRD §3.5
(*"just enough... that a finding's proposed fix is shown visually
and believably"*) — the in-a-day flow-funnel diagrams are the
floor, this is the next step up.

This document audits what we have, picks the architecture, scopes
the work in three phases, and surfaces the open questions that
need founder approval before we open a PR.

---

## 1. Why this matters strategically

Today the PM journey on a finding is:
1. Read the title and the prescription prose
2. Imagine what the fix would look like
3. Decide whether to create an experiment or dismiss

Step 2 is silent. It is where conviction either forms or doesn't.
The friction is invisible because the PM doesn't tell us they hit
it — they just close the tab.

A preview turns step 2 into:
1. Read the title and prescription
2. **See the page with the fix applied**
3. Decide

This addresses two things at once:

- **Credibility slice for the read-only advisory** (PRD §3.5).
  The finding is no longer abstract; the proposed fix is concrete.
- **PRD §7 trigger detection.** The success test is *did the PM
  say "now let me fix this?"* — they cannot meaningfully ask that
  question without seeing the fix. The preview is the instrument
  that surfaces that signal.

It is the right next bet *if* the goal at this stage is to make
the advisory more actionable on day one without building the deploy
loop.

---

## 2. What we already have (do not rebuild)

| Piece | Where | What it does |
|---|---|---|
| Page snapshots | `phase2_page_snapshots`, `phase2_page_captures` | Full DOM, computed styles, design tokens — captured per-route. |
| Design tokens | `phase2_site_design_snapshot`, `extractDesignTokens` (only on `main` via PR #58) | `primaryColor`, `secondaryColor`, `typeScale` per site. |
| HTML modifier | `src/lib/experiments/` (used by the proxy) | Applies `VariantModification[]` (`text-replace`, `css-inject`, `element-hide`/`show`, `attribute-set`, `element-reorder`) to a string of HTML. |
| Side-by-side iframe preview | `/app/experiments/[id]` page | Already renders control + variant iframes with `CSP frame-ancestors 'self'`. The component exists; we move it one step earlier in the funnel. |
| Browserless fallback | `src/lib/phase2/snapshots/browserFetcher.ts` (live-verified 2026-05-22) | Renders SPA shells server-side when the static HTTP snapshot is empty. |

What does **not** exist yet:
- A preview surface on a *finding* (only on a saved *experiment*).
- A way to generate `VariantModification[]` for a finding without
  the PM typing them by hand. (Sprint 3's AI advisor would do
  this; it is parked, and we deliberately do not unpark it for
  this work — see §4.)
- Asset loading inside an iframe-rendered snapshot (today the
  snapshot's CSS/images reference the customer's domain and
  often fail under CSP).

---

## 3. Architecture — one route, no Vercel deploys

The intuition during the founder discussion was to deploy each
preview to its own Vercel project. **That is more infrastructure
than this needs and creates more problems than it solves**
(per-finding deploy quotas, env sprawl, cleanup, asset/CORS still
bite you, branding leakage). Same fidelity is achievable with one
Next.js route in the existing app.

```
Finding detail page
  └─ "Preview the suggested fix" panel
     ├─ control iframe → GET /api/preview/[findingId]?variant=control
     └─ variant iframe → GET /api/preview/[findingId]?variant=N

GET /api/preview/[findingId]?variant=N
  1. load latest page snapshot for finding.pathRef
  2. if variant=N:
       mods = proposeModifications(finding, snapshot)[N]
       html = applyModifications(snapshot.html, mods)
     else:
       html = snapshot.html
  3. rewrite asset URLs:
       <img src="/img/x.png">   → /api/preview/asset?siteId=X&url=/img/x.png
       <link href="/css/a.css"> → /api/preview/asset?siteId=X&url=/css/a.css
       (also for absolute URLs to the customer's own domain)
  4. strip <script> tags (safety + we are reviewing visual changes
     only, not behaviour — see §6 catch 2)
  5. return html with CSP frame-ancestors 'self'

GET /api/preview/asset?siteId=X&url=Y
  - resolve Y against the site's origin
  - server-side fetch, with a tight content-type allowlist
    (image/*, text/css, font/*, application/font-*)
  - cache 1h per (siteId, url)
  - org-scoped via existing assertSiteInOrganization
```

Two new routes. No external infra. The asset proxy gives us
fidelity (the page looks right) without exposing the customer's
production domain inside an iframe-with-modifications context.

---

## 4. Where the modifications come from

Three options. Picking one is the only architecturally significant
decision in this spec.

### Option A — Per-rule deterministic templates (recommended)

Each of the 19 audit rules ships a
`proposeModifications(finding, context)` method that returns 1–3
templated `VariantModification[]` options, using design tokens
already in the snapshot.

Example: `hero-hierarchy-inversion` fires when the H1 is visually
weaker than a non-H1 element. Its template returns:

```ts
[
  { type: 'css-inject', selector: 'h1',
    css: 'font-size: 3rem; font-weight: 700; color: ' + tokens.primaryColor + ';' },
  { type: 'css-inject', selector: '.hero h2',
    css: 'font-size: 1.25rem; color: ' + tokens.secondaryColor + ';' },
]
```

**Pros:** Deterministic. No LLM cost. Stays inside the
"deterministic over generative" doctrine. Fast (no model latency).
Each rule already encodes the diagnosis; the paired fix is the
natural symmetric piece.

**Cons:** Templates feel mechanical for nuanced findings. Mitigation:
PMs can edit the proposed modifications before previewing — the
preview iframe re-renders inline.

### Option B — PR #66's Gemini advisor

**Not recommended for this work.** Unparks the four security
holes already flagged (`attribute-set` allowlist gap, credential in
URL, prompt injection, unvalidated CSS). It is the wrong moment
to take that on.

### Option C — Manual only

PM types each modification themselves; preview re-renders live.
Useful as the *escape hatch* but not the default — it doesn't
actually solve "show me what to do."

**Recommendation: A first, with C as an inline editor on top of A.**
PR #66 stays parked.

---

## 5. Phased implementation plan

### Phase A — single page, single suggestion (3–4 dev-days)

Goal: a PM lands on a finding for the 3 most common rules and sees
one credible before/after side-by-side.

1. Add `proposeModifications(finding, ctx): VariantModification[][]`
   to the `AuditRule` interface. Implement for the **three highest-impact
   rules**: `hero-hierarchy-inversion`, `bounce-on-key-page`, and
   whichever third rule fires most often in Lighthouse URL-audit
   runs (need a quick count against the posthog.com run).
2. New route `src/app/api/dashboard/findings/[id]/preview/route.ts`
   per the architecture above.
3. New route `src/app/api/preview/asset/route.ts` with simple LRU
   cache + content-type allowlist.
4. Refactor the existing experiment-preview component into a shared
   `<PreviewPanel control variant>` and mount it on the finding
   detail page.
5. Stale-snapshot banner ("snapshot is N days old — re-capture?")
   wired into the existing `snapshots.staleDays` signal.

Tests: pure-function unit tests for each rule's template; a happy-path
test for the preview route that mocks the snapshot.

### Phase B — 1–3 options per finding (2 dev-days)

Goal: depth. PM compares alternatives instead of accepting/rejecting
the one default.

6. Extend each rule's template to return 1–3 alternative fixes.
7. Tab UI in the variant iframe to flip between options.
8. Roll out templates for the remaining 10 rules.
9. Inline editor: PM clicks "Edit" on a template, modifies the
   selector/css/text, preview re-renders. Reuses the experiment
   builder's selector-validation chip.

### Phase C — multi-page preview (2 dev-days, deferrable)

Goal: findings that cascade (nav-dispersion, global typography)
preview correctly across the affected routes.

10. Detect cascade in `proposeModifications` — if the rule says
    "affects N pages," return the affected pathRefs.
11. Thumbnail strip at the top of the preview panel, one
    thumbnail per affected pathRef.
12. **Optional, later:** click-through navigation — the iframe
    intercepts internal link clicks and re-routes to the
    corresponding snapshot preview. Moderately tricky (postMessage
    bridge). Cut from v1 if Phase B proves enough value.

### Total

~8–10 dev-days for a credible v1 (Phase A + B). Phase C adds 2–4
more days when pulled.

---

## 6. Honest catches

1. **JS-heavy SPAs render as empty shells in static-HTTP snapshot
   HTML.** The proxy already fails on these via the SPA-shell guard
   (Zybit-123). The preview would too — but Browserless is already
   wired in `browserFetcher.ts` and live-verified. **Mitigation:**
   prefer the Browserless-rendered snapshot when present; fall back
   to the HTTP snapshot. No new infra; cost is one Browserless
   render per page per snapshot cadence (already daily). This is the
   one area where Phase A might reveal we need to be more aggressive
   about Browserless usage.

2. **External script execution inside the iframe is unsafe and
   unhelpful.** We strip `<script>` tags at preview time. The PM is
   reviewing visual changes, not runtime behaviour. **Trade-off
   to call out explicitly to the founder:** a page that depends on
   JS for layout (rare on landing pages, common in dashboards) will
   look broken in the preview. The advisory's natural surface is
   landing/marketing/funnel pages, so this is acceptable; we add a
   visible banner *"some interactive elements are hidden in preview"*
   to set expectations.

3. **Templates feel mechanical.** That is the trade for deterministic
   + no LLM cost. Phase B (1–3 options) mitigates by giving the PM
   choice; the inline editor mitigates by letting them tweak.

4. **CSS hosted by an external CDN.** The asset proxy handles
   same-origin and subdomain asset URLs naturally. Cross-origin CDNs
   (e.g. Tailwind from JSDelivr, Google Fonts) work by default
   because the browser fetches them directly — they were already
   public. We do not need to proxy them.

5. **Stale snapshots.** A finding rendered against a 2-week-old
   snapshot may look wrong vs. the live site. We have
   `snapshots.staleDays` per pathRef (Zybit-135) — the preview
   panel surfaces it and offers a "re-capture now" button.

6. **CSP and iframe security.** We already use
   `frame-ancestors 'self'` on the experiment preview; same here.
   The iframe content is our own HTML response, not third-party,
   so we control the CSP header.

7. **Real product work, not 2 days.** Realistically a focused
   2-week sprint for Phase A + B. The asset proxy in particular
   needs careful handling of redirects, content-type validation,
   and cache invalidation.

---

## 7. What this does NOT do

Setting boundaries explicitly:

- Does **not** apply modifications to the customer's live site
- Does **not** require any SDK, snippet, or DNS change
- Does **not** unfreeze PR #66 (AI Variant Advisor)
- Does **not** unfreeze Zybit-149 (client runtime)
- Does **not** become an A/B testing tool — it is a *review surface*

When a PM previews a fix and clicks "create an experiment from this,"
they enter the existing experiment builder. That is the boundary at
which the deferred deploy loop becomes relevant — and the signal
PRD §7 says triggers Phase 2 of the product.

---

## 8. Open questions for founder approval

These determine the spec's final shape before I open a PR.

1. **Phase A scope:** start with the 3 most-fired rules from
   Lighthouse URL-audit against real sites (e.g. posthog.com),
   or pick the 3 *most demo-worthy* ones?
   - Recommendation: most-fired. Reflects what PMs will actually
     see in their first session.

2. **`<script>` stripping vs. selective allow-list:** strip all,
   or allow inline JSON-LD / structured data scripts?
   - Recommendation: strip all in Phase A. Selective allow-list is
     a tuning knob if Phase A reveals real loss.

3. **Inline editor in Phase A or Phase B?**
   - Recommendation: Phase B. Phase A proves the preview pipeline;
     Phase B adds choice + editability.

4. **Browserless on every preview or only when static HTTP is
   empty?** A pre-rendered Browserless capture per snapshot is
   the better default; the preview never calls Browserless directly.
   - Recommendation: pre-render once per snapshot cadence (already
     daily for live sites). Preview reads whichever is best.

5. **Do we want a "share preview" link?** A PM forwarding a preview
   URL to a colleague.
   - Recommendation: defer. Auth-gated only in Phase A/B. Sharing
     adds a security surface (signed URLs, expiry) that is not
     worth scoping yet.

---

## 9. Recommended next step

If §8 answers are aligned, this becomes a single PR of about a
two-week focused sprint (Phase A + B). It lands as a feature
extension on the existing finding-detail page; no schema changes;
no env-var additions.

Cross-link for follow-up:
- `docs/PRD.md` §3.5 (credibility slice scope item).
- `docs/sprints/sprint-3-deferred.md` (why PR #66 stays parked
  even with this work in flight).
- `docs/sprints/pilot-readiness.md` (how this changes the
  pre-pilot demo — "show me my own data" gets a richer answer).

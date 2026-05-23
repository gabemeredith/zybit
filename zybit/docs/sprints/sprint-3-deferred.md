# Sprint 3 — Deferred under contracted PRD

**Status:** Parked. **Date:** 2026-05-23.
**Reason for parking:** PRD ratified 2026-05-22 contracts scope to **one
read-only milestone** (flow-graph advisory). Sprint 3 builds the deploy-side
surface (variant runtime, AI advisor, design capture, element picker, ephemeral
preview). None of it is on the customer-facing critical path until a customer
who already values the advisory says *"now let me deploy the fix."*

This document is the bookmark — what each item does in PM terms, what its
landing on `main` would buy us, and the explicit signal that unfreezes it.

---

## What is currently on a branch (PR #66 — `feat/sprint-3-followup`)

PR #66 is **complete, tests green, Vercel preview deploys**. It is not merged.
It implements three Sprint 3 tickets:

| Ticket | What it adds | PM-visible behaviour |
|---|---|---|
| Zybit-143 | `extractDesignTokens` derives primaryColor / secondaryColor / typeScale from already-captured computed styles, co-written atomically into `phase2_site_design_snapshot`. | Nothing visible on its own. A dependency the AI advisor relies on. |
| Zybit-144 | `POST /api/dashboard/experiments/ai-suggest` — calls Gemini 2.0 Flash with the finding + structural snapshot + design tokens, validates the response against the modification schema + selector allowlist (CTAs + forms only), returns ≤3 draft variant options. | On a finding's "Create experiment" step, a "Get AI suggestions" button surfaces three pre-drafted variants the PM can pick from or reject. Skippable; the manual builder still works. |
| Zybit-148 | `phase2_ai_advisor_usage` table + `aiAdvisorRateLimit.ts`. 10 calls/org/day. Atomic upsert (`ON CONFLICT DO UPDATE WHERE call_count < LIMIT`); denied calls do not bump the counter. | If a PM mashes the AI button, the eleventh click that day returns 429 with a "try again tomorrow" toast. Cost guard. |

### What this PR buys us if merged today

- **Time-to-first-experiment shrinks** for the subset of customers who reach
  the variant-builder. The advisor proposes three credible variants; the PM
  edits or accepts. This is a UX accelerator, not a new product capability.
- **The advisor cannot deploy anything.** The proxy still applies the
  modifications to server-rendered HTML, the runtime to SPAs is unbuilt
  (Zybit-149). So on a React/Vue customer the advisor produces variants
  that the deploy loop cannot actually run.
- **Maintenance cost** is real: Gemini key in production, daily cost ceiling,
  prompt-injection surface (the four Greptile findings — selector allowlist
  is sound but `attribute-set` accepts any attribute name, `css-inject`
  accepts any CSS, prescription text is interpolated verbatim, credential
  is in the URL query string).

### Why park rather than land

Under the contracted PRD, no customer has yet asked to deploy a fix. Merging
PR #66 ships a feature that needs the deploy loop to be valuable. The deploy
loop on modern apps needs Zybit-149 (client runtime), which is the 6-day
ticket explicitly deferred until customer pull. Landing the advisor without
the runtime adds maintenance surface (Gemini cost, prompt-injection patches,
spec drift) for zero net product value.

### Conditions to unpark PR #66

Merge when **any one** of these is true:

1. A pilot customer has run the advisory, identified a fix, and explicitly
   asked Zybit to deploy a variant — and their site is server-rendered (the
   advisor's modifications work today on SSR HTML).
2. Zybit-149 (client runtime) is scheduled into a sprint — the advisor's
   suggestions become deployable on SPAs.
3. The PM dashboard ships a "draft variants" view that uses the advisor
   purely as a brainstorming aid (no deploy required) — narrower scope but
   plausible standalone value.

When merging, address the four Greptile findings first (see PR #66 body).

---

## The rest of Sprint 3 — not built

| Ticket | 1-line | What it adds (PM terms) | Est. |
|---|---|---|---|
| **Zybit-145** | AI advisor UI cards | Render the three Gemini-drafted options on the finding detail page; click "Use this" pre-fills the experiment builder. | 2d |
| **Zybit-146** | DOM tree element picker | Replaces typing a CSS selector with clicking the CTA/heading directly in a tree view of the snapshot DOM. Reduces "I selected the wrong thing" errors. | 7d |
| **Zybit-147** (partial) | Ephemeral live preview while editing | The control/variant preview already exists on the saved experiment page. This ticket extends it to debounced live re-render while the PM types into the modification builder. | ~3d to finish |
| **Zybit-149** | Client-side variant runtime | The proxy mutates server HTML; on SPAs (React/Vue/Next) the mutations are overwritten by hydration. The runtime is a small injected script that re-applies modifications post-hydration so variants actually render on modern apps. Required to ship the deploy loop on SPAs at all. | 6d |

### Value calculus under the contracted PRD

- **Zybit-145, 146, 147** are quality-of-life on the variant-builder. **They
  add zero value if no customer is building variants yet.** They become
  important the moment the deploy loop is in use.
- **Zybit-149 is the gating ticket** for any deploy-on-SPA story. Today the
  product silently no-ops on React/Vue customers — the launch-time SPA guard
  (Zybit-123) catches this with a banner, but the only fix is "don't run an
  experiment on this page." Until 149 ships, Zybit cannot deploy to the
  dominant frontend stack in 2026.
- **Standalone value of the advisor under the advisory-only PRD** is one
  narrow surface: the PM uses Zybit to think about a fix, then implements
  it in their own codebase. That's a real but thin use case that doesn't
  justify the maintenance cost of Gemini in the loop.

### Unfreeze trigger

The PRD says it plainly:

> If a customer who values the advisory says *"now let me deploy the fix"*
> — that is the signal to build the runtime. If they never say it, two
> quarters of runtime engineering were correctly not spent.

When that signal arrives, build order is **149 → 144 → 145/146 → 147**.
141/142 (design snapshot writer) is already on `main` via PR #58; tokens
(143) ride on top in a one-day spike from PR #66's branch.

---

## Cross-reference

- `docs/PRD.md` §3 (scope IN), §4 (scope NOT NOW), §7 (success test)
- `docs/sprints/REMEDIATION.md` for the per-ticket build status
- `docs/sprints/sprint-3.md` and `sprint-3R.md` for the original tickets
- PR #66 body on GitHub for the Greptile security findings to address on
  unpark

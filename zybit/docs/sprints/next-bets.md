# Next bets — refined priority order

**Status:** Working priority list. **Date:** 2026-05-23.
**Lives alongside** `ROADMAP.md` (the sprint-shaped technical history)
and `pilot-readiness.md` (the operational checklist for a single
pilot). This document is the **forward-looking founder ordering** —
what to do next and why, in priority order, with the rationale
that determined the order.

Re-read and challenge this list every 90 days, per the curriculum's
quarterly anchoring exercise.

---

## 1. Public URL-audit lead magnet 🔴 highest leverage

**Why first:** Solves the Day-0 friction (the PostHog setup wall)
without removing it from the upsell story. The engine already
exists in PR #65; we just need the public wrapper. ~6 dev-days
for Phases A + B.

**What it unlocks:**
- Zero-cost top-of-funnel for inbound
- Demand signal we currently have *none* of
- The single most credible demo (a finding on the prospect's actual
  site, in 60 seconds, without their setup)

**Spec:** `url-audit-lead-magnet.md`.

---

## 2. Onboarding UX cleanup 🟡 mostly done, finish it

**Status:** The hard work landed in PR #67 — 3-step wizard, pre-flight
verification panel, proxy moved to settings. What remains:

- A cockpit nudge that surfaces "deploy is set up under settings →
  proxy" only after a PM signals deploy intent (e.g. clicks "create
  experiment" on a finding)
- A "we'll add this later" path on the revenue step that actually
  exposes the form somewhere reachable in settings (currently it's
  there but not surfaced)
- Live dogfooding of the new wizard with the founders' own PostHog
  account before the first pilot — catch the seams that tests miss

**Effort:** ~1 dev-day. Treat as polish on top of the merged work.

---

## 3. Preview + suggest pipeline 🔴 product depth

**Why third, not later:** This is what makes the advisory *actionable*
rather than *informational*. A PM who can see the proposed fix in
their own homepage is a PM who will tell us either "yes, ship this"
(unlocking PRD §7 / Phase 2) or "no, that's wrong" (unlocking real
template improvement). Either outcome is signal we cannot get
without it.

**Phasing:** ~8-10 dev-days for a credible v1.

**Spec:** `preview-system.md`. Note the explicit decision to use
per-rule deterministic templates (option A) — PR #66 stays parked.

---

## 4. Manual outcome entry surface 🟢 cheap moat acceleration

**Why now, not later:** Layer 2 calibration is mechanically built but
inert until ≥3 conclusive outcomes per rule per site accumulate.
Without the deploy loop, we never accumulate them — meaning the
moat (Zybit getting smarter per site over time) is invisible.

**Short-circuit:** A "tell us how this finding worked out" surface
on the finding-detail page. Three radio buttons: *shipped + won /
shipped + lost / did not ship + why*. PMs deploying fixes manually
(outside Zybit) give us the outcome signal anyway. Layer 2 starts
learning months before the deploy loop exists.

**Effort:** ~1 dev-day for the surface + schema + write into the
existing `outcomes` repository.

---

## 5. JS-richer modifications & client runtime (Zybit-149) 🟡 wait for pull

**Why here, not higher:** The variant vocabulary today
(`text-replace`, `css-inject`, `hide`, `show`, `attribute-set`,
`element-reorder`) is sufficient for ~80% of CRO experiments. The
remaining 20% (custom event handlers, element injection, sequence
animations) is real but only matters once a customer has pulled the
deploy loop and asked for it.

The proxy works on server-rendered HTML; the client runtime is the
piece that makes variants survive React hydration. Until a customer
pulls #6 below, building #5 is speculative.

**Effort when pulled:** Zybit-149 estimate ~6 dev-days; UI work +
testing harness on top is ~4 more.

---

## 6. One-click deployment + full loop 🔴 the moat, when pulled

**Why last, not first:** This is the largest surface and the highest
security risk in the codebase. PR #66 (AI advisor) sits at this
boundary today and is parked partly *because* the deploy loop
isn't here. Sequencing:

1. Wait for a real customer to ask to deploy a fix (PRD §7 trigger)
2. Fix the 4 security holes in PR #66 (`attribute-set` allowlist,
   credential-in-URL, prompt injection, CSS validation)
3. Build Zybit-149 (client runtime) for SPA support
4. Unfreeze PR #66 with the security fixes
5. Wire the finding-preview's "ship this" button to actually launch
   an experiment
6. Multi-page support (Phase C of the preview spec)

**Effort:** Multi-week sprint when triggered. Plan for 4-6 weeks of
focused work. Do not start until §7 trigger fires.

---

## What is missing from "engineering" priority list

These are **not engineering tickets** but block the same outcomes.
They go on the cofounder's whiteboard, not the dev sprint board:

### A. Public marketing site + docs

Without a landing page, the URL-audit lead magnet (#1 above) has
no funnel pointing at it. This is GTM, not engineering. ~1-2 weeks
of focused work + a designer's eye. Build alongside #1.

### B. Live billing self-serve validation

Stripe is plumbed and synthetically verified end-to-end. **No actual
human has paid yet.** The first real checkout will surface bugs the
18/18 synthetic check missed (PSD2/SCA flows, region-specific tax,
trial-to-paid transitions). Run a real $1 transaction yourself
before the first pilot upgrades.

### C. Security review before any deploy-loop work

The PR #66 security holes (attribute-set allowlist, credential leak,
prompt injection, CSS validation) are documented and tractable but
unbuilt. They are the *gating* prerequisite for #5 and #6 — do not
start either without the security fixes in place.

### D. Weekly digest email cadence

The first-insight email exists. The recurring "here is what changed
this week, here is what to look at" cadence does not. PMs check
tools that email them. ~1 dev-day for v1, lots of room to tune.

### E. Operator runbook

The operator dashboard shipped (Zybit-156) but there is no document
that says "when a customer DMs you 'Zybit hasn't shown me anything',
do these 5 things." Write it. ~1 hour. Live in `docs/sprints/`.

---

## How to use this list

- **Weekly:** scan the top 3 items, decide what gets a day of focused
  work, and put the rest down. Defer guilt.
- **Quarterly (per curriculum):** challenge the ordering. Has a
  customer signal shifted #1? Has a competitor shipped something
  that makes #3 less important? Should A-E (cofounder items) be
  promoted above an engineering item?
- **Before opening a PR for any of #2-#6:** re-read the spec
  alongside this list. If the PR drifts from the priority, stop.

---

## Cross-reference

- `url-audit-lead-magnet.md` — full spec for #1
- `preview-system.md` — full spec for #3
- `pilot-readiness.md` — operational gates for converting a pilot
- `posthog-from-zero.md` — customer recipe (for #2's pilot funnel)
- `sprint-3-deferred.md` — why PR #66 stays parked (affects #5/#6)
- `operator-dashboard.md` — Zybit-156 (shipped in PR #67)
- `onboarding-redesign.md` — context for #2
- `competitive-landscape.md` — why the ordering above makes sense
  vs. PostHog, Mutiny, Optimizely

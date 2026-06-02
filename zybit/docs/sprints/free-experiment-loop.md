# Free experiment loop — audit → cockpit → one free experiment

**Status:** Spec — drafted 2026-05-29 (PM + founder working session).
**Owner:** founder ask — *"the audit gives us the wrong people. I like the
logic the audit surfaces, so can we re-wire the audit into getting people
into the Zybit cockpit? The audit gives us founders, but we want PMs."*

The `/demo` proved the engine is real: deterministic bucketing
(`src/lib/experiments/bucketing.ts`), proxy variant injection, assignment
logging, outcome computation, and the `/app/loop` timeline all work
end-to-end against commitmint.app. **What's missing is the on-ramp:** a
way for a cold PM to feel that loop close — detect → propose → result —
in one sitting, with zero install, and then hit a wall that makes them pay.

This sprint builds that on-ramp. It does **not** rebuild the engine.

---

## 0. The reframe

The public audit (`docs/sprints/url-audit-lead-magnet.md`) is a *report*
funnel. "Paste your URL, get a free audit" is **owner-bait** — the person
who emotionally owns a public site is the founder. PMs don't think they
own the marketing page; they own the **funnel and its metrics**. So the
offer itself self-selects the wrong persona.

We are not deleting the audit. We are **demoting it from product to
engine.** The hero offer flips:

> ~~"Get a free audit"~~ → **"Try one free experiment"**

The audit logic now runs *silently* to manufacture a PM's first finding,
so there's something concrete to run an experiment on. The experiment —
not the report — is the thing the prospect came for, and the cockpit (not
the inbox) is where they land.

We already capture **role** (PM / founder / engineer / designer) on the
form (`src/app/audit/page.tsx`). Today we throw that signal away. We'll
use it to route.

---

## 1. The flow

```
"Try one free experiment"            ← landing CTA (replaces "free audit")
        │  click
        ▼
Enter site URL  ·  work email  ·  role        ← keep the 3 fields we have
        │
        ▼
[ audit engine runs silently ]       ← runStructuralAudit(), ~5–10s, synchronous
        │                              src/lib/intake/structuralAudit.ts
        ▼
"Here's an experiment we'd run on you:        ← auto-generated brief (§3)
   change  «Learn more»  →  «Start free»"
        │
        ▼
PROJECTED RESULT shown inline:                ← reuse fix-preview + impact estimate
   ┌─────────────────────────────────────┐
   │  Before [shot]   |   After [shot]    │   src/lib/audit/fixPreview/
   │  Projected: +8–15% on checkout       │   src/lib/phase2/rules/impactEstimate.ts
   │  ~$3–6k/mo (your numbers)            │
   │  PROJECTED — not yet measured        │   ← honesty label, non-negotiable
   └─────────────────────────────────────┘
        │  "Save this to your cockpit"
        ▼
Magic-link sign-in  →  cockpit               ← reuse existing auth + auto-provision
        │
        ▼
Cockpit: the experiment + its projected result + a /app/loop timeline entry
        │
        ▼
2nd experiment?  →  HARD BLOCKED             ← one per company (org), then upgrade
        │
        ▼
"Run it on REAL traffic" / "Run another"  =  UPGRADE  →  existing Stripe checkout
```

### The five locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Audit's role | Invisible engine; hero CTA becomes **"Try one free experiment"** |
| 2 | Audience | Target PMs; **reuse the role field** already captured to route |
| 3 | Free-experiment target | **Zero-install proxied preview** — no DNS/snippet |
| 4 | The "result" | **Projected impact** (before/after + projected lift/$), honestly labeled |
| 5 | Paywall | **Hard cap: one experiment per company (org)**, then blocked → upgrade |

---

## 2. What we reuse vs. what we build

The point of this sprint is how little is net-new. Verified against the
codebase:

### Reuse as-is (already built, callable independently)

| Piece | Where | Notes |
|---|---|---|
| Synchronous teaser finding | `src/lib/intake/structuralAudit.ts` (`runStructuralAudit`, ~5–10s) | Returns one of: `no_h1`, `no_above_fold_cta`, `heavy_form`. Deterministic, grounded in HTML. Enough to bootstrap a brief. |
| Before/after fix preview | `src/lib/audit/fixPreview/generateFixPreviews.ts` | Tier 1/2/3 cascade → before+after screenshots. Dependency-injected, DB-persist optional. |
| AI variant advisor | `src/lib/experiments/aiAdvisor.ts` + `/api/dashboard/experiments/ai-suggest` | finding + snapshot → safe `VariantModification[]` (selector + change). Selector allowlist + safety guards already enforced. |
| Projected impact estimate | `src/lib/phase2/rules/impactEstimate.ts` | → `{ value, unit, period, formatted, basis }`. **See §4 — input gap for cold findings.** |
| Bucketing / proxy / variant inject | `src/lib/experiments/bucketing.ts`, `src/lib/experiments/proxy/handler.ts` | Already serves a side-by-side preview via `?_zb_force=variant` (handler.ts:54–59, demo path). |
| Stripe checkout + webhook | `src/app/api/billing/checkout/route.ts`, `src/lib/billing/stripe.ts` | POST `{ planId }` → Checkout session → webhook writes `organizations.plan`. |
| Magic-link auth + auto-provision | `src/app/api/auth/request-link-from-audit`, `src/app/api/audit/public/confirm` (auto-provisions org+user, source=`public_audit`) | Signed HMAC handoff already exists. |

### Build net-new

| Piece | Why it doesn't exist yet |
|---|---|
| **Landing reframe** | CTA + copy flip to "Try one free experiment" (PM language, not "free site report"). |
| **Rule → prescription templates** | The advisor needs `finding.prescription.{whatToChange, whyItWorks, experimentVariantDescription}`. The 3 structural rules ship hardcoded prescription *strings* but not the shaped object. Small mapping: 3 rules → 3 templates (§3). |
| **"Preview experiment" concept** | Statuses today are `draft / running / completed / stopped`; only `running` serves real traffic via the proxy. A projected preview must (a) **never** reach real visitors and (b) **still** show in the cockpit + loop timeline. Recommend a `previewOnly` boolean flag, not a new status (§5). |
| **Projected impact for a cold finding** | `impactEstimate` needs behavioral volume the structural audit can't supply (§4). |
| **One-free-per-org gate** | `organizations` has no usage column. Needs a migration (`freeExperimentUsedAt`) + atomic claim + enforcement at launch (§6). |
| **Upgrade moment UI** | `SettingsView.tsx` shows no plan/upgrade today; the only upgrade signal is a raw 402. Need a locked-state + upgrade CTA (§6). |
| **Flow orchestration** | The glue: URL → audit → prescription → advisor → brief → preview experiment → projected result, as one funnel. |

---

## 3. Manufacturing the first experiment (audit → brief)

The advisor pipeline is complete *except* its upstream input. The
structural audit emits a finding with a hardcoded prescription *string*;
the advisor wants a prescription *object*. We bridge with a tiny
per-rule template:

| Rule | Suggested change (template) | Modification type |
|---|---|---|
| `no_above_fold_cta` | Insert / surface a primary CTA above the fold | `element-insert` / `css-inject` |
| `no_h1` | Promote the lead headline to a real H1 with value-prop copy | `text-replace` |
| `heavy_form` | Hide non-essential fields beyond the first 3 | `element-hide` |

Flow: `runStructuralAudit(url)` → map rule to prescription object →
`aiAdvisor` produces a safe `VariantModification[]` against the live
snapshot → that becomes the experiment brief. The PM sees a concrete,
pre-filled experiment, not a blank builder. (They *can* edit it, but the
default path is one click.)

**Fallback (DECIDED 2026-05-29 — honest per failure mode):**

| Audit result | Response |
|---|---|
| `no_finding` (page is clean) | Offer a **starter experiment template** (e.g. hero-CTA copy A/B) so the PM still feels the loop close. Honors the CTA's promise for everyone. |
| `spa` (client-rendered) | **Pivot to "connect your data"** — we genuinely can't proxy-modify a client-rendered page, so don't pretend. Route toward onboarding/paid. |
| `error` (network/parse) | Retry once, then fall back to the connect-data pivot. |

---

## 4. ⚠️ The one real gap: projected impact for a cold finding

`impactEstimate.ts` is honest by design — it computes a count from
`affectedRate × windowVolume × windowDays` and only attaches a **$**
figure when `goalConfig` (revenue/AOV) is present, otherwise it stays in
"engagement" mode and omits dollars (intentionally — fabricated $
undermines trust). **But a cold structural finding has no behavioral
volume** (no PostHog data yet), so the normal inputs are absent.

So "+8–15%, ~$3–6k/mo" can't come out of the existing estimator unaided.
Two honest ways to produce it:

- **(A) — Recommended: ask for their numbers + use benchmark ranges.**
  Add one lightweight micro-step to the free flow: *"Roughly how many
  monthly visitors / what's your monthly revenue?"* (Onboarding already
  collects revenue/AOV for exactly this reason — we'd just pull it
  forward.) Combine with a per-rule benchmark **range** (e.g. "CTA copy
  changes typically move conversion 5–15%") to produce a *range*, clearly
  labeled **projected**. Their numbers → it feels like *their* projection,
  not a generic stat.

- **(B) — No numbers: benchmark range only, no dollars.** Show only the
  percentage range from published benchmarks, omit $ entirely until they
  connect data. Lower friction, weaker hook.

Recommendation: **(A)**, because it doubles as light qualification (a PM
who'll type their revenue is more serious than a tire-kicker) and reuses
the onboarding revenue-context field.

> **DECIDED 2026-05-29: (A) — ask for numbers + benchmark range.** One
> micro-step pulls forward the onboarding revenue/AOV field; per-rule
> benchmark ranges produce a *projected* %, multiplied by their numbers
> for a $ range. Always labeled **projected**. The ask doubles as light
> qualification.

---

## 5. The "preview experiment" representation

A projected preview must look real in the cockpit and on the loop
timeline, but must **never** be served to real visitors.

- Add `previewOnly: boolean` (default `false`) to `zybitExperiments`.
- **Proxy:** the config query that publishes running experiments
  (`/api/proxy/config`, `loadProxyConfig`) excludes `previewOnly = true`.
  Belt-and-suspenders: even if it leaked, no real site is behind the proxy
  for a cold prospect.
- **Loop timeline** (`src/app/app/loop/page.tsx`): include preview
  experiments, but render the result row as **"Projected"** (badge),
  distinct from a measured outcome. The detect → propose → projected
  result arc is what closes the loop visually.
- Status reuse: a preview can sit in `draft`/`completed` semantics; the
  flag — not a new status — carries the "not real traffic" meaning. Keeps
  the existing state machine intact.

---

## 6. The paywall: one experiment per company, then a wall

**Gate unit = org (the company profile).** Lifetime, not daily — the user
said "block them off after that."

- **Migration:** add `organizations.freeExperimentUsedAt timestamptz null`.
- **Claim atomically** at launch so two tabs can't both win:
  `UPDATE organizations SET free_experiment_used_at = now()
   WHERE id = ? AND free_experiment_used_at IS NULL` — proceed only if a
  row was updated.
- **Enforce in `launchExperimentAction`** (`src/app/app/findings/[id]/experiment/actions.ts`).
  Note: today this server action does **not** call `checkPlanLimit` (only
  the API route does, on `startImmediately`). We add the free-gate check
  here, where the draft→live transition actually happens.
- **Blocked state:** when `plan` is the free default and
  `freeExperimentUsedAt IS NOT NULL`, a second launch is blocked with a
  clear upsell — not the raw 402. Reuse the 402 envelope
  (`planLimitExceeded`, `src/app/api/phase1/_shared.ts`) but render a
  proper locked card.
- **Upgrade:** "Run on real traffic" / "Run another" → existing
  `/api/billing/checkout` with `planId: 'starter'` → Stripe → webhook
  flips `organizations.plan`. **No new billing tier required.** The free
  experience *is* the free tier; Starter unlocks real traffic + concurrency.
- **Upgrade UI:** add plan display + upgrade CTA to `SettingsView.tsx`
  (none today) and the locked card in the experiment/cockpit surface.

> **Note on "free plan" naming:** a test asserts `'free'` is not a valid
> plan id (`src/lib/billing/__tests__/plans.test.ts`). We do **not** need a
> `free` plan in `PLAN_LIMITS` — we gate on `freeExperimentUsedAt` for orgs
> still on the default, and "upgrade" moves them to `starter`. Avoids
> touching the plan enum entirely.

---

## 7. Open questions (for review)

1. ~~**Projected-impact inputs (§4):**~~ **DECIDED — (A) ask-for-numbers + benchmark range.**
2. ~~**No-finding / SPA fallback (§3):**~~ **DECIDED — both, by case:**
   no_finding → starter template; SPA → connect-data pivot; error → retry then pivot.
3. **Auth timing — FLEXIBLE, owned by cofounder.** Whether the projected
   result shows inline-before-sign-in or behind a sign-in gate is left
   open; the cofounder is working this. **Build implication:** treat
   sign-in as a pluggable seam — the projected-result render and the
   account-provision step must be decoupled so either ordering drops in
   without rework. Don't hard-wire the funnel to one choice.
4. ~~**Founder submissions:**~~ **DECIDED — same full flow + an "invite your
   PM to run it for real" nudge** in the cockpit/result. Founders become a
   channel to the PM rather than a rejection; nobody is turned away.
5. ~~**Preview cost containment:**~~ **DECIDED — reuse existing public-audit
   rate limits + daily budget cap** (`src/lib/audit/publicAuditRateLimit.ts`,
   `public_audit_budget`). The silent audit run is the same spend profile as
   today's public audit, so the same guards apply.

---

## 8. Build plan (phased, each shippable + reviewable)

Per the team's per-step loop (review → test → run/verify → commit each step):

1. **Schema + flag foundation.** Migration: `organizations.freeExperimentUsedAt`,
   `zybitExperiments.previewOnly`. Proxy config excludes `previewOnly`.
   *(no UI yet; unit-test the gate + proxy exclusion)*
2. **Rule → prescription templates + brief manufacture.** Glue
   `runStructuralAudit` → prescription → `aiAdvisor` → brief.
   *(test against 2–3 live URLs)*
3. **Projected impact (per §4 decision).** Micro-step for numbers +
   benchmark ranges → projected result object, honesty-labeled.
4. **Preview experiment + loop timeline.** Create `previewOnly` experiment
   from the brief; render "Projected" entry on `/app/loop`.
5. **Free-gate enforcement + atomic claim** in `launchExperimentAction`.
6. **Upgrade moment.** Locked card + plan display + upgrade CTA →
   existing checkout.
7. **Landing reframe.** CTA + copy flip; role-based routing.
8. **End-to-end verify** against a fresh cold URL: CTA → projected result
   → sign in → cockpit/loop → blocked on 2nd → upgrade.

---

## 9. Out of scope (explicit)

- Real-traffic measurement for the free tier (that's the *paid* unlock).
- Rebuilding bucketing / proxy / outcome computation — all proven in `/demo`.
- New billing tier or plan-enum changes.
- The founder-approval queue and 90-day TTL deferred in the audit spec.
</content>
</invoke>

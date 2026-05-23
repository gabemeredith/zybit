# Pilot readiness — what's left to onboard a first customer

**Status:** Live checklist. **Date:** 2026-05-23.
**Companion doc:** [`onboarding-redesign.md`](./onboarding-redesign.md),
[`operator-dashboard.md`](./operator-dashboard.md),
[`sprint-3-deferred.md`](./sprint-3-deferred.md).

The product (deterministic 6-step loop + PRD Milestone 1 flow-graph advisory)
is built and live-verified end-to-end. This document is the punch-list for
getting that build in front of a paying pilot customer.

---

## A. Environment gates (no code, just config)

| # | Item | Status | Where |
|---|------|--------|-------|
| A1 | `AXIOM_DATASET=axiom-audit` in Vercel | ⬛ Action needed | Vercel project env vars. Token already verified. Activates structured log drain. |
| A2 | `STRIPE_WEBHOOK_SECRET` in Vercel | ⬛ Action needed | Stripe → Webhook endpoint → Signing secret. Production endpoint, not test mode. |
| A3 | `STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE` in Vercel | ⬛ Action needed | Stripe → Products → copy each price's `price_xxx` id. |
| A4 | DNS record `*.zybit.run` → Vercel target | ⬛ Verify, then leave | One CNAME at the registrar. Only matters when a customer pulls the deploy loop, but cheap to set up now. |
| A5 | Cronitor heartbeats — 5 monitors live | ✅ Live | `refresh-snapshots`, `refresh-captures`, `check-selectors`, `sync-posthog`, `sync-ga4`, `compute-outcomes`. |
| A6 | Resend ops-email destination configured | ✅ Live | `RESEND_OPS_EMAIL_TO` |

A1–A3 are **the unblocking work**. They are env-var changes, not engineering.
They should be done before the first pilot signup and re-verified once a week.

---

## B. Code gaps blocking a pilot

| # | Item | Status | Notes |
|---|------|--------|-------|
| B1 | **Flow-graph pre-flight check** | ✅ Built (this session) | `computeFlowPreflight` + `GET /api/phase2/sites/:siteId/flow-preflight` + `runFlowPreflightAction`. PRD §5 dependency now answerable per customer. |
| B2 | **Onboarding redesign** — drop the proxy step, hook pre-flight into the analytics step | ⬛ Scoped, awaiting approval | See `onboarding-redesign.md`. About 1 dev-day. |
| B3 | **Operator dashboard** (Zybit-156) | ⬛ Scoped, not built | See `operator-dashboard.md`. About 1.5 dev-days. MVP read-only. |
| B4 | **PR #66 (AI Variant Advisor backend)** | 🟡 Parked | See `sprint-3-deferred.md`. Not on pilot critical path. |
| B5 | **Layer 2 calibration accumulates real outcomes** | ⬛ Inert until data | Works mechanically. Becomes meaningful at 3+ concluded experiments per rule per site — pilot's natural cadence. No code action. |

---

## C. Pilot operational readiness

These are not engineering tickets. They are the things a founder does
before the first commercial conversation.

### C1. Pre-pilot prerequisite check (per candidate customer)

Before saying yes to a pilot, run this five-minute conversation:

| Question | Yes → proceed | No → coach or decline |
|---|---|---|
| Do you use PostHog or Segment for product analytics? | ✅ | GA4 only → flow graph degraded; offer the page-level audit only |
| Roughly how many sessions per week on the part of the product we'd analyse? | ≥ 350 (50/day) → ✅ | < 350 → ask for a larger property scope or wait |
| Are page views captured with a stable session id and a `path`/`$current_url` property? | ✅ | Coach: typical PostHog default; usually a yes |
| Is there one PM who will look at findings weekly? | ✅ | No champion → decline politely |
| Are you willing to share an aggregate MRR or AOV estimate (for dollar framing)? | ✅ | Optional, not a blocker |

The first two questions are the only hard gates. The pre-flight check
(B1, built this session) confirms the answer mechanically within five
minutes of the customer connecting PostHog.

**For prospects who do not yet use PostHog:** share
[`posthog-from-zero.md`](./posthog-from-zero.md) — a self-serve recipe
that gets them from zero to a connected Zybit account on PostHog's
free tier in about 30 minutes.

### C2. Demo-quality flow graph

What to show in a pre-pilot conversation:

- **Option A — their own data.** Best. Customer connects PostHog read-only;
  Zybit displays `/app/flow` populated with their actual product. Pre-flight
  check tells the founder in advance whether the demo will be flat.
- **Option B — Lighthouse URL-audit mode** (shipped 2026-05-22, PR #65)
  against a public site they know well (their own marketing site, or a
  competitor). Live-verified end-to-end against posthog.com → 14 findings.
  This is a "what the findings look like" demo, not a "what your data
  looks like" demo. Both are valuable.
- **Option C — internal demo seed** (Zybit-127/128, not built). Synthetic
  data on a fake site to show the loop in a closed-door demo. Lower
  priority: Lighthouse URL-audit covers most of this use case.

Recommendation: do Option A if pre-flight is green, fall back to Option B
otherwise. Skip Option C.

### C3. Pilot pricing and terms

Treat the first three pilots as **learning, not revenue.** The deliverable
the founder is paying for is the answer to PRD §7: *did the PM say "now
let me fix this?"* Pricing should be:

| Tier | Audience | Price | What they get |
|---|---|---|---|
| **Design partner** (first 3) | Founders the team knows personally | $0 for 60 days, then negotiated | Full advisory, founder Slack channel, exclusive pricing on conversion |
| **Pilot** (next 5) | Inbound or referred | $500/month, 30-day money back | Full advisory + email support |
| **Starter** | Self-serve | Stripe price already plumbed | Plan limits enforced |

Contract template: lightweight. One-page MSA + DPA (GDPR/SOC2-lite — Zybit
does not have SOC 2 yet; acknowledge this in writing). The DPA matters even
in pilots because customer PostHog data flows through Neon.

Action items for the founder, not engineering:
- Draft the one-page MSA + DPA. A lawyer-reviewed template costs $500-1k
  on Common Paper or LegalSifter.
- Decide on the design-partner pricing structure.
- Identify the first 3 design-partner candidates.

### C4. Day-1 runbook (when a pilot signs up)

1. Founder adds the customer email to invite allowlist via `/app/admin`.
2. Customer hits magic-link sign-in, lands in onboarding.
3. Customer enters URL → connects PostHog → **pre-flight verification
   confirms data is flowing**.
4. Customer skips/completes revenue framing → lands in `/app/flow`.
5. Founder watches `/app/admin/ops` (B3, when built) to confirm the first
   sync completed; or queries Neon for now.
6. First-insight email goes out automatically when the first finding lands.
7. Founder follows up at 24h, 72h, 7d — these are the touchpoints that
   determine whether the pilot succeeds, not the code.

---

## D. The decision tree at the end of the pilot

This is PRD §7 made operational:

```
Pilot ends — did the PM ever ask "now let me deploy a fix"?
│
├── YES → Phase 2 is pulled. Build Zybit-149 (client runtime) first.
│         Then unfreeze PR #66 + Zybit-145/146/147 in dependency order.
│         Operator dashboard upgrades from "useful" to "required."
│
└── NO  → The advisory is not yet enough on its own.
          Either: (a) the findings were not credible — focus on Identify/
                       Propose quality + Layer 2 calibration data
                  (b) the PM had no authority to deploy — pilot the wrong
                       persona; retarget GTM
                  (c) the price point was wrong
          Two more pilots before re-deciding the PRD scope.
```

Either branch is a win. That is the point of sequencing it this way.

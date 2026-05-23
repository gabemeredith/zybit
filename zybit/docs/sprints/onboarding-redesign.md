# Onboarding — current audit and proposed simplification

**Status:** Proposal. **Date:** 2026-05-23.
**Owner:** triggered by founder feedback — "heavily complex, doesn't really
make sense even for a closed rollout."

This document audits the current four-step wizard with concrete file
references, lists what's wrong, and proposes a contracted flow aligned with
the new PRD (read-only flow-graph advisory, single milestone). The proposal
is reversible: each existing step is preserved as a settings panel a
customer can opt into when they pull the deploy loop.

---

## 1. Current flow (as built)

Entry: `src/app/app/onboarding/page.tsx` →
`src/components/app/OnboardingWizard.tsx`.

| Step | Title | Asks | Server action | Skip? |
|------|-------|------|---------------|-------|
| **1** | "What are we analyzing?" | `domain` + optional `name` | `createSiteAction` (`actions.ts:17`) | No |
| **2** | Proxy slug + DNS verify | `proxySlug` (`acme-proxy`) + `customerSubdomain` (`experiments.acme.com`) + CNAME verification | `saveProxySetupAction` / `verifyProxyDnsAction` (`proxyActions.ts`) | **Yes** |
| **3** | "Connect your analytics" | provider tab (PostHog or Segment) + host/projectId/apiKey OR webhook URL/bearer | `createIntegrationAction` (`actions.ts:68`) | **Yes** |
| **4** | "Unlock dollar-impact findings" | monthlyRevenueCents + avgOrderValueCents | `saveSiteMetaAction` (`actions.ts:116`) | **No** (Zybit-113) |

Inference logic at `OnboardingWizard.tsx:497-505` jumps the user to the
furthest unfinished step based on persisted state.

---

## 2. What's wrong with this, plainly

### 2a. Step 2 (proxy + DNS) is dead weight under the new PRD

The proxy is the deploy-side substrate for the `Test` step of the loop. The
ratified PRD defers the entire deploy/runtime/experiment workstream until a
customer pulls it. **Step 2 asks a brand-new customer to set up DNS records
for a capability they will not use during the pilot.** It is the single
biggest reason this onboarding feels "complex for closed rollout."

Concretely: a PM evaluating the advisory has no reason to know what a CNAME
is, has no authority to add one without a 3-day Slack thread with their
infra team, and the slug they pick now will be wrong six weeks later when
their infra team weighs in.

### 2b. Step 3 (analytics) has no verification feedback

`createIntegrationAction` stores the encrypted key and returns success. The
PM never finds out whether:
- the key actually works against the PostHog API,
- their events are reaching `phase1_events`,
- their event volume / route diversity is enough for the flow graph to be
  informative.

The `validate` route (`/api/phase2/integrations/[id]/validate`) exists but
is **PostHog-only**, only callable by API key with the `integrations:manage`
scope, and is not wired into the wizard.

This is the gap the new **flow pre-flight check** addresses (built this
session — `src/lib/phase2/flow/preflight.ts` +
`GET /api/phase2/sites/[siteId]/flow-preflight`).

### 2c. Step 4 (revenue) is mandatory and arrives without context

The Zybit-113 work made MRR/AOV non-skippable. The UI copy ("Estimates
only. Used for prioritization framing, never shared.") is buried below the
heading; on first read the PM sees "enter your revenue" and either lies or
bounces. This is the only point in the flow where we ask for something
*sensitive* — and it's the last thing, after they've already done DNS work.

### 2d. The order is wrong for the advisory

Today: site → proxy → analytics → revenue.
What the advisory needs to function: site → analytics → revenue.
What the advisory needs to be *believable* on first session: + verification
that analytics is actually producing a graph.

### 2e. The persisted state inference creates dead-ends

If a PM completes step 1 and 2 but never step 3, they land on step 3 every
time they revisit `/app/onboarding`. There is no "skip everything, take me
to the dashboard" affordance once they've started — only per-step skips.

### 2f. Skip buttons make commitment feel optional and then settings are scattered

A PM who skipped step 3 has no obvious path to come back and connect their
analytics. Settings (`/app/settings`) does expose connector management
indirectly, but the wizard does not link to it on skip.

---

## 3. Proposed flow — contracted to the advisory

Three steps. The proxy is gone from the critical path. Verification is
explicit. Revenue framing is reframed.

```
[1] Tell us what to analyze.
    ─────────────────────────
    Site URL + (optional) display name.
    Same as today's step 1.

    → on submit: createSiteAction

[2] Connect your analytics.
    ─────────────────────────
    PostHog | Segment | GA4 (tabbed).
    Required fields per provider, same as today's step 3.

    → on submit: createIntegrationAction
    → THEN: runFlowPreflightAction(siteId) and render the result inline.

    Verification panel (the new bit):
      ✅ Connected — we see N sessions across M routes in the last 7 days.
                    Your flow graph is ready. → [Continue]
      ⚠️  Connected — but events look thin (N sessions, M routes).
                    You can still continue; the graph will fill in as data
                    arrives. → [Continue anyway] [Re-check]
      🛑 Connected — but events lack a session id / path. Fix this in your
                    SDK and re-check. → [Re-check] [Skip for now]

[3] Help us frame the impact.
    ──────────────────────────
    Two short questions:
      • Roughly how much revenue does this product produce per month? ($X)
      • What's a typical conversion worth? ($Y)
    "We use these to show each finding as 'about $Z/month' instead of just
    severity labels. Estimates only — refine in settings any time."

    → on submit: saveSiteMetaAction
    → router.push('/app/flow')   // land them in the product, not /app
```

**Total time-to-graph: under 90 seconds** assuming the customer has a
PostHog Personal API Key handy (the only thing that materially blocks
faster).

### What happens to the proxy step?

Moved out of the wizard entirely. Lives as `/app/settings/deploy` —
revealed in three places:

1. A passive entry in the settings nav, **collapsed by default**, labelled
   *"Deploy a fix (advanced)"*.
2. The "Run experiment" affordance on a finding detail page (which today
   takes the PM into the experiment builder) — if proxy is not configured,
   we surface a one-page inline DNS guide right there, in the context where
   the deploy actually matters.
3. A cockpit nudge that only appears once the PM has explicitly clicked
   "Run experiment" on at least one finding (i.e. signalled intent to deploy).

This matches PRD §1's "Phase 2 is pulled by a customer, not scheduled by
us." A PM who only wants the advisory never sees DNS.

### Why keep revenue at the end and not first?

Three reasons:
1. We have already given them something (a working connection + a number
   of sessions detected). The ask doesn't feel transactional.
2. The copy can now be concrete: *"We saw 1,243 sessions in the last week.
   Tell us your AOV and we'll attach a dollar estimate to every finding."*
3. Skipping is cheap — `saveSiteMetaAction` upserts; they can do it later
   from settings. Should we make it skippable here too? Yes — see §5.

---

## 4. Migration plan

This is a UX redesign on top of code that exists. No new server code is
needed for the three-step path **except** the pre-flight call (already
shipped this session).

| Change | File | Effort |
|---|---|---|
| Drop step 2 from `OnboardingWizard.tsx` | `src/components/app/OnboardingWizard.tsx` | 1h — remove `ProxySetupForm` branch, renumber progress bar to 3 steps |
| Hook `runFlowPreflightAction` into step 2 (was 3) | same | 2h — add verification panel after `createIntegrationAction` returns; component renders `PreflightReport` |
| Reframe step 4 → 3 with concrete session count | same | 1h — pass session count from preflight; reword copy |
| Final redirect → `/app/flow` not `/app` | same | 5m |
| Move proxy setup to `/app/settings/deploy` | `src/app/app/settings/` new page; reuse `ProxySetupForm` `variant="settings"` | 2h |
| Cockpit nudge "deploy is set up at /app/settings/deploy" — only after first experiment intent | `src/components/app/CockpitView.tsx` | 1h |

Total: **about 1 dev-day** of UI work. No schema changes. The old proxy
slug + DNS records remain valid for any existing customer.

### Backwards compatibility

Existing organisations with `proxySlug` already set keep it; the settings
page reads the same `phase1_sites.proxySlug` field. The inference at
`OnboardingWizard.tsx:497-505` simplifies to:

```ts
if (!existingSite) inferredStep = 1;
else if (!hasIntegration) inferredStep = 2;
else inferredStep = 3;
```

---

## 5. Open questions

1. **Should step 3 (revenue) be skippable?** Zybit-113 made it mandatory.
   In the contracted PRD the answer should be *yes, with a "I'll add this
   later" link* — dollar framing is a nice-to-have for the advisory, not a
   gate. The cockpit can prompt for it on first visit if missing.
2. **What about GA4 in the wizard?** GA4 is currently an aggregate-grain
   connector (no session id), so the pre-flight will always return `empty`
   with `session-id-missing` on a GA4-only setup. Decision: surface GA4 in
   the connector tabs but warn at selection time that the flow graph is
   not supported on aggregate data, with a "use PostHog or Segment for the
   flow graph" recommendation.
3. **Single connector or many?** The current code allows one integration
   per provider per site. The wizard should not let the user pick more
   than one provider — keep step 2 single-provider; add additional
   connectors only from settings.
4. **Apple-style "we'll keep this for you" persistence.** If the PM
   abandons step 1 at the URL field, do we save it? Current code does not.
   Reasonable to leave alone.

---

## 6. Recommended next step

I have the redesign scoped to a single PR. Before opening it I want
explicit founder approval on:

- Drop step 2 (proxy) from the wizard? (recommendation: **yes**)
- Step 3 (revenue) becomes skippable? (recommendation: **yes**)
- Land in `/app/flow` instead of `/app`? (recommendation: **yes**)

Once confirmed, the PR is one day's work and lands the new flow on the
`claude/wizardly-heisenberg-w0Sau` branch already in play.

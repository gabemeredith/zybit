# Public URL-audit lead magnet

**Status:** Proposal. **Date:** 2026-05-23.
**Owner:** triggered by founder ask — *"how do we get rid of PostHog
readiness as a Day-0 gate?"* This is the answer: let any prospect
paste a URL and see Zybit reason about their product in 60 seconds,
no signup, no install.

The engine for this already exists. Lighthouse URL-audit mode
(merged in PR #65) crawls a live site via Firecrawl, runs the
real snapshot pipeline, and produces findings — live-verified
end-to-end against posthog.com → 14 findings. **What's missing
is just the public-facing wrapper.**

---

## 1. Why this is the right next bet

Today's customer funnel:
1. Prospect lands on Zybit
2. Signs up
3. Signs up for PostHog (if they don't have it)
4. Installs PostHog snippet on their site
5. Generates Personal API key
6. Connects to Zybit
7. Waits 1-7 days for the flow graph to populate
8. *Maybe* sees value

Steps 3–7 are the dropout zone. The PostHog-from-zero recipe
(`posthog-from-zero.md`) cuts this to ~30 minutes, but it is still
30 minutes of work *before any value*. For a tire-kicker, that is
infinite.

Day 0 with URL-audit becomes:
1. Prospect lands on Zybit
2. Pastes URL
3. **Sees 3 findings on their actual site in 60 seconds**
4. Signs up to see the rest
5. *Then* connects PostHog for the continuous-loop story

The 60-second loop changes everything about inbound. It is also
the most credible demo we will ever have, because it is run on
their own product.

---

## 2. What it produces

12 of the 13 audit rules fire from a static crawl — the
flow-aware rule (`flow-inter-step-dropoff`) needs session data
and stays gated to connected customers. **That is a feature, not
a limitation:** it gives us a concrete upsell story
("connect your analytics to see the flow graph and inter-step
drop-offs you cannot see in a static crawl").

Rules that fire from a static crawl include:
- All 5 design rules (hero-hierarchy-inversion, cta-low-contrast,
  nav-dispersion, dead-state, snapshot-drift)
- The 7 pain rules that read from rule-specific signals derived
  from the page itself (not from user behaviour)

Lighthouse URL-audit against posthog.com produced findings
spanning hero-hierarchy-inversion, rage-click-target, and
nav-dispersion — see PR #65.

---

## 3. Architecture — reuses everything

```
Marketing page (or app subpage)
  └─ "Paste your URL" form (1 field + Cloudflare Turnstile)
       └─ POST /api/audit/public
              │
              ├─ Rate-limit by IP (10/day, 1/min)
              ├─ Turnstile verify
              ├─ Validate URL (no internal/RFC1918, no auth)
              ├─ Trigger existing Lighthouse URL-audit pipeline:
              │     Firecrawl /v1/map → snapshot → audit rules
              ├─ Persist as a "public audit" record (no org)
              └─ Return public-audit-id
       └─ Redirect to /audit/[id]

/audit/[id] (public page, no auth)
  ├─ Render 3 highest-priority findings (full evidence, full prescription)
  ├─ Render the rest with title + severity blurred + "sign up to see"
  ├─ "Get full report — email it to me" form
  │     └─ Email-gates the full findings (no full signup required)
  └─ "Connect analytics for the flow graph" CTA → onboarding
```

Two new routes (`/api/audit/public`, `/audit/[id]`), one new schema
(`public_audits` table — single row per audit, no PII, includes
target URL + findings JSON + email-claimed-at). The audit pipeline
itself is unchanged.

---

## 4. The mandatory guardrails

This is a *public* endpoint that triggers Firecrawl crawls and
Browserless renders. Without guardrails it is an unbounded
spending bomb.

| Threat | Guardrail |
|---|---|
| Spam audits burning Firecrawl/Browserless dollars | IP rate-limit 10/day, 1/min, fronted by Cloudflare Turnstile |
| Audits against private/internal hosts (SSRF) | URL validator rejects RFC1918, localhost, link-local, .local, .internal, any IP literal |
| Audits behind auth (cookie-gated) | We never send cookies; if Firecrawl returns 401/403, we return "this site requires authentication — connect your analytics for an authenticated audit" |
| Hostile pages crashing Browserless | Existing Browserless timeout + per-page memory cap apply |
| Email-grab harvesting | Single-use email-claim per audit-id; rate-limit emails per IP |
| GDPR / "we audited you" complaints | Public-audits table holds no PII; the audited site's owner can request deletion via support email (cheap to honour because there's nothing else to delete) |
| Cost runaway | Hard daily $-cap on the `/api/audit/public` route; over the cap, queue + email-when-ready instead of synchronous |

---

## 5. Positioning — three sentences that have to be right

The risk is anchoring prospects to "Zybit = free audit tool." The
copy has to make the audit feel like a *teaser*, not the product.

Draft:

> **"60-second audit of any URL — no signup."**
> Zybit's audit rules read your page like a senior PM would: ranked
> friction, evidence, what to change, what it's worth in dollars.
> The full picture — flow drop-offs, weekly digests, learning what
> works on *your* product — needs your analytics connected.

The third sentence does the work of the upsell. Without it,
prospects walk away with the 3 findings and never come back.

---

## 6. Phased implementation

### Phase A — Working endpoint, ungated email (3-4 days)

1. `public_audits` schema + migration.
2. `/api/audit/public` route — rate-limit, Turnstile verify, URL
   validate, dispatch to the existing Lighthouse URL-audit job.
   Synchronous; the audit completes in ~30-60s for a typical site.
3. `/audit/[id]` page — render full 12-ish findings with evidence
   and prescription. Phase A is intentionally **not** gated — get
   the engine working end-to-end first.
4. Cloudflare Turnstile site-key + secret in env.
5. Cost monitor — Cronitor heartbeat for daily Firecrawl/Browserless
   spend.

### Phase B — Gate the upsell (1-2 days)

6. Limit public view to top 3 findings; blur the rest.
7. Email-claim form on `/audit/[id]` — single-use, email-gates the
   full report (no full signup yet).
8. After email-claim, surface "Connect PostHog for the flow graph"
   CTA prominently. Track conversion rate from email-claim to
   onboarding-completed.

### Phase C — Marketing surface (2 days, may be cofounder, not engineer)

9. Public landing at the Zybit root (or a dedicated `/audit` page)
   with the form prominent above the fold.
10. Examples of past audits ("here is what we found on [public site]").
    Use the Lighthouse URL-audit run on posthog.com as the first
    example — it is already verified to produce 14 findings.
11. Comparison strip ("PostHog gives you graphs. Zybit gives you
    ranked findings. Add Zybit to your PostHog stack in 30 minutes.").

### Total

About 6-8 dev-days for Phases A + B. Phase C is mostly copywriting
and landing-page design — minimum 2 dev-days for the page itself,
unbounded for the marketing iteration on top.

---

## 7. Honest catches

1. **Cost discipline is non-negotiable.** A single trending link
   on Hacker News could trigger thousands of audits in an hour.
   The IP rate-limit + Turnstile + daily $-cap are all required;
   none is optional.

2. **Findings without behavioural data are "what design heuristics
   say."** Some will be wrong because the heuristic does not know
   the context. We surface this explicitly: each finding shows a
   *confidence* score, and static-crawl findings tend to land
   around `0.4-0.7`. Be honest about this in the UI.

3. **The flow graph is permanently the upsell, not the teaser.**
   This is good for the funnel but it means prospects who only
   want a one-shot audit will not convert. That is fine; they
   were not the ICP.

4. **Anchoring risk is real.** "Zybit = free audit tool" is the
   wrong frame. Mitigated by the positioning copy (§5) and the
   prominent connect-analytics CTA — but watch the conversion
   funnel and tune.

5. **Lighthouse URL-audit pipeline is a single Lighthouse code
   path today.** Productionising it as a public endpoint may
   reveal sharp edges (timeouts, memory limits, retries) that
   are forgiven in a developer-run script. Plan a Phase A.5
   for hardening once Phase A is live.

---

## 8. Open questions

1. **Marketing surface location.** Subdomain (`audit.zybit.com`),
   root path (`zybit.com/audit`), or directly on the landing page?
   Recommendation: root path; the audit IS the lead.

2. **Phase B's gating boundary.** 3 findings public, rest gated?
   Or 5 findings public, deep evidence gated? Recommendation:
   3 findings full, rest blurred. Less ambiguous, higher conversion.

3. **Email-claim vs. full signup.** Phase B's email-claim is a
   lighter ask than a magic-link signup. Easier to convert, harder
   to nurture. Decision: start with email-claim, watch the second
   conversion step (email → onboarding) and revisit.

4. **Should we keep audit records permanently?** Public audits
   could pile up. Recommendation: 90-day TTL; the value is in the
   moment of viewing, not in long-term storage.

5. **Anti-abuse: can the same prospect run the audit on competitors?**
   Yes, and this is fine — even expected. The rate limit handles
   adversarial use; the legitimate "let me check 3 competitors" is
   a sales accelerant, not a problem.

---

## 9. Where this sits in the priority list

Top of the list — see `next-bets.md` §1. Before onboarding cleanup,
before the preview system, before deploy loop work. Reasoning:

- It is the only item that materially expands the top of the funnel
  *without* requiring customer setup
- It is the cheapest item to ship (engine exists, ~6 dev-days for
  A+B), so the time-to-value is fastest
- It generates demand data we currently have zero of (which sites
  do people audit? which findings make them sign up? what is the
  conversion rate from teaser to onboarding?)

The PostHog-from-zero recipe stays valuable but moves from "Day 0
entry point" to "Day 1 next step" — for the prospects who like
what they see in the public audit and want continuous insights.

---

## Cross-reference

- `pilot-readiness.md` — operational checklist for converted customers
- `posthog-from-zero.md` — the recipe for converted customers
- `preview-system.md` — depth in the *findings* (parallel work)
- `next-bets.md` — full priority list with this at the top
- `competitive-landscape.md` — why the URL-audit slots in cleanly
  vs. PostHog and Mutiny
- PR #65 — the merged Lighthouse URL-audit work this builds on

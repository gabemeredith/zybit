# Public URL-audit lead magnet

**Status:** Proposal — **positioning revised 2026-05-23 (PM).**
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

## 0. Positioning revision — 2026-05-23

The original proposal (below) rendered the full audit report **on a
public page** for any anonymous visitor. We are reversing that.
Anonymous on-site results are wrong for an invite-only PM tool aimed
at high-profile customers — they cheapen the brand, create a
Firecrawl/Browserless spending bomb anyone can trigger (a single
HN front-page → thousands of crawls), and risk publicly-visible
whiffs from heuristics that don't know the site's context.

### The revised flow

1. **Prospect visits `/audit`** and fills 3 fields: **URL · work
   email · role.** Personal-email domains (gmail/yahoo/hotmail/icloud
   etc.) are rejected at the form. No anonymous traffic; no consumer
   audits.
2. **Audit runs live in-browser** with a visible progress strip
   ("fetching homepage… parsing DOM… running 13 friction rules…").
   Takes ~30-60s end-to-end. **Only one teaser finding is revealed
   inline** — enough proof that the engine is real and ran against
   their actual page.
3. **The full report is delivered by email** — a hand-finished HTML
   one-pager: prospect's domain on the cover, screenshot of their
   site with the friction overlay, **4 findings** (evidence,
   suggested change, est. impact) using the same receipt-card
   pattern as the landing page, single CTA: **book the founders.**
4. **Premium routing (optional, default OFF for v1):** if the
   `role` + email domain match a target ICP, queue the email for
   founder approval before send (Slack notification, ~4 hr SLA).
   The auto-generated artifact is good; this lever exists for when
   a Fortune-500 CMO submits and we want to hand-edit before it
   lands in their inbox. Invisible to the prospect either way.

### Why this beats the original "results on page" plan

| Lever | On-page (v1 of the spec) | Email-delivered (revised) |
|---|---|---|
| Brand image | "Free audit tool" — cheapens premium PM positioning | "Personally-reviewed audit" — feels like a service |
| Lead capture | Anonymous viewers (no contact data) | Work-email + role on every submission |
| Cost containment | Public endpoint = unbounded spend risk | Email-gate dramatically reduces casual abuse |
| Artifact quality | Constrained by browser layout | Full HTML email — receipt cards, screenshots, branding |
| Curation lever | None — what the rules emit is what ships | Optional founder approval queue for ICP leads |
| Conversion mechanism | "Book a call" button below findings | Email CTA + follow-up cadence; the inbox is owned channel |

### Premium positioning copy (replaces §5 draft below)

> **"60-second audit of any URL. Personally reviewed."**
> Tell us your homepage, your work email, and your role. We'll run
> 13 friction rules against your live site and email you a one-page
> report — four ranked findings with evidence, suggested changes,
> and estimated dollar impact. We audit ~10 sites a week. The full
> picture — flow drop-offs, weekly digests, learning what works on
> *your* product over time — comes after you connect your analytics.

The third sentence is scarcity. The fourth is the upsell. Both
matter.

### What stays from the original proposal

The **architecture below (§3) is mostly preserved**: same engine,
same rate-limit, same Turnstile, same SSRF validator. The only
deltas are:

- `/audit/[id]` becomes a **teaser page** (one finding inline,
  rest delivered by email) — not the full report viewer.
- New `auditReportEmail.ts` template + send hook (Resend, fire from
  `/api/audit/public` after the pipeline finishes).
- New `personalEmailDomains.ts` allowlist-style gate on the form.
- Optional `audit_approval_queue` schema (Phase B+, not Phase A) for
  founder review routing.
- Phase B's "gate behind email-claim" collapses into Phase A: email
  is collected up-front, not after the fact.

The sections below are the **original proposal as written
2026-05-23 morning.** Items invalidated by the positioning revision
are flagged inline with **[revised — see §0]**. Phases A/B/C at §6
are rewritten in full.

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

## 3. Architecture — reuses everything **[revised — see §0]**

```
/audit (public marketing page)
  └─ Form: URL + work email + role (PM/Founder/Head of Growth/Other)
       │   ├─ Personal-email-domain reject (gmail/yahoo/...) at submit
       │   └─ Cloudflare Turnstile
       │
       └─ POST /api/audit/public
              │
              ├─ Rate-limit by IP (10/day, 1/min) + by email-domain (3/day)
              ├─ Turnstile verify
              ├─ Validate URL (no internal/RFC1918, no auth, no IP literals)
              ├─ Persist `public_audits` row (url, email, role, status='running')
              ├─ Trigger Lighthouse URL-audit pipeline (Firecrawl + snapshot + rules)
              ├─ On finish: pick **highest-priority finding** as teaser; persist
              ├─ Pick **top-4 findings** for the email report; render template
              ├─ Send via Resend (or queue for founder approval if ICP-routed)
              └─ Return public-audit-id

/audit/[id] (teaser viewer)
  ├─ Polls status until ready (or SSE)
  ├─ Renders ONE finding inline (receipt-card pattern)
  ├─ "We've sent the full report to {email} — usually within the hour"
  ├─ Calendly CTA: "Book the founders to walk through the rest"
  └─ NO blurred-finding peek; NO "sign up to see" anchor. The artifact is the email.
```

New surfaces:
- `/audit` page (public marketing form)
- `/api/audit/public` route (rate-limited, work-email-gated, dispatches the
  pipeline + sends the email)
- `/audit/[id]` teaser viewer (one finding + email-confirmation copy)
- `src/lib/email/auditReportEmail.ts` (HTML template + render function)
- `src/lib/audit/personalEmailDomains.ts` (allowlist-style gate)
- `public_audits` schema (url, work_email, role, status, teaser_finding_id,
  full_findings JSON, email_sent_at, approval_status)
- (Phase B+) `audit_approval_queue` schema + Slack notification for ICP routing

The audit pipeline itself is unchanged — same `runUrlAudit` in
`lighthouse/lib/runner/runUrlAudit.ts`.

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

## 6. Phased implementation **[revised 2026-05-23]**

### Phase A — Visual mock (shipped 2026-05-23, ~0.5 day)

**Goal: founders react to the surface before any backend cost.**

1. `/audit` page (`src/app/audit/page.tsx`) — full form + 4 visible
   states (idle / running / teaser-revealed / email-confirmed),
   no backend wiring. State transitions driven by client timers
   that mimic the real ~45-second pipeline.
2. `auditReportEmail.ts` — full HTML email template, rendered
   from a typed `AuditReport` input. Receipt-card pattern for
   each of 4 findings; founder signature footer.
3. `/audit/email-preview` route — renders the email HTML in an
   iframe with sample data, so the founders can eyeball it without
   running Resend.
4. `personalEmailDomains.ts` — small allowlist of personal-email
   domains to reject at the form (no DB hit; client + server both
   consult it).

These four files ship as visual mocks. No new env vars, no schema,
no Resend wiring yet.

### Phase B — Wire to the real pipeline (3-4 days)

5. `public_audits` schema + migration.
6. `/api/audit/public` route — rate-limit (IP 10/day + email-domain
   3/day), Turnstile verify, URL SSRF validator, dispatch
   `runUrlAudit`, persist findings, pick teaser + top-4, render
   email via the template from Phase A, send via Resend.
7. `/audit/[id]` page — promote from client-timer mock to real
   polling of `public_audits.status`.
8. Cloudflare Turnstile site-key + secret in env.
9. Cost monitor — Cronitor heartbeat for daily Firecrawl/Browserless
   spend on the public route.

### Phase C — Premium routing (optional, 1-2 days, gated on demand)

10. `audit_approval_queue` schema. When the prospect's role matches
    `Head of Growth | Founder | VP Product | CMO | CEO` **and** the
    email domain matches a curated ICP list, set
    `approval_status = 'pending'` instead of sending immediately.
11. Slack webhook fires to founders with "Approve & send" /
    "Edit & send" links. Approval click → fires the same Resend
    template; edit click → opens a small admin UI with the rendered
    HTML editable.
12. Default OFF for v1. Flip on once volume justifies the queue.

### Phase D — Marketing surface around the audit (2 days, partly cofounder)

13. Update landing `/` to make "Run a 60-second audit" the primary
    CTA instead of "Request Access" (modal still available behind
    a secondary link).
14. Public example: link to the Lighthouse posthog.com run (14
    findings) as proof.
15. Comparison strip vs. PostHog / Mutiny / Optimizely.

### Total

Phase A: ~0.5 day (visual mock, this PR). Phase B: ~3-4 days.
Phase C: ~1-2 days, optional. Phase D: ~2 dev-days + design
iteration. Net: ~6 dev-days from mock to live + premium routing.

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

## 8. Open questions **[partially resolved 2026-05-23]**

1. ~~**Marketing surface location.**~~ **Resolved:** dedicated
   `/audit` page. Landing page CTA links to it. Reasoning: the
   audit needs its own focus and tracking, but lives one click off
   the homepage.

2. ~~**Phase B's gating boundary.**~~ **Superseded by §0.** No
   blurred-finding peek. One teaser on `/audit/[id]`, full report
   in the email. Removes the "is the rest worth it?" friction; the
   inbox itself is the proof of value.

3. ~~**Email-claim vs. full signup.**~~ **Resolved:** work-email
   collected up-front at submission. No magic-link signup required
   to get the report. Magic-link signup becomes the next step after
   the email lands ("connect your analytics to keep the loop going").

4. **Should we keep audit records permanently?** Recommendation
   unchanged: 90-day TTL. PII (email + role) makes this more than a
   cost question — it's a GDPR question. 90 days gives us enough
   to reconcile conversion attribution and then delete.

5. **Anti-abuse — same prospect auditing competitors.** Still fine,
   still expected. Now also bounded by the per-email-domain rate
   limit (3/day) so a single account team can't burn the budget.

6. **NEW: Email latency tolerance.** Auto-send the moment the
   pipeline finishes (~45s) vs. queue-for-founder-review (~4 hr
   SLA)? **Decision for v1: auto-send for all.** Add Phase C
   (founder approval queue) once we see real submissions and have
   judgment about which outputs need polish. Premise: a great
   auto-generated report sent in 5 minutes beats a perfect one sent
   in 4 hours, until proven otherwise.

7. **NEW: What counts as a "work email"?** Phase A ships with a
   reject-list (gmail.com, yahoo.com, hotmail.com, outlook.com,
   icloud.com, aol.com, proton.me, protonmail.com, hey.com,
   fastmail.com, msn.com, live.com, me.com, mac.com, gmx.com,
   yandex.com, mail.com, zoho.com, duck.com, pm.me). Universities
   (.edu) accepted — they're a legitimate Cornell/etc. funnel
   for us. Revisit if we see legitimate prospects bouncing off the
   gate.

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

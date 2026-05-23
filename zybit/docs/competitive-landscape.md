# Competitive landscape

**Status:** Strategic reference. **Date:** 2026-05-23.
**Re-read:** quarterly, alongside the curriculum anchoring exercise.

This document is the founder's mental map of who Zybit competes
with at each layer of the six-step loop, where the wedge actually
is, and what the existential threat is. Updated *only* when a
competitor materially shifts position — not when they ship a
feature.

---

## The map by loop layer

| Loop layer | Mature players | Zybit's position |
|---|---|---|
| **Product analytics / data spine** | PostHog, Mixpanel, Amplitude, Heap, Pendo | Does not compete; reads on top |
| **Session replay / qualitative** | FullStory, Hotjar, Microsoft Clarity, LogRocket | Adjacent — they show video; we rank friction |
| **Path / journey analytics** | Amplitude Journeys, Mixpanel Funnels, PostHog Paths, Glassbox | Closest **read-side** competitor — they answer questions the PM asks; Zybit ranks findings *unprompted* |
| **A/B testing / deploy** | Optimizely, VWO, AB Tasty, GrowthBook (OSS), Statsig, Eppo | Where the Test step lives. The real moat when built. Deferred per PRD. |
| **AI-CRO startups** | Mutiny (~$185M raised), Intellimize (Webflow), Coframe, Kameleoon | The most direct fight. Most do personalisation or AI-generated copy variants — they do not diagnose friction the way Zybit does. |
| **CRO-as-a-service agencies** | WiderFunnel, Conversion.com, Speero | Humans + opinions. Zybit's bet is deterministic rules + PM-language replace much of this. |

---

## The 2×2 — where Zybit actually sits

```
                   Tells you what to do (high)
                              ▲
                              │
                              │            ⭐ Zybit
                              │              (upper right —
                              │               where we are)
                              │
                      Mutiny  │
                              │
                              │
                              │
   Heavy install ◄──────────[●]─────────► Zero install
                              │
                              │  PostHog (mid-left,
                              │   strong analytics +
                  Optimizely  │   experiments, no diagnosis)
                              │
                              │
                Hotjar/FullStory
                              │
                              │
                              ▼
                        Shows you data (low)
```

The upper-right quadrant — **"tells you what to do, zero install"** —
is the bet and is mostly empty. Most AI-CRO competitors require a
snippet on the page AND focus on personalisation/copywriting rather
than friction diagnosis.

Everyone else clusters in two zones:
- Lower-right (shows data, zero install): heuristic page audit tools,
  some session-replay tier-2 products
- Upper-left and lower-left (tells / shows, heavy install): the
  mature A/B testing platforms and session-replay incumbents

The 2×2 is a thinking aid, not a marketing graphic. Use it when
deciding whether a feature pulls Zybit toward the wrong quadrant.

---

## What each direct competitor does *better* today

Being honest about this is the only way to position credibly.

**PostHog** — bundled product analytics + experiments + session
replay + feature flags. Open-source-ish. Cheap or free at small
scale. They ship aggressively and the founder publishes their
playbook (`posthog.com/handbook`). If they decide to build
"friction findings" as a module, they could ship a v1 in a quarter.

**Mixpanel / Amplitude** — better raw query and segmentation
power. Mature data export. More integrations with downstream
tools (warehouses, CDPs).

**Optimizely** — vastly more mature experimentation engine,
mature stats, mature integrations, enterprise procurement-ready.
Slow product velocity, but they are the bar in their tier.

**Mutiny** — much better marketing/personalisation story for B2B.
Strong sales motion. Strong design.

**Hotjar / FullStory / Clarity** — much better at qualitative
(heatmaps, session recordings). Zybit is not a qualitative tool
and should not try to become one.

**GrowthBook (OSS)** — clean modern experimentation platform.
Free at small scale. Read their source — it is the cleanest existing
implementation of the loop Zybit competes in. The PostHog of A/B
testing.

**Eppo / Statsig** — modern stats-first experimentation
platforms with strong developer ergonomics. Their blogs are
rigorous reading on the math of experimentation.

---

## What Zybit does *better* today

The honest list of where the product genuinely leads:

1. **Ranked, ready-to-act findings.** Most tools give you data +
   dashboards. You stare at them. Zybit says *here is what is wrong,
   here is the proposed fix, here is what it is worth.*
2. **Deterministic rule engine.** No LLM hallucination in findings.
   Same input, same output. Auditable. PMs trust it because there
   is no black box.
3. **PM-first language end to end.** Every finding title, every
   evidence label, every prescription is written for a PM, not an
   engineer. This is a real differentiator in a category where
   most tools are dashboards-for-data-people.
4. **Flow-aware audit rule.** `flow-inter-step-dropoff` fires on
   inter-step drop-off in the journey graph, not just per-page
   issues. None of the page-level audit competitors do this; the
   journey-analytics competitors show you the data but do not
   surface the finding.
5. **Read-only by design.** Zero install, zero trust barrier on the
   advisory side. This is the wedge.

---

## What Zybit is *missing*

The honest list of what would make a buyer pick a competitor today:

1. **The Test/Deploy loop on SPAs.** Without Zybit-149 (client
   runtime), variants do not survive React/Vue/Next.js hydration.
   The proxy works on SSR HTML only. Buyers running modern
   frontends cannot use the deploy side today.
2. **Cross-site priors (Layer 3 Learn).** Until 50+ customers,
   no "rule of thumb" data; new customers do not benefit from
   what we learned across the network. Catch-22 until we have
   the customers to build it from.
3. **Self-serve sign-up flow.** The auth is invite-only
   magic-link. Closed pilot only. Cannot validate inbound demand
   without it.
4. **A landing site + docs.** The repository has no marketing
   surface. Cannot run paid acquisition; cannot land organic
   traffic.
5. **Real outcome data.** Layer 2 calibration is mechanically
   built but inert until experiments conclude. Until ≥3
   outcomes per rule per site exist, the learning loop is
   invisible.
6. **Enterprise procurement readiness.** No SOC 2, no
   penetration test, no SAML/SSO, no DPA template signed
   with counsel. Fine for design partners; required for
   meaningful mid-market deals.

---

## The existential threat: PostHog

PostHog is the only competitor capable of *unilaterally* erasing
Zybit's wedge in a quarter. They:
- Already have the analytics data spine
- Already have a deploy mechanism (feature flags + experiments)
- Already have an open-source ethos that lets them ship fast
- Publish their playbook publicly so we can see the priorities
- Have a strong product team and active hiring in PM/UX

What stops them today is **focus**. Their roadmap reads as
"better product analytics, better session replay, better feature
flags" — they have a Plat 1 product to defend before they pivot
into Plat 2.

**The window:** Zybit has roughly 12-18 months of unimpeded
runway before a PostHog "friction findings" module is plausible.
The defence is depth: ship the preview system, accumulate outcome
data, and earn the PM trust that turns a feature into a workflow.
A workflow is harder to replicate than a feature.

What would change the threat assessment:
- PostHog hires a head of CRO or product-led growth specifically
  → accelerate
- PostHog announces "AI insights" or similar at their annual
  conference → accelerate
- A PostHog blog post mentions "ranked findings" → already losing

Watch posthog.com/blog and the public PostHog roadmap weekly.

---

## What the AI-CRO competitors are doing (and why it does not
threaten the wedge)

Mutiny, Intellimize (now Webflow), Coframe, Kameleoon and the
long tail of 2024-25 AI-CRO startups all converge on a similar
model: AI-generated page variants, personalised by visitor
segment, applied via JS snippet on the page.

This is **not** what Zybit does. Their value proposition is
"automatically generate and serve different content to different
people." Zybit's is "explain what is broken about your product
and propose what to fix." The buyer overlap is partial: a PM
shopping for personalisation will not buy Zybit; a PM shopping
for friction diagnosis will not buy Mutiny.

The risk is *category confusion* — buyers lumping Zybit in with
the AI-CRO category in RFPs. Mitigated by positioning copy that
explicitly names the difference. ("We are not personalisation.
We are diagnosis + prescription.")

The AI-CRO crowd does not threaten Zybit's wedge. They threaten
each other.

---

## Where Zybit's moat will eventually live

A read-only advisory is not, by itself, a moat. Anyone can copy
the audit rules in a quarter. The moat is in the *compounding*
elements:

1. **Outcome-labelled data.** "Which variants of which proposed
   fixes won on which kinds of sites." This is the unique data
   Zybit will accumulate as PMs ship findings. Only the deploy
   loop unlocks it, hence why #6 in `next-bets.md` matters even
   if not built first.
2. **Per-site calibration depth.** Layer 2 calibration tightens
   per-site thresholds as experiments conclude. By the 10th
   experiment a customer sees a noticeably different ranking than
   they saw on day 1. *That* is a moat — switching costs.
3. **The cross-site prior library (Layer 3).** "98% of B2B SaaS
   sites with this pattern of finding-X resolved it best with
   variant-Y." This is the network-effect data that turns
   Zybit from a tool into the canonical reference. Requires
   50+ customers — explicitly deferred.
4. **PM trust.** Soft, but real. A PM who has used Zybit to ship
   3 winning experiments will not move to a competitor for a
   marginal price difference. This is brand built through
   reliability, not marketing.

The moat strategy is therefore: ship the read-only advisory now
(no moat yet, but no competition either in the upper-right
quadrant); use it to accumulate outcome data via either real
deploys or the manual-outcome-entry surface (`next-bets.md` #4);
let calibration tighten quietly per site; build toward the
cross-site prior library at scale.

The customers will not see the moat being built. That is fine —
they will feel it as "the tool keeps getting better at what
matters to *us*."

---

## Cross-reference

- `next-bets.md` — priority order that operationalises this
  competitive view
- `PRD.md` — the ratified one-milestone scope; this document
  explains *why* that ratification is right competitively
- `DOCTRINE.md` — the build philosophy that produces the wedge
- `curriculum.md` Tier 2 — the deep competitor study list
- `posthog-from-zero.md` — the customer-facing recipe that lets
  PostHog enable Zybit instead of competing with it

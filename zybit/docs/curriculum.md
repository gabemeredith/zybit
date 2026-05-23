# Zybit founders' curriculum

**Audience:** You and your cofounder(s).
**Goal:** Be the most knowledgeable people in the room on the
product space Zybit operates in — conversion intelligence,
experimentation, product analytics, and the modern web stack
that hosts it all. Read with the goal of *teaching it back to
a customer*, not finishing.

This is curated, not exhaustive. Every line earned its spot.
If you read what's here you will be ahead of 95% of people
selling tools in this category.

---

## How to use this

Three tracks below: **everyone reads**, **commercial track**,
**technical track**. If you are two cofounders, split the
tracks. If you are solo, the everyone tier is non-negotiable
and you sample the others.

Mark each item:
- ⭐ Read in full
- 📖 Reference (skim once, return to when you need it)
- 🔁 Re-read every 18 months

Total commitment for the everyone tier: ~4 weekends.
Commitment for a full track: ~3 months at 5 hrs/week.

---

## Tier 1 — Everyone reads (no exceptions)

### Books (5)

1. ⭐ **"Inspired" — Marty Cagan.** The mental model for B2B SaaS
   product. Read it before you write another roadmap. Especially
   the chapters on discovery, product teams, and the four risks
   (value, usability, feasibility, business viability).
2. ⭐ **"The Mom Test" — Rob Fitzpatrick.** 150 pages on customer
   interviews. The single most leveraged book here. Every founder
   conversation about Zybit will be better after this.
3. ⭐ **"Trustworthy Online Controlled Experiments" — Kohavi, Tang,
   Xu.** THE book on A/B testing. Dense; you will not finish it in
   one go. Plan to chapter-by-chapter over six weeks. Chapters to
   prioritise: 1 (overview), 4 (experiment platform), 17 (sample
   ratio mismatch), 22 (sequential testing).
4. ⭐ **"Continuous Discovery Habits" — Teresa Torres.** What you do
   *after* launch, every week, to keep learning. The opportunity
   solution tree alone is worth the book.
5. ⭐ **"Refactoring UI" — Adam Wathan & Steve Schoger.** Design
   for people who think like engineers. Short, visual, surprisingly
   actionable. Read together over a single Saturday.

### Essays / blog posts (always free)

6. ⭐ **"Three Years of Continuous Discovery" — Teresa Torres.**
   The CDH framework in essay form if you want the TL;DR.
7. ⭐ **"The North Star Framework" — Amplitude.** Definitive on
   choosing the metric that anchors a B2B SaaS company.
8. ⭐ **"How to evaluate experimentation tools" — Eppo blog.**
   Useful for the competitive landscape and what good actually
   looks like.
9. ⭐ **"PostHog Handbook" — posthog.com/handbook.** PostHog
   publishes their full playbook: how they build, how they sell,
   how they support, how they price. Most direct competitor;
   read what they say out loud.
10. ⭐ **"Brian Balfour: 4 Fits Framework."** Why most B2B SaaS
    dies between $1M and $10M ARR. The market/model/channel/product
    fit lens.

### Things to *do*, not read

- Set up your own PostHog account, install on a personal site,
  push 3 days of traffic through, run 1 A/B test. End-to-end.
  Do this **first**, before reading anything competitor-related.
- Onboard to Mutiny, Optimizely, VWO, and GrowthBook. Note where
  each loses you. That is your benchmark.
- Read the source of **GrowthBook** (open-source experiment
  platform, TS+React). The cleanest existing implementation of
  the loop Zybit competes in.

---

## Tier 2 — Commercial track (PM, GTM, sales)

For the cofounder owning customers, pricing, marketing, and PM.

### Books

11. ⭐ **"Crossing the Chasm" — Geoffrey Moore.** B2B sequencing,
    early-adopter vs. early-majority targeting. Old but still right.
12. ⭐ **"From Impossible to Inevitable" — Aaron Ross.** SaaS sales
    motion design. Sections on niching down + naming the problem
    are gold for a Day-0 startup.
13. 📖 **"Lean Analytics" — Croll & Yoskovitz.** Reference for
    SaaS metrics by stage.
14. 📖 **"Obviously Awesome" — April Dunford.** Positioning. Especially
    relevant given Zybit's category is contested.
15. ⭐ **"Don't Make Me Think" — Steve Krug.** Usability heuristics.
    Short, essential, dated examples but evergreen principles.

### Essays / Substacks to subscribe to

16. ⭐ **Lenny's Newsletter** (lennysnewsletter.com). Practical PM
    case studies. The 2024–25 series on B2B onboarding is directly
    relevant.
17. ⭐ **Casey Winters' "Product Analytics Playbook"** (caseyaccidental.com).
    Read his entire blog. Best PM-grade analytics writing on the web.
18. ⭐ **First Round Review** (firstround.com/review). Curated long-form
    interviews with operators. Skim the archive for "PMF," "early
    sales," "design partner" titles.
19. ⭐ **Reforge essays** (free posts). Especially Brian Balfour and
    Andrew Chen's growth-loops material.
20. 📖 **Stratechery — Ben Thompson** (free weekly). Strategic framing
    of platform/tooling moves. Not directly tactical but trains your
    instincts on industry direction.

### Competitive landscape — study these companies as products

For each: sign up for the free trial, complete onboarding,
note where they win and where they lose. **Aim for 1/week.**

- **PostHog.** Your most direct competitor at the analytics+experiments
  layer. Their open-source product, pricing, and handbook are all visible.
- **Mutiny.** AI-CRO for B2B. Read every page on their site; do a demo.
  Strongest "AI advisor" UX in the market today.
- **Optimizely.** Enterprise A/B testing. Heavy, but their stats engine
  and feature flagging are the bar.
- **VWO.** SMB A/B testing. Their docs and onboarding are the bar for
  approachability.
- **Eppo.** Modern stats-first experimentation. Founded by Stitch Fix /
  Airbnb experimentation alumni. Their blog is the most rigorous
  free experimentation content available.
- **GrowthBook.** Open-source experiment platform. Read the docs **and**
  the source.
- **Statsig.** Mid-market experimentation + feature flags. Strong
  developer ergonomics.
- **FullStory + Hotjar.** Qualitative session replay. Adjacent but
  the buyer often considers them in the same RFP as Zybit.

### Hands-on assignments

- Run a 14-day discovery sprint per Continuous Discovery Habits:
  3 customer interviews/week, opportunity solution tree updated
  weekly. Do this *during* the curriculum, not after.
- Write Zybit's positioning statement in the Obviously Awesome
  format. Iterate it monthly.
- Design Zybit's pricing in a spreadsheet referencing 5 competitors.
  Defend each tier line by line.

---

## Tier 3 — Technical track (web, React, stats, infra)

For the cofounder owning the codebase, infrastructure, and
experimentation math.

### Books

21. ⭐ **"High Performance Browser Networking" — Ilya Grigorik**
    (free online: hpbn.co). Definitive on HTTP, TCP, TLS, and why
    pages are slow. Read it once carefully.
22. ⭐ **"Designing Data-Intensive Applications" — Martin Kleppmann.**
    The systems book. Not strictly needed for Zybit-as-app, but
    background for thinking about analytics pipelines, eventual
    consistency, and why distributed systems are hard. Skim parts I & II.
23. ⭐ **"Statistical Rethinking" — Richard McElreath.** Bayesian
    inference, with R/Python code. Gives you the model-building
    instincts to *understand* what frequentist A/B tests are
    actually computing.
24. 📖 **"Storytelling with Data" — Cole Nussbaumer Knaflic.**
    For when you build charts in the dashboard. Short.
25. 📖 **"Building a Second Brain" — Tiago Forte.** Personal-knowledge
    management. Useful when you're juggling 4 customers + a roadmap
    + this curriculum.

### Free, must-read

26. ⭐ **react.dev** — the new React docs. Best-in-class. Read the
    Learn section end-to-end; reference the API section. Do *not*
    skip this if you write React.
27. ⭐ **Next.js App Router docs** (nextjs.org/docs). Server
    components, streaming, caching, route handlers. The framework
    Zybit runs on.
28. ⭐ **web.dev/learn** (Google). Free courses on Performance, CSS,
    HTML, Privacy, Forms, PWA. Surprisingly deep.
29. ⭐ **Patterns.dev — Lydia Hallie** (patterns.dev). Free book on
    web architecture and React patterns.
30. ⭐ **MDN** (developer.mozilla.org). Reference, not reading. Bookmark.
31. ⭐ **"Overreacted" — Dan Abramov** (overreacted.io). Older posts
    on React internals + functional programming intuitions. The
    `useEffect`-related posts are essential.
32. ⭐ **"Evan Miller" — evanmiller.org.** Short essays on
    experimentation statistics. The post on *sample size for
    A/B tests* is a permanent reference.
33. ⭐ **GrowthBook's stats documentation** (docs.growthbook.io). The
    most readable explanation of frequentist vs Bayesian A/B testing
    online. Read all of it.
34. ⭐ **Spotify R&D experimentation blog** (engineering.atspotify.com).
    Filter for the experimentation tag. Practical stories from a
    team running tens of thousands of experiments.

### Specific reading on competitive engines

- **GrowthBook source code** (github.com/growthbook/growthbook). TS+React.
  Read the stats engine + the SDK code.
- **PostHog source** (github.com/PostHog/posthog). Python+TS. Read the
  feature-flag and experiment evaluators.
- **Eppo's "Experimentation Design" series** (eppo.cloud/blog). The most
  rigorous free writing on A/B testing math.

### Topics to learn (not single resources)

- **HTTP caching, ETags, CDN behaviour.** web.dev + MDN suffice.
- **CSP headers, frame-ancestors, sandbox attributes.** Critical for
  the preview-system spec. MDN reference.
- **React Server Components vs. Client Components.** react.dev.
- **PostgreSQL fundamentals.** "The Art of PostgreSQL" by Dimitri
  Fontaine if you want depth; otherwise the official docs intro
  is enough.
- **Drizzle ORM patterns.** drizzle.team docs.
- **A/B testing pitfalls.** Trustworthy Online Controlled Experiments
  (Tier 1) + Kohavi's "Pitfalls of Long-Term Online Experiments" paper.

### Hands-on assignments

- Read **the entire Zybit codebase** once before starting any new
  feature. Especially `src/lib/phase2/`, `src/lib/experiments/`,
  `src/lib/phase1/`, the database schema.
- Run a 14-day chaos exercise: connect Zybit to your personal
  PostHog, deliberately set up a bad selector for an experiment,
  watch how the system fails. Then fix it.
- Implement one audit rule end-to-end from scratch in a fork.
  This teaches the rule framework better than reading 13 of them.

---

## Quarterly anchoring exercise

Every 90 days, both cofounders sit for half a day and answer
these in writing:

1. What did the last 3 customer conversations tell us that we
   didn't already know?
2. Which competitor would I be most worried about if I were
   Mutiny / PostHog / Optimizely?
3. What is the single highest-leverage thing we are NOT working
   on right now?
4. What would I change in the PRD given what we now know?
5. What did we ship that no one used? Why?

These are the conversations that actually move a startup.
Curriculum is the input; this exercise is the output.

---

## Tier 4 — Optional / when relevant

Don't read unless the situation pulls you to it.

- **"The Hard Thing About Hard Things" — Ben Horowitz.** When
  you're laying off a person or losing a deal.
- **"Zero to One" — Peter Thiel.** When deciding whether to compete
  or differentiate. Polarising; useful as a thinking foil.
- **"Working Backwards" — Bryar & Carr.** Amazon's PR/FAQ document
  format. Useful when you're forced to write down what a feature
  *will* be before building it. (You already do this via PRD.)
- **"Sprint" — Jake Knapp.** 5-day design sprints. Useful if you
  ever need to bash out a focused week with a customer.
- **"Made to Stick" — Heath brothers.** Communication framework.
  Read before drafting marketing copy.

---

## Subscriptions worth paying for

- Lenny's Newsletter (paid tier ~$15/mo). The Slack + the
  job-and-template archive justifies it.
- Stratechery ($15/mo). Strategic framing, weekly.
- One of: First Round Review (free), Reforge (paid, ~$2k/year
  per seat — only if you're 12 months in and need structured
  growth education).

---

## Anti-list — do not waste time on

- "How I built a $X SaaS in 30 days" Twitter threads. Nothing here
  but survivorship bias.
- Generic LinkedIn "product management thought leadership." Same.
- Newsletters that summarise other newsletters. Cut.
- AI-CRO vendor whitepapers (Mutiny etc.) — they are marketing,
  not research. Read the *product* not their PDFs.

---

## Cross-references inside this repo

- `docs/PRD.md` — what Zybit is committing to
- `DOCTRINE.md` — how we build
- `docs/sprints/preview-system.md` — current next-step proposal
- `docs/sprints/pilot-readiness.md` — what gates a real customer
- `docs/sprints/posthog-from-zero.md` — share with customers, not cofounders
- `docs/sprints/sprint-3-deferred.md` — what we are NOT building, and why

Read the in-repo docs at least once before starting Tier 1.
The reading list above is the *outside* perspective; the docs are
the *inside* one. The judgement gap between them is where you
make decisions as a founder.

# HANDOFF — LLM Context Enrichment ("audit on steroids")

> **Audience:** Asad (CTO) picking up while Gabe is away.
> **Branch:** `feat/llm-context-enrichment`
> **Stacked on:** `feat/lighthouse-llm-qa` (NOT `main`). All the LLM surface this
> work enriches — Layer B, brand profile, fix-preview, the Lighthouse full-LLM-depth
> harness — lives only on `feat/lighthouse-llm-qa`. Merge that first, or review this
> PR with base = `feat/lighthouse-llm-qa`.
> **Worktree:** `/Users/gabemeredith/Code/Zybit/zybit-llm-context`

This doc is the source of truth for what's done, what's next, and how to verify.
**It is updated in the same commit as the code it describes** — if the checklist
says a thing is ✅, the commit it shipped in made it true and `npm run verify`
passed at that commit.

---

## 1. The goal

The audit pipeline's LLM calls are **context-starved**: every prompt sees one page
in isolation with zero business context (see Gabe's audit — `deriveIndustry()` even
computes an industry and then never passes it to a single prompt; copy-critique
hardcodes "B2B SaaS reviewer" for every site on the web).

This branch feeds the LLM the context a senior CRO consultant would walk in with,
across four axes, **without loosening the deterministic core** (rules still decide
*what* fires; the LLM only gets richer context to *phrase / propose / illustrate*):

1. **SiteContext** — industry, business model, conversion goal, audience (foundation).
2. **Brand DNA** — tone, value props, real product/feature names.
3. **Competitor pass** — snapshot competitors, feed the deltas as context.
4. **Behavioral / PostHog** — feed funnel facts into prose + advisor; recommend events to track.

Everything is behind a flag and OFF by default. The public audit adopts it **only
when the eval harness (§4) shows it's noticeably better**, judged by a human marking
findings valid/invalid — not auto-flipped.

---

## 2. Flags

| Flag | Default | Controls |
|------|---------|----------|
| `LLM_SITE_CONTEXT_ENABLED` | off (`!= '1'`) | Master flag for the whole enrichment surface. When off, every prompt falls back to today's exact behavior (verified by tests that assert prompt-equality with the flag off). |

(More sub-flags may be added per axis — see the checklist. Each is documented here when it lands.)

---

## 3. Status checklist

Legend: ✅ done & verified · 🟡 in progress · ⬜ not started

- ✅ **Scaffold** — worktree, this handoff doc, flag in `.env.example`, draft PR.
- ✅ **SiteContext foundation** — `src/lib/phase2/siteContext/` (`types.ts`,
  `deriveSiteContext.ts`, `promptBlock.ts`): `SiteContext` type, deterministic
  industry prior (`deriveIndustry`) enriched by one fast-model LLM call (structured
  output + strict validator + fail-soft), declared-onboarding-values-win merge,
  graceful degradation to heuristic-only then `null`. Shared prompt renderers
  (`reviewerPersona`, `siteContextPromptBlock`). 14 unit tests, tsc clean.
- ✅ **Thread into copy-critique + Layer B** — fully wired end-to-end:
  - **Prompts accept it:** `buildCritiqueSystemPrompt` swaps the hardcoded "B2B
    SaaS reviewer" for an industry-specialised persona; `buildLayerBPrompt`
    appends a context block. Flag-off = byte-identical to baseline (tested).
  - **Layer B (rich, LLM):** `runPhase2InsightsPipeline` computes SiteContext once
    from the homepage snapshot, only when the flag AND Layer B are on, and passes
    it through `applyLayerB` → every `LayerBInput`. Surfaced on `layerB` telemetry.
  - **Copy-critique persona (capture loop):** `runUrlAudit` resolves a
    **heuristic-only** (no-LLM) SiteContext once on the home page and reuses it —
    keeps the per-page loop fast + deterministic, just fixes the wrong persona.
  - Two contexts by design: rich LLM enrichment off the hot path (prose), cheap
    deterministic context in the capture loop (persona). Documented in code.
- ✅ **Eval harness** — the "is it noticeably better?" test environment:
  - `siteContext?: boolean` override (beats the env flag, like `layerB`) threaded
    through `runUrlAudit` + `runPhase2InsightsPipeline` → race-free A/B.
  - `lighthouse/lib/eval/contextComparison.ts`: runs the SAME url audit twice
    (context off vs on, Layer B + derive-facts forced on), pairs findings by
    `ruleId|pathRef`, diffs the prose. `verdictStore.ts`: file-backed valid/invalid
    persistence + scoreboard (validRateDelta = enriched − baseline).
  - Routes: `POST /lighthouse/api/eval/context`, `POST /eval/verdict`,
    `GET /eval/verdicts`. UI: a **Context A/B Eval** panel in the Lighthouse
    dashboard — enter a URL, run, see baseline|enriched prose side by side, mark
    each valid/invalid, watch the scoreboard. **This is how the prod-flip decision
    gets made.** 7 eval unit tests; tsc clean.
  - **To run it:** copy a `.env` (with `OPENAI_API_KEY`) into this worktree, then
    `npx tsx --env-file=lighthouse/.env lighthouse/server/index.ts`, open
    `http://127.0.0.1:3001/lighthouse`.
- ✅ **Thread into variant advisor + audit fix advisor** — `buildPrompt`
  (variant) + `buildAuditFixPrompt` (fix-preview) accept `siteContext` and append
  the context block (flag-off = byte-identical baseline, tested). Wired end-to-end
  in the QA path: `runUrlAudit` passes the rich `insights.layerB.siteContext` into
  `runVariantAdvisor` + `runFixPreviews` → `generateFixPreviews` → the advisor.
  **Vision pass deliberately excluded** — it's an objective "name what's literally
  visible" caption; business context would bias the observation. (documented choice)
- 🟡 **Brand DNA axis** — ✅ fixed the Vercel Blob `private access` bug so design
  screenshots persist again (`screenshots.ts`); SiteContext already carries a
  `brandVoice` descriptor and Layer B already gets `brandProfile` (CTA vocab +
  voice samples). **Remaining (richer extraction):** value props + product/feature
  names + tone, persisted + fed to advisors/inpaint. Design in §7.
- ⬜ **Competitor pass axis.** Not started — design + where-to-start in §7.
- 🟡 **Behavioral/PostHog axis** — ✅ **event-taxonomy recommender** built:
  `src/lib/phase2/eventTaxonomy/recommendEvents.ts` (guarded LLM module; given the
  funnel + goal + currently-tracked events, recommends PostHog events to instrument;
  `alreadyTracked` computed deterministically; 6 tests). Standalone + tested, ready
  to surface (audit result / report / a Lighthouse panel). **Note:** behavioral
  FACTS already reach Layer B prose via each finding's `factsJson`. **Remaining:**
  surface the recommender + an explicit behavioral context block. Design in §7.
- ✅ **E2E + wire public audit behind flag** — the public-audit route is wired by
  construction: it gates on `LLM_SITE_CONTEXT_ENABLED` + `LLM_REFACTOR_ENABLED`
  (fail-soft), so flipping the flag in prod makes the public audit use SiteContext
  with zero code change. Prod gate verified: **`npm run build` exits 0**; full suite
  (1466 src + 66 lighthouse) + lint (0 errors) green. The live e2e is the Lighthouse
  Context A/B harness (§4). (A DB-backed pipeline integration test needs a test DB —
  noted as follow-up; pure pieces + prompt-equality + comparison engine are tested.)
- ✅ **Docs** — doctrine evolved from "deterministic over generative" to
  **"deterministic where it must be; LLM-driven where it's guarded"** in both
  `AGENTS.md` (build conventions) and `DOCTRINE.md` (How we build), codifying the
  6-guardrail test for when an LLM may make a decision. SiteContext added to the
  AGENTS codebase map; Context A/B eval documented in `LIGHTHOUSE.md`.
  (Remaining axes — Brand DNA, Competitor, Behavioral — are scoped in §7 below.)

---

## 4. How to verify

### Fast (CI-style)
```bash
cd /Users/gabemeredith/Code/Zybit/zybit-llm-context/zybit
npm run verify          # lint + tsc + vitest + build — must pass before every commit
```

### Live e2e (the real test environment — shipped)
The honest e2e for an LLM-context feature is "audit a real public site and look at the
output." That's the **Lighthouse Context A/B eval** (shipped). To run it:
```bash
cd /Users/gabemeredith/Code/Zybit/zybit-llm-context/zybit
# copy a .env with OPENAI_API_KEY into this worktree first (worktrees don't share .env)
npx tsx --env-file=lighthouse/.env lighthouse/server/index.ts
# open http://127.0.0.1:3001/lighthouse → "CONTEXT A/B EVAL" panel → enter a URL → run.
# It audits the URL twice (context off vs on), shows prose side by side; mark each
# finding valid/invalid. The scoreboard's Δ is the "noticeably better" signal.
```
With no key, every LLM path fail-softs to today's deterministic behavior (also covered by tests).

---

## 5. Design decisions (AI-engineering principles in play)

- **Deterministic priors first, LLM enriches.** `deriveIndustry` / `deriveBrandProfile`
  run first (no network); the LLM call only refines/extends and must stay consistent
  with those priors. Cheaper, more robust, and the LLM can't contradict ground truth.
- **Structured output + strict validator + fail-soft** on every new LLM call (mirrors
  `captureVisualSignals` / `captureCopyCritique` / Layer B). On any error → `null` →
  today's behavior. The feature can never make the audit worse than baseline; worst
  case it's a no-op.
- **Human gate for the customer-facing flip.** "Noticeably better" is judged by a
  person marking findings valid/invalid in the eval harness, not by an LLM-judges-LLM
  auto-gate. (The existing `layerB/eval` LLM-judge stays as a secondary signal.)
- **Latency budget.** Enrichment is computed once per audit (cached on the snapshot/site),
  not per finding. Competitor + context inference run in parallel with bounded timeouts.
  Trust + accuracy are prioritized over latency per Gabe's instruction.

---

## 6. Where to pick up

Look at the first 🟡/⬜ in the checklist (§3). Each axis is independent once SiteContext
lands. Commits are small and labeled `feat(site-context): ...` etc. The most recent
commit message names what's next. If `npm run verify` is green at HEAD, you're safe to build.

**Status at handoff:** Axis 1 (SiteContext) is complete end-to-end across every LLM
surface, with the Context A/B eval harness to measure it and the doctrine updated. The
prod build passes. The remaining three axes (§7) are independent follow-ups — none block
shipping axis 1 behind the flag.

---

## 7. Remaining axes — design + where to start

All three follow the same contract as axis 1: deterministic prior where one exists →
guarded LLM (structured output, strict validator, fail-soft) → fed as a prompt block →
measured in the Context A/B eval → flag-gated. Reuse `siteContextPromptBlock`'s pattern.

### 7a. Richer Brand DNA (build on the Blob fix, already shipped)
- **Have:** `deriveBrandProfile` (CTA vocab + voice samples, deterministic) + SiteContext's
  `brandVoice`. Both already feed Layer B.
- **Add:** a `BrandDna` that also captures **value props**, **product/feature names** (so
  the LLM stops risking inventing them), and a **tone descriptor**, derived once per audit
  (guarded LLM over the homepage + now-persisting brand screenshot). Thread into the variant
  + fix advisors and the inpaint prompt (where "on-brand" currently only means design tokens).
- **Start:** extend `src/lib/phase2/layerB/brandProfile.ts` (or a new `siteContext/brandDna.ts`),
  mirror `deriveSiteContext`'s shape. Feed via the existing `siteContextPromptBlock` or a sibling.

### 7b. Competitor pass (biggest, highest differentiation)
- **Goal:** snapshot 2–3 competitor URLs, run the SAME capture extraction, feed the **deltas**
  as context ("competitors X and Y show pricing above the fold + a SOC2 badge; this site does
  neither") so findings become *positioned*, not generic.
- **Design:** input = a list of competitor URLs (PM-provided, or discovered — start with
  PM-provided to avoid a discovery rabbit hole). Reuse `runSnapshot` + `captureVisualSignals`
  + `captureCopyCritique` on each. Compute deltas deterministically (presence/absence of proof
  signals, above-fold CTA, pricing visibility) and pass the *delta summary* (not raw competitor
  HTML) into Layer B / advisors. **Latency:** cap at 3 competitors, snapshot in parallel with
  bounded timeouts, cache per (site, competitor) — competitor pages change slowly.
- **Guardrail:** competitor facts are CONTEXT, not auto-fired findings; a human/deterministic
  rule stays in the decision seat. Don't let "competitor does X" alone fire a finding.
- **Start:** `src/lib/phase2/competitors/` — `snapshotCompetitors.ts` (parallel, bounded) +
  `competitorDeltas.ts` (deterministic diff) + a prompt block. New flag, e.g. `LLM_COMPETITOR_CONTEXT_ENABLED`.

### 7c. Behavioral context (event recommender shipped; surface + prose block remain)
- **Have:** `recommendEvents` module (tested). Behavioral FACTS already reach Layer B via `factsJson`.
- **Add:** (1) **surface** the recommender — attach its output to the audit result / report
  email / a Lighthouse panel; the easiest wiring is in `runUrlAudit` after the pipeline
  (`currentEvents` = distinct `phase1_events.type`s for the site; `pageTypes`/`funnelPaths` from
  snapshots). (2) An explicit **behavioral context block** in Layer B that names the funnel
  drop-off the finding sits on (beyond the per-finding facts) — only when behavioral data exists.
- **Start:** wire `recommendEvents` into `runUrlAudit`, add its result to `GenerateResult`, and
  render it in the Lighthouse inspector (and optionally the Context A/B panel).

### Measuring all of them
Extend the Context A/B eval: the comparison engine already diffs prose between two runs. For a
new axis, run baseline (axis off) vs enriched (axis on) the same way — the verdict store +
scoreboard generalise. Add a per-axis flag to the eval route if you want to A/B one axis at a time.

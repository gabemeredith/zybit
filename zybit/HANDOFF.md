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
- 🟡 **Thread into copy-critique + Layer B** — ✅ prompts now *accept* SiteContext:
  `buildCritiqueSystemPrompt` swaps the hardcoded "B2B SaaS reviewer" for an
  industry-specialised persona; `buildLayerBPrompt` appends a context block.
  Flag-off path is byte-identical to baseline (asserted by tests). **Remaining:**
  wire the pipeline to compute SiteContext once per audit and pass it down (see
  "Wiring" task below — kept separate so this commit can't change prod behavior).
- ⬜ **Eval harness** — Lighthouse surface: flag-on vs flag-off on real public sites, mark findings valid/invalid, scoreboard.
- ⬜ **Thread into variant advisor + audit fix advisor + vision pass.**
- ⬜ **Brand DNA axis** + fix Vercel Blob `private access` screenshot bug.
- ⬜ **Competitor pass axis.**
- ⬜ **Behavioral/PostHog axis** + event-taxonomy recommender.
- ⬜ **E2E + wire public audit behind flag.**
- ⬜ **Docs** — evolve doctrine to embrace LLM decision-making backed by AI-eng principles.

---

## 4. How to verify

### Fast (CI-style)
```bash
cd /Users/gabemeredith/Code/Zybit/zybit-llm-context/zybit
npm run verify          # lint + tsc + vitest + build — must pass before every commit
```

### Live e2e (the real test environment)
The honest e2e for an LLM-context feature is "audit a real public site and look at
the output." That's the **Lighthouse eval harness** (§4 task). Once it lands:
```bash
# from the worktree's zybit/lighthouse (see lighthouse/START.md)
# run a public URL audit flag-OFF then flag-ON, compare side by side,
# mark each finding valid/invalid. The scoreboard is the "noticeably better" signal.
```
Set `OPENAI_API_KEY` in the worktree `.env` for live runs. With no key, every LLM
path fail-softs to today's deterministic behavior (also covered by tests).

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

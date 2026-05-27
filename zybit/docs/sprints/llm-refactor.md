# LLM Refactor — decision deterministic, expression generative

**Status:** Drafted. **Date:** 2026-05-27. **Branch:** `feat/llm-refactor`.
**Origin:** Critique pasted into the session opener — "the wedge is right, the
implementation has over-rotated." Argues that today's rules conflate two
concerns: *deciding whether to fire* (must be deterministic, this is the
wedge) and *expressing the finding for a PM* (does not need to be
deterministic, has bloated `rules/` by ~3,000 LOC of templating).

The refactor preserves the decision contract and replaces the expression
contract with one LLM call per top finding. It also adds a constrained
LLM-detection layer to extend coverage beyond the 23 hand-written rules
without breaking calibration, annotations, or Learn.

---

## Doctrinal clarification

`AGENTS.md` currently says "no LLM calls inside rule logic." That rule has
been protecting two things at once:

1. **The decision must be deterministic and defensible.** Same input → same
   output, gated by a numeric threshold a PM can interrogate.
2. **The codepath must not call an LLM.**

(1) is the wedge. (2) was a coarse proxy for (1). The Layer F pattern
(`captureCopyCritique`, `captureVisualSignals`) already proves you can run an
LLM *upstream* of the decision — strict-output, validated, cached, fail-soft
— without weakening (1). This refactor proves the same is true *downstream*
of the decision.

The post-refactor rule is: **no LLM in the decision; LLM is allowed in the
expression and in candidate detection so long as the deterministic gate runs
between the LLM and the persisted finding.**

`AGENTS.md` and `DOCTRINE.md` get updated in PR 2.

---

## The three layers

### Layer A — decision (refactored, stays deterministic)

Each rule body becomes a pure function returning `{ ruleId, severity,
factsJson }` and nothing else. No `summary`, no `recommendation`, no
`evidence` strings, no `humanizePath`, no `describeVisualTreatment`. Helpers
that only feed prose move out of `rules/`; helpers that feed the firing
condition stay.

Target shape: ~50–100 LOC per rule for the body, plus whatever shared
helpers a rule's signal extraction genuinely needs.

### Layer B — expression (new, LLM, top-4 only)

A single orchestration call per finding generates `summary`, `recommendation`,
`evidence[]`, writes them once into the existing finding columns, never
regenerates.

| Concern | Decision |
|---|---|
| Model | Gemini 2.0 Flash via REST (consistent with `aiAdvisor.ts`, `captureCopyCritique.ts`) |
| Inputs | `factsJson` + `pageType` + design tokens from `extractDesignTokens` |
| Scope | Top 4 findings per audit only (matches what the report email already trims to) |
| Failure mode | **TBD before PR 1 ships** — see Open Question below |
| Persistence | Persist once at generation into `findings.summary`/`recommendation`/`evidence`. Never regenerate. Re-audit creates a new finding with fresh prose; old findings stay frozen |
| Output schema | Strict JSON validated like `aiAdvisor.ts` — reject on validation failure, fall back per the failure-mode decision |
| Discriminator | New column `findings.prose_source` (`'template' | 'llm-v1' | 'stub'`) so history and LEARNED timelines stay interpretable across the pilot |

**Open question carried into PR 1:** when Layer B fails for a finding, do we
(a) fall back to a deterministic stub of the form `"<RuleName> fired on
<selector>. fact1; fact2."`, (b) fall back to the rule's old templating
function (means PR 2 cannot delete the templates, they become the fallback),
or (c) drop the finding entirely. Stub is the consistent fail-soft choice
but is worse than today's templates. To be decided after the first pilot
audits return real data.

### Layer C — detection (new, additive, closed registry)

Adds a complementary path: an LLM proposes candidate friction observations
against a **closed taxonomy**; each candidate must pass a deterministic
verifier before becoming a finding. Identity is `c:{categoryId}` — every
downstream consumer (calibration, annotations, "Past tests", "Tuned" badge,
LEARNED timeline, variant advisor) treats Layer C findings exactly like rule
findings.

#### Verifier (stronger)

For every candidate the LLM returns:

- `categoryId` (must be in the registry, schema validation)
- `selector` (must resolve in the parsed DOM)
- `factsJson` (every numeric and text field is independently re-derived from
  the DOM by a category-specific verifier function; a mismatch rejects the
  candidate)

A candidate that passes the verifier becomes a finding whose `factsJson` is
the *verifier's* re-derived version, not the LLM's. The LLM cannot lie
about numbers or text by construction.

#### v1 registry (3 categories)

| `categoryId` | What it looks for | Verifier checks |
|---|---|---|
| `weak-value-prop` | Hero copy is present but fails to name a concrete user outcome | Hero block resolves; hero text matches none of a small lexical pattern set ("save", "ship", "build", "automate", numeric outcomes, time-to-value phrases) |
| `brand-voice-drift` | A CTA verb's register breaks from the site's CTA vocabulary | CTA resolves; verb's classified register differs from the dominant register in `ctaVocabulary` from design tokens |
| `fold-density-too-high` | Too many competing CTAs in viewport | Above-fold CTAs counted from snapshot; exceeds per-`pageType` threshold |

Each category = a prompt fragment, a ~30–50 LOC verifier function, a
registry entry. New categories are an additive code change, not a rule
rewrite.

#### Layer C scope guarantees

- One LLM call per audit covers all categories (combined prompt).
- Layer C runs *after* deterministic rules so Layer A findings always win
  when they overlap on the same selector.
- Layer C findings respect `pageTypeModulation` the same way rules do.
- Layer C output is persisted with `prose_source = 'llm-v1'` and gets a
  Layer B prose pass like any other finding (if it ranks in the top 4).

---

## What's deliberately *not* in v1

- **`template-noise` category** (Stripe "59 H1s on /guides" pattern). Real
  pain point, but its verifier needs a `content-index` pageType classifier
  we don't have yet. Either added in a follow-up PR or solved separately by
  extending `pageTypeModulation` with a `content-index` pageType. v1 ships
  without it; the existing structural rule still surfaces the finding.
- **Screenshot input for Layer B.** Audit-mode fix-preview advisor proved
  screenshots dramatically improve selector accuracy. We're betting prose
  generation doesn't need the same channel because `factsJson` is
  structurally rich. Reopen after pilot data if prose feels disconnected
  from the rendered page.
- **`copyCritique` input for Layer B.** Skipped to keep the prompt cheap.
  Reopen if brand-voice register comes out too generic.
- **Open-ended Layer C detection.** The critic argued for "phrase a question,
  not write a rule." We accept the smaller win of closed-registry detection
  because open-ended detection breaks calibration identity by construction.
- **Quality measurement plan.** Pilot evaluation is currently "look at it."
  Should be a structured LLM-as-judge or human-review pass before PR 2 flips
  the default; deferred to PR 2 prep.

---

## Sequencing

### PR 1 — pilot (this branch, first cut)

1. Add the Layer A/B contract — `LayerAResult` type (`{ ruleId, severity,
   factsJson }`), `runLayerB(facts, pageType, designTokens) →
   {summary, recommendation, evidence[]}` orchestrator, strict-JSON validator,
   fail-soft path per Open Question above.
2. Convert **three rules** to Layer A/B alongside the existing templating —
   both paths live in the file, both are reachable. The env var
   `LLM_REFACTOR_ENABLED=1` controls which path persists prose for a given
   audit:
   - `heroHierarchyInversion.ts` (580 LOC, design)
   - `aboveFoldCoverage.ts` (501 LOC, design)
   - `returnVisitThrash.ts` (323 LOC, pain)
3. Add `findings.prose_source` column + migration. Backfill existing rows
   to `'template'`.
4. Wire Layer B into the audit pipeline downstream of rule firing; cap at
   top-4 by priority score.
5. Wire `LLM_REFACTOR_ENABLED` into the public-audit pipeline + the
   product audit pipeline. Default off.
6. Unit tests on the orchestrator (prompt construction, schema validation,
   fail-soft path).
7. Run real public audits with the flag both ways; capture both prose
   versions on the same finding via structured logs to Axiom for offline
   diffing.

**PR 1 grows the rule files** before PR 2 shrinks them. This is the
intentional cost of a reversible pilot — if Layer B disappoints we just
don't flip the flag default.

### PR 2 — wide rollout

1. Convert the remaining 20 rules to the Layer A/B contract.
2. Delete the old templating in the 3 pilot rules (and the orphaned helpers
   that only fed prose).
3. Flip `LLM_REFACTOR_ENABLED` default-on.
4. Update `AGENTS.md` and `DOCTRINE.md` with the clarified doctrine.
5. Update `docs/ARCHITECTURE.md` "Identify" row in the build-state table.

### PR 3 — Layer C

1. `phase2_candidate_registry.ts` — closed registry + per-category verifier
   modules + combined prompt builder.
2. Layer C orchestrator runs after deterministic rules, respects
   `pageTypeModulation`, dedupes against existing findings by selector.
3. `c:{categoryId}` findings persisted with `prose_source = 'llm-v1'`, get a
   Layer B prose pass if top-4.
4. Calibration, annotations, variant advisor wiring verified end-to-end on
   a real audit.
5. Update `AGENTS.md` rule-count framing (rules stays at 23; categories is a
   parallel registry).

---

## Risks (carry into review)

1. **PR 2 stalls and we sit on bloated intermediate state.** Mitigation:
   PR 1 lands with a kill-by date in the PR description; if pilot quality
   is mixed we delete the new path rather than the old.
2. **Layer B prose without a screenshot reads disconnected.** Reopen the
   input set after pilot data. Adding the screenshot is a single-prompt
   change, not an architectural one.
3. **Failure stubs are worse than today's templates.** See Open Question.
   The honest hedge is keeping templates as the fallback through PR 2.
4. **Public-audit latency.** Top-4 × ~1s = up to 4s added to time-to-report
   serially, ~1–2s p95 if parallelised. Confirm headroom before flipping
   default-on.
5. **No quality-measurement plan locks "Layer B is better" as a vibes call.**
   Add one before PR 2 prep.
6. **Doctrine drift.** A future contributor reads "LLM call per finding" and
   thinks the wedge has been weakened. PR 2's AGENTS.md update has to make
   the decision/expression distinction unmissable.

---

## Conditions to advance

- **PR 1 → PR 2:** at least 10 real public audits run with the flag in both
  positions; structured-log diff reviewed; Layer B prose judged at least as
  good as templated prose on ≥ 7 of 10. Failure-mode decision locked.
- **PR 2 → PR 3:** flag default-on stable for one week of real public
  audits, no rollback triggered, doctrine docs updated.
- **PR 3 → production-on:** at least one Layer C category resolves a finding
  on a real public audit and the verifier rejects ≥ 1 hallucinated candidate
  in the same window (proves the verifier is doing real work).

# Handover — `region-replace` modification type + fail-loud anchor guard

**Status:** Not started. Spec only. Pick this up in a fresh session.
**Branch to build on:** branch off `main` (or off whatever the code-cleanup
PR merges to). Do **not** build this on `claude/zybit-core-refocus-32VPy` —
that branch is the cleanup PR and should stay scoped to deletions + this doc.
**Owner of decision:** founder (sar367). Co-founder owns the LLM/Layer-B and
free-experiment PRs (#107, #108) — this work is orthogonal to all three open
PRs and touches none of their files.

---

## 1. Why this exists (the product bet)

Zybit's `VariantModification` vocabulary today is **cosmetic and
single-element**: swap text, inject CSS, hide/show, set one attribute,
reorder children, or splice a *small* new fragment next to an anchor
(`element-insert`). That is enough to test "change the CTA copy" but **not**
enough to test "replace this entire hero section with a different layout" —
the kind of macro-structural change that moves SEO + conversion on a real
page.

`region-replace` adds exactly that one capability: **replace the full DOM
subtree at a selector with PM-authored (sanitized) markup.** It is the
smallest change that unlocks "test a meaningfully different section," which
is the core loop we're refocusing the product around (small HTML/CSS changes,
big SEO/conversion impact, run continuously).

**Scope discipline — what this is NOT:**
- NOT multi-arm experiments. The bucketing + stats engine stays 2-arm
  (`control` | `variant`). See §6.
- NOT a client-side runtime / SPA support. Same server-rendered-HTML proxy
  constraint as every other mod type. The existing launch-time SPA guard
  (`isSpaHtml`) already covers this.
- NOT a new sanitizer. Reuse `sanitizeInsertHtml` as-is.

If you find yourself touching `bucketing.ts`, `stats.ts`, or adding an
N-arm anything, stop — you've left the scope of this ticket.

---

## 2. The two deliverables

### Deliverable A — `region-replace` modification type

A new entry in the `VariantModification` discriminated union that replaces an
element's content or the element itself with sanitized HTML.

```ts
// src/lib/experiments/types.ts — add to the union (line ~8-15)
| { type: 'region-replace'; selector: string; html: string; mode: 'inner' | 'outer' }
```

- `mode: 'inner'` → replace the element's **children** (`el.set_content` /
  `innerHTML`), keep the element + its attributes.
- `mode: 'outer'` → replace the **whole element** including its own tag
  (`el.replaceWith`), like `outerHTML`.

Why both modes: "inner" is the safe default (the anchor stays, so downstream
CSS/selectors that target the wrapper still resolve). "outer" is needed when
the PM wants to change the wrapper tag itself (e.g. swap a `<div>` hero for a
`<section>`).

### Deliverable B — fail-loud anchor guard

Today, if a mod's selector doesn't resolve, `htmlModifier.ts` **silently
skips it** (`if (!anchor) break;`, line 57) and the variant ships
*control-identical*. For a small text swap that's a minor annoyance. For a
**whole-region replacement** it's a silent disaster: the experiment runs for
two weeks, burns traffic, and measures nothing because the variant never
changed.

The fix is **not** to make the proxy throw — the proxy must always fail-open
so a customer's live site never breaks behind it (this is a hard product
invariant; see `handler.ts` fail-open comments). Instead, fail loud **before
the experiment can launch**:

- At **launch time**, resolve every mod's selector against the latest page
  snapshot and **block the launch** (PM-readable error) if any
  `region-replace` (or, ideally, any) selector misses.
- At **proxy time**, keep failing open, but **emit a structured warning**
  (the `check-selectors` cron + selector-miss email path already exists —
  wire region-replace misses into it).

This converts a silent two-week dud into a launch-time "this selector doesn't
match anything on the page" message.

---

## 3. Exact integration points (every file you must touch)

All paths under `zybit/src/`. Verified against the tree on
`claude/zybit-core-refocus-32VPy` @ `2fec8e6`.

| # | File | Change |
|---|------|--------|
| 1 | `lib/experiments/types.ts` | Add `region-replace` to the `VariantModification` union (line ~8-15). Add a `case 'region-replace'` to `validateModifications` (line ~44): require non-empty `selector`, non-empty `html`, and `mode ∈ {'inner','outer'}`. Mirror the `element-insert` empty-html rejection (reject html that sanitizes to empty — see §4). |
| 2 | `lib/experiments/htmlModifier.ts` | Add a `case 'region-replace'` to the switch (line ~33). Resolve anchor → `sanitizeInsertHtml(mod.html)` → if `mode==='inner'` use `anchor.set_content(safeHtml)`, if `'outer'` use `anchor.replaceWith(safeHtml)` (verify `node-html-parser` re-parses the string arg as HTML — it does; that's the documented behavior `sanitizeInsertHtml`'s comment relies on). Keep the existing try/catch fail-open. **Do not** add the fail-loud here — proxy stays fail-open (see §2 Deliverable B). |
| 3 | `lib/experiments/validateBrief.ts` | Add `"replace"` to `BriefChangeType` (line 18). Add a `changeType === "replace"` branch to `validateBriefShape` mirroring the `"insert"` branch (require selector + non-empty html + non-empty-after-sanitize). Add a `mode` param or default `'inner'`. |
| 4 | `lib/experiments/describeModification.ts` | Add a PM-readable sentence for `region-replace` (e.g. *"Replace the contents of `<selector>` with a new block"* for inner, *"Replace `<selector>` entirely"* for outer). Check `describeModification.test.ts` for the exact shape expected. |
| 5 | `components/app/ExperimentBuilderForm.tsx` | Add a "Replace a section" change type to the authoring UI. It needs: the selector input (reuse the existing selector field + validation badge), a **large HTML textarea** (the `element-insert` UI already has one — reuse it), and an inner/outer toggle (radio: "Replace contents" / "Replace whole element"). Default to inner. |
| 6 | `app/app/findings/[id]/experiment/actions.ts` | The save + launch server actions. Map the new `"replace"` brief change type → a `region-replace` `VariantModification` when building the brief. **This is where Deliverable B (launch-time fail-loud) goes** — see §5. |
| 7 | `app/app/experiments/[id]/page.tsx` | Experiment detail page renders the modification list. Make sure `region-replace` renders via `describeModification` (it should automatically if #4 is done). |
| 8 | `lib/experiments/aiAdvisor.ts` | **Decision required (§7):** whether the AI Variant Advisor is allowed to *propose* `region-replace`. Default recommendation: **exclude it from the AI surface initially** (same as `element-reorder` is excluded today) — region replacement is high-blast-radius and should be PM-authored first. Add it to the advisor allowlist only after the manual path is proven. |

**Sanitizer:** No change. `region-replace` html goes through the existing
`sanitizeInsertHtml` (`lib/experiments/sanitizeInsertHtml.ts`) — same tag +
attribute allowlist, same fail-closed posture, same `<script>`/`<iframe>`/
`<form>`/inline-`style` stripping. Note the sanitizer **strips inline
`style`** attributes, so PMs styling a replaced region must pair it with a
companion `css-inject` mod (the audit fix-preview advisor already documents
this pattern — see AGENTS.md fix-preview notes).

---

## 4. Size cap

`element-insert` uses a 4 KB pre-sanitize cap. A whole-region replacement is
legitimately larger — propose **32 KB pre-sanitize**. Enforce it in
`validateModifications` (types.ts) AND in `validateBriefShape`
(validateBrief.ts) so both the API and the form path reject oversized
payloads. Reject *before* sanitizing (cap is on raw input). Reject
empty-after-sanitize *after* sanitizing (mirror element-insert).

---

## 5. Fail-loud guard — where and how

The existing machinery to reuse:
- **Selector validation badge** in the builder (500 ms debounced) — already
  validates a selector resolves against the snapshot client-side.
- **`check-selectors` cron** — daily re-validates running experiments'
  selectors against the latest snapshot and emails the PM on a miss.

What to add:
1. In `actions.ts` launch path (#6 above), before flipping the experiment to
   `running`, fetch the latest snapshot HTML for the target path and run each
   mod's selector through `parse(html).querySelector(selector)`. If any
   `region-replace` selector returns null, **return a PM-readable validation
   error and refuse to launch** (do not 500). Reuse the snapshot-fetch the
   launch-time SPA guard (`isSpaHtml`) already does — the HTML is in hand.
2. Fail-open on the *fetch* itself (network error fetching the snapshot →
   allow launch, same as the SPA guard's fail-open). The guard is a
   best-effort safety net, not a hard gate that a flaky network can wedge.
3. Leave proxy-time behavior unchanged (fail-open + structured warn). The
   `check-selectors` cron already catches a selector that breaks *after*
   launch (page redesign mid-experiment).

This gives the right asymmetry: **loud at authoring/launch, silent-safe in
production.**

---

## 6. What explicitly does NOT change (and why)

| Component | File | Why no change |
|-----------|------|---------------|
| Bucketing | `lib/experiments/bucketing.ts` | `type Bucket = 'control' \| 'variant'` — 2-arm is correct for a macro-structural A/B. region-replace is just a bigger variant payload, not a new arm. |
| Stats | `lib/experiments/stats.ts` | `chiSquaredTwoProportions` + OBF alpha-spending — 2-proportion, traffic-agnostic. A bigger DOM change doesn't change the math. |
| Proxy apply gate | `lib/experiments/proxy/handler.ts` (~line 160) | `shouldModify = bucket === 'variant' && …` — binary apply is correct. |
| Sanitizer | `lib/experiments/sanitizeInsertHtml.ts` | Already handles arbitrary fragment markup safely. region-replace is the same trust surface as element-insert (PM/AI-authored markup spliced into a customer page). |

---

## 7. Open decisions to confirm before/while building

1. **AI advisor surface (§3 #8):** ship region-replace PM-authored-only
   first, or let the advisor propose it day one? **Recommendation:
   manual-only first.** Revisit once there's one real region-replace
   experiment with an outcome.
2. **`mode` default:** confirm `'inner'` is the default in the UI.
   (Recommendation: yes — lower blast radius.)
3. **Fail-loud breadth:** launch-time guard for *all* mod types, or only
   `region-replace`? **Recommendation: all** — a silent control-identical
   variant is bad for every type; region-replace just makes the cost
   obvious. But if that risks regressing existing experiments' launch
   behavior, scope it to `region-replace` first and widen in a follow-up.

---

## 8. Test plan (mirror the element-insert test coverage)

- `lib/experiments/types.test.ts` — `validateModifications` accepts a valid
  region-replace; rejects missing html, bad `mode`, oversized payload,
  empty-after-sanitize.
- `lib/experiments/__tests__/htmlModifier.test.ts` — inner mode replaces
  children + keeps wrapper; outer mode replaces the whole element;
  unresolved selector fails open (no throw, original markup returned);
  sanitizer strips a `<script>` inside the replacement.
- `lib/experiments/validateBrief.test.ts` — the `"replace"` brief branch.
- `lib/experiments/describeModification.test.ts` — PM-readable string for
  both modes.
- New test for the launch-time fail-loud guard in the actions layer (stub
  the snapshot fetch; assert launch is refused on a selector miss and
  allowed on a fetch error).

`npm run verify` (lint + tsc + tests + build) must pass before commit.

---

## 9. Doc obligations on completion (per AGENTS.md)

When this ships, update **in the same commit**:
- `zybit/AGENTS.md` "Current build state" → **Test** row: note
  `region-replace` as the 8th `VariantModification` type + the launch-time
  fail-loud guard.
- `zybit/AGENTS.md` codebase-map / rule-count references if any count moves.
- `zybit/docs/ARCHITECTURE.md` — modification-type reference table.
- `zybit/DOCTRINE.md` — only if the modification vocabulary is described
  there (check first).
- `zybit/DEVLOG.md` — session entry.

---

## 10. Quick-start for the next session

```
1. Read this file end to end.
2. Read the 4 core files: types.ts, htmlModifier.ts, sanitizeInsertHtml.ts,
   validateBrief.ts (all under src/lib/experiments/).
3. Branch off main: git checkout main && git pull && git checkout -b <feat-branch>
4. Build Deliverable A (mod type) first — it's self-contained and testable
   in isolation. Get its tests green.
5. Build Deliverable B (fail-loud guard) second — it depends on understanding
   the launch action + SPA-guard snapshot fetch.
6. Wire the builder UI (#5) last — it's the thickest change but the lowest
   risk once the lib layer is solid.
7. Update docs (§9). Run npm run verify. Commit + push.
```

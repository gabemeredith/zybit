# Phase 2 Audit Rules — Architecture & Scalability Analysis

## 1. Modularity

### AuditRule interface

Every rule implements the `AuditRule` interface (defined in `src/lib/phase2/rules/types.ts`):

```ts
export interface AuditRule {
  id: string;
  category: AuditFindingCategory;
  name: string;
  evaluate(ctx: AuditRuleContext): AuditFinding[];
  proposeAnnotations?(finding: AuditFinding, ctx: AuditRuleContext): PreviewAnnotation[];
}
```

Key design properties:
- `evaluate` is a **pure function**: same inputs → same outputs, no I/O.
- Rules **never throw** on missing data; they return `[]`.
- Each rule owns its own minimum-sample threshold so callers run them blindly.
- `proposeAnnotations` is also pure. Each finding-bearing rule anchors its preview annotations to the literal element its prescription names — `return-visit-thrash` anchors a quick-answer placeholder above the hero; `help-seeking-spike` anchors a FAQ above the primary CTA; `above-fold-coverage` shows the duplicate-CTA placement; `bounce-on-key-page` captions the first heading; etc. The contract is "anchor to what the prescription actually says", not "outline the primary CTA".

### Shared annotation helpers (`src/lib/phase2/rules/annotationHelpers.ts`)

Pure helpers used by every `proposeAnnotations` implementation:

- `missingPlaceholder(kind, selector)` — synthesizes a placeholder element node when the prescription proposes inserting new content (e.g., the quick-answer block, the inline FAQ).
- `annotationCaption(rule, prescription)` — formats the deterministic caption shown in the PM preview, voiced from the prescription text.
- `outlineMod({ selector, mode })` — outline-only annotation mod for "look here" anchors without DOM mutation.
- `snapshotHeadingSelector(snapshot, level, index)` — resolves a stable selector for the nth heading at a given level.
- `nthOfTypeIndex(snapshot, ref)` — computes the `:nth-of-type` index needed to disambiguate repeated tags.

### Rule registration

Rules are imported and collected in `src/lib/phase2/rules/index.ts` — **19 rules total**, in four shapes (5 design + 7 pain + 1 flow + 6 structural):

```ts
export const ALL_AUDIT_RULES: readonly AuditRule[] = [
  // Design (5)
  heroHierarchyInversion,
  aboveFoldCoverage,
  rageClickTarget,
  mobileEngagementAsymmetry,
  navDispersion,
  // Pain (7)
  errorExposure,
  formAbandonment,
  bounceOnKeyPage,
  helpSeekingSpike,
  hesitationPattern,
  returnVisitThrash,
  cohortPainAsymmetry,
  // Flow (1)
  flowInterStepDropoff,
  // Structural — Layer E (6, snapshot-only)
  headingHierarchyJump,
  formLabelMissing,
  imageAltTextMissing,
  linkTextGeneric,
  missingMetaDescription,
  missingCanonicalUrl,
];
```

`runAuditRules` iterates this array, catches per-rule exceptions, and records diagnostics. No global mutable state is touched.

### Layer E — structural rules (snapshot-only)

The six structural rules (`headingHierarchyJump`, `formLabelMissing`, `imageAltTextMissing`, `linkTextGeneric`, `missingMetaDescription`, `missingCanonicalUrl`) are **snapshot-only**: they consume `ctx.pageSnapshotsByPath` and ignore `ctx.events`. They fire on any site that has page snapshots, even with zero behavioral data — which makes them the activation surface for the public URL-audit lead magnet and for new sites still in connector setup. Behavioral (event-based) rules are frozen at 12; new rules must follow the structural-rules pattern (deterministic, snapshot-grounded, no LLM calls, no invented numbers).

### Adding a new rule (steps)

1. Create `src/lib/phase2/rules/myNewRule.ts` — export an `AuditRule` object.
2. Add `import { myNewRule } from './myNewRule'` in `index.ts`.
3. Push `myNewRule` into `ALL_AUDIT_RULES`.
4. Create `src/lib/phase2/rules/__tests__/myNewRule.test.ts`.

Files touched: 2 (`myNewRule.ts` + `index.ts`). No global registry, no decorator magic.

### Dependency graph

```
rules/index.ts
  └── each rule file (aboveFoldCoverage.ts, etc.)
        ├── rules/helpers.ts      (pure utilities)
        ├── rules/impactEstimate.ts (pure math)
        └── rules/types.ts        (type definitions only)

rules/types.ts
  └── @/lib/phase2/types.ts       (CanonicalEvent, Phase2SiteConfig)
  └── @/lib/phase2/snapshots/types.ts (PageSnapshot, CtaCandidate)
```

No circular dependencies. `helpers.ts` and `impactEstimate.ts` are leaves — they import only from `@/lib/phase2/types`.

### Configuration isolation

All site-specific configuration flows through `AuditRuleContext.config` (type: `Phase2SiteConfig`). Rules never read from:
- Environment variables
- Module-level globals
- Database connections

This makes rules trivially testable: pass a mock `AuditRuleContext`, assert on the output.

---

## 2. Scalability

### Time complexity per rule

| Rule | Dominant pass | Complexity |
|---|---|---|
| `above-fold-coverage` | Bucket `page_view` events by path | O(n) |
| `bounce-on-key-page` | `groupSessions` + per-session scan | O(n) |
| `cohort-pain-asymmetry` | `groupSessions` + cohort assignment | O(n × d) where d = #dimensions |
| `error-exposure` | Single pass for error grouping | O(n) |
| `form-abandonment` | Bucket events by path | O(n) |
| `help-seeking-spike` | Single pass over CTA clicks | O(n) |
| `hero-hierarchy-inversion` | Bucket `cta_click` events by path | O(n) |
| `hesitation-pattern` | `groupSessions` + event-by-event scan | O(n) |
| `mobile-engagement-asymmetry` | `groupBySession` internal + per-step scan | O(n × s) where s = #steps |
| `nav-dispersion` | Single pass over nav CTA clicks | O(n) |
| `rage-click-target` | Single pass, group by target key | O(n) |
| `return-visit-thrash` | `groupSessions` + path-count iteration | O(n) |
| `flow-inter-step-dropoff` | Single pass over flow-graph edges | O(n) |
| Layer E structural (×6) | Per-snapshot DOM walk; ignores `ctx.events` | O(snapshot size) |

All behavioral rules are **O(n)** in event count. Structural rules are bounded by snapshot size, not event count. Total pipeline cost remains linear: `O(n × rules)` = `O(19n)` = `O(n)`.

### Memory

Events are held in memory for the duration of `runAuditRules`. A `CanonicalEvent` is approximately 400–600 bytes when serialized (id + sessionId + path + properties + metrics).

| Event volume | Approximate heap usage |
|---|---|
| 10k events | ~5 MB |
| 100k events | ~50 MB |
| 500k events | ~250 MB |
| 1M events | ~500 MB |

**Threshold**: At ~100k events the in-memory approach starts competing with Node.js's default 1.5GB heap limit when combined with Next.js runtime overhead. At 500k+, OOM risk is real in serverless functions with 1GB memory limits.

The `pageSnapshotsByPath` Map is O(1) per lookup — not a scaling concern.

### Identified redundancies

**`groupSessions` called N times**: Six rules independently call `groupSessions(ctx.events)`:
- `bounceOnKeyPage`
- `cohortPainAsymmetry`
- `hesitationPattern`
- `returnVisitThrash`

Each call is O(n). With 19 rules and 4 calling `groupSessions`, the session grouping work is done 4× instead of 1×. At 100k events this is ~4× unnecessary work. (Layer E structural rules do not touch events, so the redundancy ratio is unchanged by their addition.)

**`windowDaysFromTimeWindow` called per-rule**: Every rule that needs the window duration calls `windowDaysFromTimeWindow(ctx.window)` independently. This is O(1) but structurally redundant — it's a pure derivation of `ctx.window`.

**No sort validation**: `groupSessions` sorts events within sessions, but rules that call `nextEventAfter` assume `session.events` is sorted. There's no validation that `ctx.events` itself is sorted before `groupSessions` processes it — the sort inside `groupSessions` corrects this per-session, but if a rule ever processes `ctx.events` directly (in time order), it could produce wrong results.

### Parallelism opportunity

Rules currently run sequentially:

```ts
for (const rule of ALL_AUDIT_RULES) {
  const out = rule.evaluate(ctx);
  findings.push(...out);
}
```

Since rules are pure functions, they can be parallelized trivially:

```ts
const results = await Promise.all(
  ALL_AUDIT_RULES.map((rule) => Promise.resolve(rule.evaluate(ctx)))
);
```

On a 100ms p50 rule, sequential = ~1900ms across 19 rules; parallel = ~100ms. This is a trivial change for a meaningful latency reduction.

---

## 3. What happens at 1M events/day

At 1M daily events with a 30-day window = 30M events in memory. That's ~15GB, which is fundamentally incompatible with the current in-memory approach.

**Recommended fix**: Pre-group sessions once at the `AuditRuleContext` construction site (in the route handler, before calling `runAuditRules`), and store the result in the context:

```ts
// In the route handler, before running rules:
ctx.sessionTraces = groupSessions(ctx.events);
```

Rules then consume `ctx.sessionTraces` instead of calling `groupSessions` themselves, reducing redundancy from 4× to 1×. At scale, the real fix is windowed pre-aggregation (streaming events into daily rollups) rather than running rules over raw event arrays — the rollup layer (`RollupResult`) already provides a path for this.

---

## 4. Extension points

| What | Effort | Notes |
|---|---|---|
| New rule | Low | Implement `AuditRule`, register in index. 2 files. |
| New `goalType` | Low | Add a `case` in `computeImpactEstimate`'s switch. |
| New `AuditFindingEvidence` field | Low | Add to interface in `types.ts`. |
| New evidence renderer in UI | Low | Consumes existing `evidence[]` array. |
| Cross-rule correlation (e.g., rage + churn) | Medium | Requires a new rollup/synthesis layer above `runAuditRules`. Rules themselves can't reference each other's output. |
| Real-time evaluation (streaming events) | High | Rules are batch-only today — they consume a static `events: CanonicalEvent[]`. Streaming requires rules to be rewritten as incremental reducers. |
| Multi-tenant isolation | Medium | No tenant boundary enforcement at the rule level today. `AuditRuleContext` carries `organizationId`/`siteId` but rules don't validate them. An operator with the wrong config could see cross-tenant data if context is constructed incorrectly. A `siteId` assertion in `runAuditRules` or a context validation step would close this. |

---

## 5. Summary of identified issues

1. **`groupSessions` called 4× per pipeline run** — O(N × rules) instead of O(N). Pre-compute once on context. Impact: ~4× redundant work at scale.
2. **`windowDaysFromTimeWindow` called per-rule** — minor, O(1), but structurally should be pre-computed on context.
3. **No sort validation on `ctx.events`** — rules using `nextEventAfter` rely on sort order established inside `groupSessions`, but a future rule reading `ctx.events` directly could produce wrong results. Document the invariant or add an assertion.
4. **Sequential rule execution** — no parallelism today. Trivial to fix with `Promise.all`.
5. **No hard volume ceiling** — at 500k+ events, in-memory approach risks OOM. Route handler should enforce a max-events limit (e.g., 250k) and fail gracefully rather than silently degrading.

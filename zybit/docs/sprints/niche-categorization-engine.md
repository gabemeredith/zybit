# Site Niche Categorization Engine

**Branch:** `feat/audit-report-formatting`
**Shipped:** 2026-05-28
**Status:** ✅ Live — 1285 tests passing

---

## Why it exists

The public audit lead magnet ran the same rule set against every site. A
student fraternity's homepage got the same "no proof signals" finding as a
Series-A SaaS startup — because the proof-missing rule fired on anything that
lacked logos and metrics, regardless of whether the site was a commercial
product or a membership org. A DevTools site whose terse hero ("The fastest
HTTP client for Node") scored low on specificity got "your hero is too vague"
even though terse technical copy is the norm in that space.

The fix is a **site-level niche classifier** that runs before the rule loop
and passes commercial context to every rule. Community/nonprofit/student-org
sites stop getting commercial-conversion prescriptions. DevTools sites don't
get penalised for terse copy. E-commerce sites get tighter CTA thresholds.

---

## Architecture

### Two-dimensional modulation

Rules now get two independent suppression/modulation signals:

| Dimension | File | Answers |
|-----------|------|---------|
| Page-level | `pageTypeModulation.ts` | Does this rule make sense on *this page type*? (legal vs. pricing vs. docs) |
| Site-level | `siteNicheModulation.ts` | Does this rule make sense for *this kind of site*? (SaaS vs. community vs. education) |

Both are pure functions. Both return a `{ suppress, severityDowngrade }` shape.
If **either** suppresses, the finding is dropped. If either sets `severityDowngrade`,
the finding severity is lowered from `warn` → `info`.

### Classifier: `src/lib/phase2/classification/siteClassifier.ts`

**Input:** All `PageSnapshot[]` for the site.

**Output:** `SiteNiche` — one of `'saas' | 'devtools' | 'ecommerce' | 'community' | 'media' | 'local' | 'education' | 'unknown'`.

**Method:** Weighted signal scoring across three signal tiers:

1. **Domain TLD / hostname** (checked once from the first snapshot URL) — `.edu` → education, `.org` → community, `.shop` → ecommerce, etc.
2. **URL path patterns** (per snapshot) — `/cart/` → ecommerce, `/api-reference/` → devtools, `/admissions/` → education, etc.
3. **Text content** (title, meta description, headings, CTA labels per snapshot) — ~200 patterns, weight 0.5–3.

**Confidence gate:** The winning niche must:
- Achieve `score ≥ 4.0` (minimum absolute threshold)
- Score `≥ 2.0×` the runner-up (confidence margin)

If either gate fails, returns `'unknown'` — rules apply base thresholds
unchanged. Fail-open: a site with weak or ambiguous signals is never
misclassified; it just gets no modulation.

### Modulation table: `src/lib/phase2/rules/siteNicheModulation.ts`

| Rule | Niche | Effect |
|------|-------|--------|
| `above-fold-coverage` | community, education, media | suppress |
| `hero-hierarchy-inversion` | community, education, devtools | severity downgrade |
| `vague-claim-detected` | community, education, media | suppress |
| `vague-claim-detected` | devtools, local | severity downgrade |
| `proof-missing` | community, education, local, media | suppress |
| `cta-verb-mismatch` | community, education, media | suppress |

### Pipeline wiring: `runInsightsPipeline.ts`

```typescript
const siteNiche = classifySiteFromSnapshots(pageSnapshots);

const auditReport = runAuditRules({
  // ...
  siteNiche,
});
```

`siteNiche` is now a field on `AuditRuleContext`. Rules that don't use it ignore it.
Rules that do use it call `siteNicheModulation(ruleId, ctx.siteNiche)` at the top of
their `evaluate()` method — same pattern as `pageTypeModulation`.

---

## Niche coverage

### Commercial niches (conversion rules apply at full strength)

- **`saas`** — SaaS products. Signals: "free trial", "book a demo", "no credit card required",
  "per seat", SSO, SLA, MRR, "cancel anytime", workspace, enterprise plan.
- **`devtools`** — Developer tools, open-source libraries, APIs, CLIs. Signals: npm/pip/brew install,
  "star on GitHub", REST API, GraphQL, webhooks, SDK, "zero config", Terraform, CNCF patterns.
- **`ecommerce`** — Transactional retail, DTC, subscription boxes. Signals: "add to cart",
  "free shipping", SKU, size guide, return policy, promo codes, "buy now", Klarna, Shopify.
- **`local`** — Location-based businesses. Signals: "book a table", "make a reservation",
  "hours of operation", "family-owned", dine-in, takeout, Yelp, TripAdvisor.

### Non-commercial niches (conversion rules suppressed or downgraded)

- **`community`** — Student orgs, nonprofits, clubs, civic groups, religious organizations.
  Signals: fraternity/sorority, brotherhood/sisterhood, 501(c)(3), rush week, philanthropy,
  volunteer, donate, HOA, Rotary Club.
- **`education`** — Schools, universities, online academies, bootcamps. Signals: admissions,
  financial aid, tuition, undergraduate, PhD, enrollment, certificate program, campus,
  faculty, GPA, `.edu` TLD.
- **`media`** — News outlets, newsletters, podcasts, publications. Signals: "subscribe to newsletter",
  breaking news, editor-in-chief, staff writer, podcast episode, "by [Author]", Substack,
  magazine, editorial, "min read".

---

## What changes for a real audit run

Before the niche engine, a student-org audit would produce:

> **No proof signals** — We found no customer logos, metrics, or testimonials in your hero block.

After:

> (finding suppressed — the `proof-missing` rule exits early on `community` sites)

Before, a DevTools product with "The fastest HTTP client for Node" as its headline:

> **Vague hero claim** (warn) — Your hero claim scored 0.3 for specificity. Consider adding a concrete outcome.

After:

> **Vague hero claim** (info) — severity downgraded from warn → info because terse technical
> copy is the expected register for developer tools.

---

## Adding new niches

1. Add the niche to the `SiteNiche` union in `siteClassifier.ts`
2. Add it to `SiteNicheScores` interface
3. Add `SIGNAL_TABLE` entries with rationale comments
4. Add `PATH_SIGNALS` and `DOMAIN_SIGNALS` entries if relevant
5. Add modulation rows to `siteNicheModulation.ts`
6. Wire up any rules that should behave differently
7. Add tests in `classification/__tests__/siteClassifier.test.ts`

---

## Adding new modulation rows

Edit `siteNicheModulation.ts`. Every `suppress: true` row must have a
rationale comment. Multipliers are not used (kept simpler than page-type
modulation — the niche dimension is binary: either a rule applies in this
context or it doesn't).

---

## Tests

| File | Tests | What's covered |
|------|-------|----------------|
| `classification/__tests__/siteClassifier.test.ts` | 15 | Classification of all 7 niches, anti-hallucination (GitHub on a fraternity site), TLD signals, multi-snapshot accumulation |
| `rules/__tests__/siteNicheModulation.test.ts` | 22 | All suppress/downgrade cells in the modulation table |

Run: `npm run verify` (full suite, includes both new files).

---

## What's NOT done yet (Phase 2)

The current classifier works purely from structural text: meta tags, heading
text, CTA labels. These are always available but miss some signals:

- **Body copy** — Not stored in `PageSnapshotData`. High-signal but requires
  a full DOM parse pass. Could be added as a `bodyTextSample` field capped at
  2 KB on the snapshot.
- **Visual signals from Gemini** — `visualSignals.pageType` already gives
  page-level context. A future `visualSignals.siteCategory` field from the
  vision pass (which sees the actual rendered page) would be more reliable
  than keyword matching but adds latency + cost.
- **TLD-alone ambiguity** — `.org` is a weak community signal (many SaaS
  tools use .org). The current weight (1.0) means it's a nudge, not a
  decision. Fine for now.
- **Multi-niche sites** — A university hospital is both `education` and
  `local`. The current model picks one winner. If both score similarly, it
  returns `unknown` (safe default). A future multi-label model could handle
  this but is not needed yet.

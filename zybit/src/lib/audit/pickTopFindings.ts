/**
 * Top-4 selection cascade for the public-audit email. Sits between the
 * persistence layer (`zybit_findings`, source of truth for the auto-
 * provisioned dashboard) and the email renderer.
 *
 * Design intent:
 *   - Findings on legal / utility / boilerplate pages are *correct* but
 *     not credibility-building in a lead-magnet email. They stay in the
 *     DB; this layer just skips them in the top-4 unless the prospect
 *     explicitly submitted one of those pages.
 *   - The diversity cascade prefers (page, rule) variety over raw score
 *     so the email reads as "what's wrong across my site", not "deep
 *     dive on one page".
 *
 * Tested by `__tests__/pickTopFindings.test.ts`. The harness in
 * `scripts/audit-batch.mjs` re-uses the same module so a route-side
 * change can't silently disagree with the harness.
 */

export interface FindingForRanking {
  id: string;
  ruleId: string;
  pathRef: string | null;
  priorityScore: number;
}

/**
 * Shape needed for site-template dedup. Subset of the full finding row —
 * just the fields needed to build a stable evidence signature.
 */
export interface FindingForCollapse extends FindingForRanking {
  evidence: unknown;
}

const SUBMITTED_PAGE_BOOST = 1.5;
const DUPLICATE_GROUP_THRESHOLD = 3;

/**
 * Path patterns we consider off-conversion-surface. The list is built from
 * observed batch-audit failures (Stripe `/impressum`, Linear `/compliance`,
 * PostHog `/baa`, Calendly `/legal`, etc.) plus the common i18n equivalents
 * — German Impressum/Datenschutz, French CGU/mentions-legales, Spanish
 * aviso-legal/legales — that the English-only allowlist would otherwise
 * miss. The regex matches the *first* path segment; nested paths like
 * `/legal/privacy` are included via the `(\/|$|-)` alternation. The `-`
 * is for hyphenated stems like `/legal-notices`.
 *
 * Findings on these paths still persist in the DB (`zybit_findings`); the
 * filter only applies to the email's top-4 selection.
 */
const OFF_CONVERSION_PATH =
  /^\/(legal|privacy|terms|tos|cookie|cookies|cookie-settings|cookie-policy|imprint|impressum|datenschutz|aviso-legal|legales|cgu|mentions-legales|compliance|gdpr|dpa|baa|hipaa|security|trust|sla|patent|patents|policies|policy|copyright|dmca|accessibility|do-not-sell|ccpa)(\/|$|-)/i;

/**
 * Returns true when the path matches one of the off-conversion stems
 * *and* the prospect didn't explicitly submit that path. If they did
 * submit `https://example.com/legal`, they want a report on /legal —
 * filtering it would deliver an empty email.
 */
export function isOffConversionPath(
  pathRef: string | null | undefined,
  submittedPath: string,
): boolean {
  if (!pathRef) return false;
  if (pathRef === submittedPath) return false;
  return OFF_CONVERSION_PATH.test(pathRef);
}

/**
 * Locale-segment matcher. Catches:
 *   `/en`, `/fr`, `/de`, `/es`, `/gb`, `/jp` — 2-letter language/region
 *   `/en-us`, `/fr-ca`, `/zh-cn`, `/pt-br` — language-region pair
 *   `/en-at`, `/fr-lu` (Stripe's exact patterns)
 *   `/global`, `/intl`, `/world`, `/regions` — locale-picker stems
 * Capture group 1 is the locale segment itself (used for stripping).
 */
const LOCALE_SEGMENT_RE =
  /^\/(([a-z]{2,3})(-[a-z]{2,4})?|global|intl|world|regions)(?=\/|$)/i;

/**
 * Normalize a path so locale variants collapse to the same key for the
 * diversity cascade's `usedPaths` set. Examples:
 *   `/`             → `/`
 *   `/en-us`        → `/`
 *   `/gb`           → `/`
 *   `/global`       → `/`
 *   `/fr-ca/pricing`→ `/pricing`
 *   `/pricing`      → `/pricing`
 *
 * Without this, the cascade treats Stripe's `/`, `/gb`, `/es`, `/fr-ca`,
 * `/en-at`, `/global` as 6 different pages and fills the top-4 with
 * locale duplicates of the same homepage finding. The handover §16.3
 * called locale duplication "pervasive on Stripe (~14 duplicates)".
 *
 * Conservative — false-positive cost is one less diverse row in the
 * email when a 2-letter path happens to be a real page (rare on B2B
 * SaaS marketing sites). True-positive benefit is correctly recognizing
 * that `/en-us` and `/` ship the same template.
 */
export function localeNormalizedPath(pathRef: string | null | undefined): string {
  if (!pathRef) return '/';
  const stripped = pathRef.replace(LOCALE_SEGMENT_RE, '');
  return stripped === '' ? '/' : stripped;
}

/**
 * Build a stable signature for a finding's evidence, used as the dedup
 * key alongside ruleId. Only the (label, value) pairs are keyed.
 *
 * The `pathRef` argument is the finding's own path — when an evidence
 * value equals it, the row is dropped from the signature. Some rules
 * embed the path in their own evidence (e.g. `missing-canonical-url`
 * emits `{ label: 'Page path', value: snapshot.pathRef }`), which
 * would otherwise make every page's finding signature unique and defeat
 * the dedup. Filtering by the finding's own pathRef catches that
 * pattern without needing a per-rule label allowlist.
 *
 * The `context` field is allowed to vary because rules sometimes embed
 * pathRef-derived prose ("No H1 found on `/billing`") — same reasoning.
 *
 * Non-array / unrecognized evidence shapes return the empty signature,
 * which still groups identically-shaped "no evidence" findings together.
 */
function evidenceSignature(evidence: unknown, pathRef: string | null): string {
  if (!Array.isArray(evidence)) return '';
  return evidence
    .map((e) => {
      if (!e || typeof e !== 'object') return '';
      const label = String((e as { label?: unknown }).label ?? '');
      const value = String((e as { value?: unknown }).value ?? '');
      if (pathRef && value === pathRef) return '';
      return `${label}=${value}`;
    })
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * Pick the representative for a duplicate group. Prefers the submitted
 * path so the PM sees their landing page as the canonical instance, then
 * highest priorityScore, then `/` over any other path, then alphabetical
 * for determinism.
 */
function pickRepresentative<T extends FindingForCollapse>(
  group: readonly T[],
  submittedPath: string,
): T {
  const submitted = group.find((f) => f.pathRef === submittedPath);
  if (submitted) return submitted;
  const sorted = [...group].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (a.pathRef === '/') return -1;
    if (b.pathRef === '/') return 1;
    return (a.pathRef ?? '').localeCompare(b.pathRef ?? '');
  });
  return sorted[0];
}

/**
 * Build the "Also affects" evidence row appended to the representative's
 * existing evidence. Truncates long path lists so the email card stays
 * readable.
 */
function buildAffectsRow(otherPaths: readonly string[]): { label: string; value: string; context?: string } {
  const MAX_PATHS_SHOWN = 5;
  const head = otherPaths.slice(0, MAX_PATHS_SHOWN).join(', ');
  const tail = otherPaths.length > MAX_PATHS_SHOWN
    ? ` (+${otherPaths.length - MAX_PATHS_SHOWN} more)`
    : '';
  return {
    label: 'Also affects',
    value: `${head}${tail}`,
    context: `Same issue on ${otherPaths.length} other page${otherPaths.length === 1 ? '' : 's'} sharing this template`,
  };
}

/**
 * Collapse template-duplicate findings before the diversity cascade runs.
 *
 * The schema `findingPk(siteId, ruleId, pathRef)` allows one row per
 * (rule, path), so a site whose 8 pages share a template missing the same
 * three HTML elements emits 24 findings. The handover §16.5 called this
 * out as the Linear case ("affects 8 pages" should be one finding, not
 * eight). Collapse here means: when ≥ 3 findings under one ruleId share
 * the same evidence signature, keep the representative (homepage-favored)
 * and append an "Also affects: /a, /b, /c…" evidence row.
 *
 * Returns a new array; never mutates the input. Findings with no
 * duplicate group (or with fewer than the threshold's worth of duplicates)
 * pass through unchanged.
 */
export function collapseDuplicateFindings<T extends FindingForCollapse>(
  findings: readonly T[],
  submittedPath: string,
): T[] {
  const groups = new Map<string, T[]>();
  for (const f of findings) {
    const key = `${f.ruleId}|${evidenceSignature(f.evidence, f.pathRef)}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(f);
    groups.set(key, bucket);
  }
  const out: T[] = [];
  for (const group of groups.values()) {
    if (group.length < DUPLICATE_GROUP_THRESHOLD) {
      out.push(...group);
      continue;
    }
    const rep = pickRepresentative(group, submittedPath);
    const otherPaths = group
      .filter((f) => f.id !== rep.id)
      .map((f) => f.pathRef ?? '/');
    const existingEvidence = Array.isArray(rep.evidence) ? rep.evidence : [];
    const augmented = {
      ...rep,
      evidence: [...existingEvidence, buildAffectsRow(otherPaths)],
    } as T;
    out.push(augmented);
  }
  // Preserve a sorted-by-score order so callers that don't re-sort still
  // get sensible iteration. The cascade re-sorts anyway.
  out.sort((a, b) => b.priorityScore - a.priorityScore);
  return out;
}

/**
 * Pick the top N (default 4) findings for the prospect's email using a
 * 4-pass diversity cascade:
 *   Pass 1 — page-unique AND rule-unique (ideal: 4 different pages, 4
 *            different problems).
 *   Pass 2 — page-unique, rule may repeat (different pages, same
 *            problem — covers site-template issues).
 *   Pass 3 — rule-unique, page may repeat (same page, different
 *            problems — fallback when the site is small).
 *   Pass 4 — anything to reach N.
 *
 * Findings on off-conversion paths (legal/utility) are skipped across all
 * passes unless the prospect submitted that path.
 */
export function pickTopFindings<T extends FindingForRanking>(
  findings: readonly T[],
  submittedPath: string,
  limit = 4,
): { top: T[]; ranked: T[] } {
  const effectiveScore = (f: T): number =>
    f.priorityScore * (f.pathRef === submittedPath ? SUBMITTED_PAGE_BOOST : 1);

  const ranked = [...findings].sort(
    (a, b) => effectiveScore(b) - effectiveScore(a),
  );

  const top: T[] = [];
  const pickedIds = new Set<string>();
  const usedRules = new Set<string>();
  const usedPaths = new Set<string>();
  // Normalize for diversity: `/`, `/en-us`, `/gb`, `/fr-ca` collapse to
  // the same key so the cascade doesn't pad top-4 with locale duplicates
  // of the same homepage finding. Raw pathRef is still on the finding
  // itself for evidence rendering.
  const pathOf = (f: T): string => localeNormalizedPath(f.pathRef);

  const skip = (f: T): boolean =>
    pickedIds.has(f.id) || isOffConversionPath(f.pathRef, submittedPath);

  const accept = (f: T): void => {
    top.push(f);
    pickedIds.add(f.id);
    usedPaths.add(pathOf(f));
    usedRules.add(f.ruleId);
  };

  // Pass 1: page + rule both unique
  for (const f of ranked) {
    if (top.length === limit) break;
    if (skip(f)) continue;
    if (usedPaths.has(pathOf(f)) || usedRules.has(f.ruleId)) continue;
    accept(f);
  }
  // Pass 2: page unique, rule may repeat
  for (const f of ranked) {
    if (top.length === limit) break;
    if (skip(f)) continue;
    if (usedPaths.has(pathOf(f))) continue;
    accept(f);
  }
  // Pass 3: rule unique, page may repeat
  for (const f of ranked) {
    if (top.length === limit) break;
    if (skip(f)) continue;
    if (usedRules.has(f.ruleId)) continue;
    accept(f);
  }
  // Pass 4: anything to reach limit. Still respects the off-conversion
  // filter — we'd rather ship 3 findings than pad with a legal-page row.
  for (const f of ranked) {
    if (top.length === limit) break;
    if (skip(f)) continue;
    accept(f);
  }

  return { top, ranked };
}

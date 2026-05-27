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

const SUBMITTED_PAGE_BOOST = 1.5;

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

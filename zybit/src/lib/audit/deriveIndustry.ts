/**
 * Deterministic industry classifier for the public audit funnel.
 *
 * Used to populate `app_users.industry` from an audited URL the first time
 * a user runs the public audit. Pure function — no LLM, no network, no DB.
 * The bar is: never invent an industry. If signals are weak or ambiguous,
 * return null so the column stays NULL and downstream code knows not to
 * key personalization off it.
 *
 * Signals (in priority order, first hit wins):
 *   1. Hostname (subdomain + apex)
 *   2. Path
 *   3. Page meta (title + description) and first H1, when provided
 *
 * Categories are intentionally coarse and disjoint. We do not try to be
 * MECE across the whole web — only across the subset of B2B SaaS / DTC /
 * fintech / health / media sites the audit funnel actually targets.
 */

export type Industry = 'saas' | 'ecommerce' | 'fintech' | 'healthtech' | 'media';

export interface IndustrySignals {
  title?: string | null;
  description?: string | null;
  headings?: string[];
}

const ECOM_RE =
  /\b(shop|cart|checkout|product|sku|store|buy now|add to (bag|cart)|free shipping|order now)\b/;
const FINTECH_RE =
  /\b(bank|banking|invest|investment|loan|mortgage|trading|brokerage|crypto|portfolio|wallet|fintech)\b/;
const HEALTH_RE =
  /\b(patient|clinic|doctor|telehealth|pharmacy|prescription|insurance|healthcare|health plan|medical)\b/;
const SAAS_RE =
  /\b(saas|platform|api|workspace|dashboard|integrations?|workflow|automation|all[- ]in[- ]one|crm)\b/;
const MEDIA_RE =
  /\b(news|magazine|editorial|column|podcast|episode|article|newsroom|publisher)\b/;

const HOST_HINTS: Array<[RegExp, Industry]> = [
  [/(^|\.)shopify\.com$|\.myshopify\.com$/, 'ecommerce'],
  [/(^|\.)stripe\.com$/, 'fintech'],
  [/(^|\.)salesforce\.com$/, 'saas'],
  [/(^|\.)nytimes\.com$|(^|\.)washingtonpost\.com$|(^|\.)medium\.com$/, 'media'],
];

const SUBDOMAIN_HINTS: Array<[RegExp, Industry]> = [
  [/^shop\./, 'ecommerce'],
  [/^store\./, 'ecommerce'],
  [/^app\./, 'saas'],
  [/^admin\./, 'saas'],
  [/^bank\./, 'fintech'],
  [/^pay\./, 'fintech'],
];

const PATH_HINTS: Array<[RegExp, Industry]> = [
  [/\/(cart|checkout|products?|collections?|shop|store)(\/|$)/, 'ecommerce'],
  [/\/(pricing|integrations?|api|docs|workspace|dashboard)(\/|$)/, 'saas'],
  [/\/(news|magazine|podcasts?|articles?|stories)(\/|$)/, 'media'],
];

/**
 * Returns the most-likely industry for an audited URL, or `null` when no
 * deterministic signal fires. Caller writes the result to
 * `app_users.industry` only if it's non-null AND the existing value is
 * NULL — we never overwrite an explicit classification.
 */
export function deriveIndustry(
  rawUrl: string,
  signals?: IndustrySignals,
): Industry | null {
  let host = '';
  let path = '';
  try {
    const u = new URL(rawUrl);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }

  for (const [re, industry] of HOST_HINTS) {
    if (re.test(host)) return industry;
  }
  for (const [re, industry] of SUBDOMAIN_HINTS) {
    if (re.test(host)) return industry;
  }
  for (const [re, industry] of PATH_HINTS) {
    if (re.test(path)) return industry;
  }

  // Last resort: page copy. Cheaper hint set, ordered by specificity so a
  // bank that also says "platform" doesn't get classified as saas.
  const copy = [
    signals?.title ?? '',
    signals?.description ?? '',
    ...(signals?.headings ?? []),
  ]
    .join(' ')
    .toLowerCase();

  if (!copy.trim()) return null;
  if (FINTECH_RE.test(copy)) return 'fintech';
  if (HEALTH_RE.test(copy)) return 'healthtech';
  if (ECOM_RE.test(copy)) return 'ecommerce';
  if (MEDIA_RE.test(copy)) return 'media';
  if (SAAS_RE.test(copy)) return 'saas';
  return null;
}

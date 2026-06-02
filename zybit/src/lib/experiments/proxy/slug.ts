/**
 * Pure helpers for proxy-slug derivation, validation, and collision-resolution.
 *
 * The slug is what addresses a customer's site at the proxy edge: visitors arrive
 * at <slug>.zybit.run, the middleware looks up phase1_sites.proxy_slug, and the
 * request is routed to the right origin. The slug is unique across all customers
 * (enforced by phase1_sites_proxy_slug_idx).
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Subdomains we never hand out — either reserved for Zybit infrastructure
 * (api, app, admin, proxy, …) or commonly used in customer-facing apex chains
 * (www, mail, …). Keep this list small; we'd rather collide later than
 * proactively block legitimate slugs.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'cdn',
  'docs',
  'js',
  'mail',
  'proxy',
  'static',
  'www',
];

export type SlugValidation = { ok: true } | { ok: false; reason: string };

/**
 * Strip protocol/trailing slash, take the label before the first `.`, lowercase,
 * and replace any non-`[a-z0-9-]` runs with a single `-`. Trims leading/trailing
 * hyphens. Result may still need uniqueness + reserved-list checks via isValidSlug.
 */
export function deriveSlugFromDomain(domain: string): string {
  const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const firstLabel = cleaned.split('.')[0] ?? '';
  return firstLabel
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isValidSlug(slug: string): SlugValidation {
  if (!slug) return { ok: false, reason: 'Slug cannot be empty.' };
  if (slug.length < 3) return { ok: false, reason: 'Slug must be at least 3 characters.' };
  if (slug.length > 32) return { ok: false, reason: 'Slug must be at most 32 characters.' };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: 'Slug must be lowercase letters, digits, or hyphens, and cannot start or end with a hyphen.',
    };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { ok: false, reason: `"${slug}" is reserved.` };
  }
  return { ok: true };
}

/**
 * Suggest the next slug not in `taken`. Tries `${base}-2`, `${base}-3`, …
 * up to `-99`. Useful UX when the PM's first choice collides; we suggest a
 * sensible alternative they can accept or override.
 */
export function suggestAlternativeSlug(base: string, taken: ReadonlySet<string>): string {
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Extremely unlikely fallback — collision-prone but valid.
  return `${base}-${Date.now().toString(36)}`;
}

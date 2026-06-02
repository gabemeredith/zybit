/**
 * Collapses a raw event `path` into a stable flow-graph route key. Query and
 * hash are dropped; trailing slashes are trimmed; segments that look like
 * record identifiers (all-digits, UUIDs, long hex) collapse to `:id` so
 * dynamic routes like `/orders/8841` and `/orders/9920` map to one flow node
 * instead of fragmenting the graph into thousands of single-visit routes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;
const ALL_DIGITS_RE = /^\d+$/;

function isIdSegment(segment: string): boolean {
  return (
    ALL_DIGITS_RE.test(segment) ||
    UUID_RE.test(segment) ||
    LONG_HEX_RE.test(segment)
  );
}

export function normalizeRoute(rawPath: string): string {
  if (typeof rawPath !== 'string') return '/';
  let path = rawPath.trim();
  if (path === '') return '/';

  // Drop query string and hash fragment.
  const cutIdx = path.search(/[?#]/);
  if (cutIdx !== -1) path = path.slice(0, cutIdx);

  if (path === '' || path === '/') return '/';

  // Single leading slash; no trailing slash.
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const normalized = path
    .split('/')
    .map((seg) => (isIdSegment(seg) ? ':id' : seg))
    .join('/');

  return normalized === '' ? '/' : normalized;
}

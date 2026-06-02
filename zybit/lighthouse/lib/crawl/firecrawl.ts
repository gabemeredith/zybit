/**
 * Firecrawl-backed page discovery for the URL-audit mode.
 *
 * Lighthouse's scenario runner drives hand-authored fake sites; the URL-audit
 * mode instead points at an arbitrary live site. Discovering which pages a
 * site has is the one genuinely new capability — and Firecrawl's `/v1/map`
 * endpoint does it in a single fast call (it returns every URL Firecrawl can
 * see for a domain). We use Firecrawl ONLY for discovery: the pages it returns
 * are then fetched + parsed by Zybit's own snapshot pipeline, so the audit
 * still exercises the real `Understand` fetch+parse path.
 *
 * Requires `FIRECRAWL_KEY` in the environment (set it in `lighthouse/.env`).
 */

const FIRECRAWL_MAP_ENDPOINT = 'https://api.firecrawl.dev/v1/map';
const REQUEST_TIMEOUT_MS = 60_000;

/** A page discovered on the target site, ready to be snapshotted. */
export interface CrawledPage {
  /** Fully-qualified URL to fetch. */
  url: string;
  /** Path portion, normalized (no trailing slash, no query/fragment). */
  pathRef: string;
}

export interface MapSiteResult {
  /** The URL the operator asked to audit. */
  requestedUrl: string;
  /** Total distinct same-origin pages Firecrawl returned (before the cap). */
  discovered: number;
  /** Pages after dedupe + cap, sorted shallowest-path-first. */
  pages: CrawledPage[];
}

/** Extensions that are clearly not HTML pages — skip them. */
const NON_HTML_EXT =
  /\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|mjs|json|xml|txt|zip|gz|mp4|webm|mp3|woff2?|ttf|eot)$/i;

function normalizePathRef(pathname: string): string {
  if (pathname.length === 0) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

/** Extracts a string URL from Firecrawl's `links` entries (string or object). */
function readLink(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const url = (entry as { url?: unknown }).url;
    if (typeof url === 'string') return url;
  }
  return null;
}

/**
 * Discover pages on `requestedUrl` via Firecrawl `/v1/map`, then dedupe by
 * path, drop non-HTML assets + cross-origin links, and cap to `maxPages`
 * (shallowest paths first so the audit covers the funnel, not deep leaves).
 *
 * The requested URL itself is always included even if `/map` omits it.
 */
export async function mapSite(
  requestedUrl: string,
  maxPages: number,
): Promise<MapSiteResult> {
  const apiKey = process.env.FIRECRAWL_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error(
      'FIRECRAWL_KEY env var is required for URL-audit mode. Set it in lighthouse/.env.',
    );
  }

  const root = new URL(requestedUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let payload: { success?: boolean; links?: unknown; error?: unknown };
  try {
    const res = await fetch(FIRECRAWL_MAP_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: requestedUrl }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firecrawl /map returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    payload = (await res.json()) as typeof payload;
  } finally {
    clearTimeout(timer);
  }

  if (payload.success === false) {
    throw new Error(
      `Firecrawl /map failed: ${typeof payload.error === 'string' ? payload.error : 'unknown error'}`,
    );
  }

  const rawLinks = Array.isArray(payload.links) ? payload.links : [];
  // Always seed with the requested URL so a `/map` miss can't yield 0 pages.
  const candidates: string[] = [requestedUrl];
  for (const entry of rawLinks) {
    const link = readLink(entry);
    if (link !== null) candidates.push(link);
  }

  const byPath = new Map<string, CrawledPage>();
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate, root);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (parsed.host !== root.host) continue;
    if (NON_HTML_EXT.test(parsed.pathname)) continue;
    // Firecrawl's /map can return glob URLs like `https://example.com/*` to
    // signal "any path under this prefix". They are not real pages — fetching
    // them on a SPA returns a fallback view that emits bogus findings under
    // pathRef=/*, while the real homepage gets crawled separately as `/`.
    if (/[*?[\]{}]/.test(parsed.pathname)) continue;
    const pathRef = normalizePathRef(parsed.pathname);
    if (byPath.has(pathRef)) continue;
    // Drop query + fragment — the snapshot pipeline keys on pathRef.
    byPath.set(pathRef, {
      url: `${parsed.origin}${parsed.pathname}`,
      pathRef,
    });
  }

  const discovered = byPath.size;
  const pages = [...byPath.values()]
    .sort((a, b) => {
      const depthA = a.pathRef.split('/').length;
      const depthB = b.pathRef.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a.pathRef.localeCompare(b.pathRef);
    })
    .slice(0, Math.max(1, maxPages));

  return { requestedUrl, discovered, pages };
}

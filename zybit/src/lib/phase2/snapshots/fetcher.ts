/**
 * Resilient HTML fetcher for Page DNA snapshots.
 *
 * v1 is HTML-only. We do not execute JS or parse anything beyond the
 * response — that's the parser's job. We intentionally keep this layer
 * narrow so fetch behavior (timeouts, redirects, robots.txt) is testable
 * in isolation.
 */

import {
  DEFAULT_SNAPSHOT_FETCH_OPTIONS,
  SnapshotError,
  type SnapshotFetchOptions,
  type SnapshotFetchResult,
  type SnapshotFetcher,
} from './types';
import { isSpaHtml, runBrowserSnapshot } from './browserFetcher';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ROBOTS_TIMEOUT_MS = 1_500;

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch (err) {
    throw new SnapshotError('INVALID_URL', `cannot parse url: ${url}`, err);
  }
}

/**
 * Strict, single-block robots.txt parser. v1 only honors the `User-agent: *`
 * group and treats `Disallow:` as a literal path-prefix rule. We deliberately
 * skip `Allow:` since we never need to grant access — only avoid hostility.
 */
export function isPathDisallowedByRobots(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inStarBlock = false;
  let blocked = false;

  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (directive === 'user-agent') {
      inStarBlock = value === '*';
      continue;
    }
    if (!inStarBlock) continue;
    if (directive === 'disallow' && value.length > 0 && path.startsWith(value)) {
      blocked = true;
    }
  }
  return blocked;
}

async function checkRobots(originUrl: URL, userAgent: string): Promise<void> {
  const robotsUrl = `${originUrl.origin}/robots.txt`;
  let body: string;
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'user-agent': userAgent, accept: 'text/plain,*/*;q=0.5' },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return;
    body = await res.text();
  } catch {
    // best-effort — any fetch/parse failure means we proceed.
    return;
  }
  const path = originUrl.pathname || '/';
  if (isPathDisallowedByRobots(body, path)) {
    throw new SnapshotError('BLOCKED_BY_ROBOTS', `robots.txt disallows ${path}`);
  }
}

function isAbortLike(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<{ html: string; byteSize: number }> {
  if (!response.body) {
    // Fall back to text() when the streaming body isn't available. Cheaply
    // reject obviously oversized responses via Content-Length first so we
    // don't materialize a multi-megabyte payload into memory only to throw.
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new SnapshotError('TOO_LARGE', `response exceeds ${maxBytes} bytes`);
      }
    }
    const text = await response.text();
    const byteSize = new TextEncoder().encode(text).byteLength;
    if (byteSize > maxBytes) {
      throw new SnapshotError('TOO_LARGE', `response exceeds ${maxBytes} bytes`);
    }
    return { html: text, byteSize };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SnapshotError('TOO_LARGE', `response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof SnapshotError) throw err;
    if (isAbortLike(err)) {
      throw new SnapshotError('TIMEOUT', 'read timed out', err);
    }
    throw new SnapshotError('NETWORK_ERROR', err instanceof Error ? err.message : 'read failed', err);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const html = new TextDecoder('utf-8').decode(merged);
  return { html, byteSize: total };
}

function ensureSuccessStatus(status: number): void {
  if (status >= 400 && status < 500) {
    throw new SnapshotError('STATUS_4XX', `unexpected status ${status}`);
  }
  if (status >= 500 && status < 600) {
    throw new SnapshotError('STATUS_5XX', `unexpected status ${status}`);
  }
  if (status < 200 || status >= 300) {
    throw new SnapshotError('NETWORK_ERROR', `unexpected status ${status}`);
  }
}

function ensureHtml(contentType: string | null): void {
  if (!contentType || !contentType.toLowerCase().includes('text/html')) {
    throw new SnapshotError('NON_HTML', `content-type is not html: ${contentType ?? '(missing)'}`);
  }
}

export const fetchHtml: SnapshotFetcher = async (
  url: string,
  options?: Partial<SnapshotFetchOptions>,
): Promise<SnapshotFetchResult> => {
  const opts: SnapshotFetchOptions = { ...DEFAULT_SNAPSHOT_FETCH_OPTIONS, ...options };

  const initialUrl = parseUrl(url);

  if (opts.respectRobots) {
    await checkRobots(initialUrl, opts.userAgent);
  }

  let currentUrl = initialUrl.toString();
  let response: Response | null = null;

  for (let hop = 0; hop <= opts.followRedirects; hop++) {
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      if (err instanceof SnapshotError) throw err;
      if (isAbortLike(err)) {
        throw new SnapshotError('TIMEOUT', `request timed out after ${opts.timeoutMs}ms`, err);
      }
      throw new SnapshotError('NETWORK_ERROR', err instanceof Error ? err.message : 'fetch failed', err);
    }

    if (!REDIRECT_STATUSES.has(response.status)) break;

    const location = response.headers.get('location');
    if (!location) break;
    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch (err) {
      throw new SnapshotError('NETWORK_ERROR', `invalid redirect target: ${location}`, err);
    }
    // Drain the redirect body so the connection can be reused.
    try {
      await response.body?.cancel();
    } catch {
      // ignore — we're moving on either way
    }
    response = null;
  }

  if (!response) {
    throw new SnapshotError('NETWORK_ERROR', 'too many redirects');
  }

  if (REDIRECT_STATUSES.has(response.status)) {
    throw new SnapshotError('NETWORK_ERROR', 'too many redirects');
  }

  ensureSuccessStatus(response.status);

  const contentType = response.headers.get('content-type');
  ensureHtml(contentType);

  const { html, byteSize } = await readBodyWithLimit(response, opts.maxBytes);

  // If the response looks like a SPA shell, attempt a Browserless render.
  // runBrowserSnapshot returns null when BROWSERLESS_KEY is unset or on error.
  if (isSpaHtml(html)) {
    const browserResult = await runBrowserSnapshot(currentUrl, { timeoutMs: opts.timeoutMs });
    if (browserResult) {
      return {
        finalUrl: browserResult.finalUrl,
        status: response.status,
        contentType,
        html: browserResult.html,
        byteSize: new TextEncoder().encode(browserResult.html).byteLength,
        snapshotMethod: 'browser',
      };
    }
  }

  return {
    finalUrl: currentUrl,
    status: response.status,
    contentType,
    html,
    byteSize,
    snapshotMethod: 'http-only',
  };
};

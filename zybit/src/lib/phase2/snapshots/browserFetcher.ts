/**
 * FORGE-102 — Browserless.io snapshot fetcher for SPA/JS-rendered pages.
 *
 * The existing HTTP fetcher in fetcher.ts returns near-empty HTML for any
 * React, Vue, Angular, or Next.js app that renders client-side. This module
 * replaces that path when a SPA is detected.
 *
 * Usage (see fetcher.ts integration point below):
 *   const result = await runBrowserSnapshot(url, { timeoutMs: 10_000 });
 *
 * Prerequisite:
 *   Add BROWSERLESS_KEY to Vercel env vars:
 *   `vercel env add BROWSERLESS_KEY`
 *
 * Browserless.io docs: https://docs.browserless.io
 * API: wss://chrome.browserless.io?token={BROWSERLESS_KEY}
 *
 * Cost: ~$0.005/session at pay-as-you-go. Cap at top 50 paths/site/day.
 * Fallback: if BROWSERLESS_KEY is absent or Browserless is unavailable,
 *           returns null and caller should use HTTP fetcher result.
 *
 * TODO: Implement this module.
 *
 * Implementation checklist:
 *   [ ] 1. Install playwright: `npm install playwright` (already in devDeps? check package.json)
 *   [ ] 2. Connect via CDP: playwright.chromium.connectOverCDP(wssUrl)
 *   [ ] 3. Open page, goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })
 *   [ ] 4. Get page.content() and call the existing parseHtml() from parser.ts
 *   [ ] 5. Close client
 *   [ ] 6. Return SnapshotFetchResult with snapshotMethod: 'browser'
 *   [ ] 7. On any error: log warning, return null (caller falls back to HTTP)
 *
 * SPA detection heuristic (add to fetcher.ts):
 *   If raw HTML body is < 500 chars after stripping script tags, OR
 *   body contains exactly '<div id="root"></div>' or '<div id="app"></div>'
 *   with no other content → is_spa = true → call runBrowserSnapshot.
 *
 * Integration point in fetcher.ts:
 *   import { runBrowserSnapshot } from './browserFetcher';
 *   ...
 *   if (isSpaHtml(rawHtml)) {
 *     const browserResult = await runBrowserSnapshot(url, options);
 *     if (browserResult) return { ...browserResult, snapshotMethod: 'browser' };
 *   }
 *   return { ...httpResult, snapshotMethod: 'http-only' };
 *
 * Add snapshotMethod: 'http-only' | 'browser' to SnapshotFetchResult type.
 * Store snapshotMethod in phase2_page_snapshots.data (already JSONB).
 * Surface 'http-only' as a warning in the cockpit when BROWSERLESS_KEY is set
 * but a SPA was detected (means the audit may be incomplete).
 */

export interface BrowserSnapshotOptions {
  timeoutMs?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface BrowserSnapshotResult {
  html: string;
  finalUrl: string;
  snapshotMethod: 'browser';
}

/**
 * Returns true if the raw HTML looks like a JS-rendered SPA shell
 * (nearly empty body, no readable content).
 */
export function isSpaHtml(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;
  const bodyContent = bodyMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  if (bodyContent.length >= 200) return false;
  return /<div\s+id=["']?(root|app|main|content|mount)["']?/i.test(html);
}

/**
 * Fetch a JS-rendered page via Browserless.io and return the rendered HTML.
 *
 * Returns null if BROWSERLESS_KEY is not set or if the fetch fails.
 * Callers should always fall back to the HTTP fetcher result when this returns null.
 */
export async function runBrowserSnapshot(
  url: string,
  options: BrowserSnapshotOptions = {},
): Promise<BrowserSnapshotResult | null> {
  const token = process.env.BROWSERLESS_KEY;
  if (!token) return null;

  const { chromium } = await import('playwright-core');
  const { timeoutMs = 10_000, viewportWidth = 1280, viewportHeight = 900 } = options;
  const wssUrl = `wss://chrome.browserless.io?token=${encodeURIComponent(token)}`;

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    browser = await chromium.connectOverCDP(wssUrl);
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    const html = await page.content();
    const finalUrl = page.url();
    await context.close();
    return { html, finalUrl, snapshotMethod: 'browser' };
  } catch (err) {
    console.warn('[browserFetcher] Browserless fetch failed', { url, error: String(err) });
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

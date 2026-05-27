/**
 * Tier 1 render: pair a "before" screenshot (raw captured HTML) with an
 * "after" screenshot of the same HTML after a `VariantModification[]` is
 * applied. Both screenshots come from a single Browserless session — one
 * connection, two pages — so the audit cost is two PNGs, not two Chromes.
 *
 * The Tier 1 happy path:
 *
 *   1. Fetch the live origin HTML through the shared SSRF guard
 *      (`fetchWithSsrfGuard`). Same hop cap, same private-IP block as the
 *      finding-preview route.
 *   2. Apply mods with `applyModifications` → `afterHtml`. If the apply is
 *      a no-op (mods all failed to resolve), return null so the caller can
 *      fall through to Tier 2.
 *   3. Strip scripts from both HTML payloads. The annotated-finding screenshot
 *      already does this for XSS hardening; the same hardening applies here
 *      and also avoids the "page hydrates and lays out differently in
 *      Browserless than the user's browser" class of flakiness.
 *   4. Open one Browserless connection, two `BrowserContext` + Page pairs,
 *      `setContent` each, screenshot at 1280×900.
 *   5. Upload both PNGs to Vercel Blob (public — these are screenshots of
 *      the customer's own page, no secrets).
 *
 * Fail-soft at every step: missing env, fetch failure, no-op apply,
 * Browserless error, Blob error all return `null` and the orchestrator
 * advances to Tier 2.
 */

import { put } from '@vercel/blob';
import { applyModifications, stripScripts } from '@/lib/experiments/htmlModifier';
import type { VariantModification } from '@/lib/experiments/types';
import { fetchWithSsrfGuard } from '@/lib/phase2/findings/preview';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 900;
const SCREENSHOT_TIMEOUT_MS = 15_000;

export interface BeforeAfterRenderResult {
  beforeUrl: string;
  afterUrl: string;
  /** Raw PNG of the before render — handed to Tier 2 when Tier 1 declines. */
  beforeBuffer: Buffer;
}

/**
 * Renders before + after. Returns `null` when any step fails or when the
 * mods produce a byte-identical output (no-op apply — the prospect would
 * see "before" twice).
 */
export async function renderBeforeAfter(args: {
  findingId: string;
  originUrl: string;
  modifications: VariantModification[];
  /**
   * `enforceSsrfGuard=false` matches the lighthouse-slug bypass in
   * `buildAnnotatedFindingHtml`; production audits always pass `true`.
   */
  enforceSsrfGuard?: boolean;
}): Promise<BeforeAfterRenderResult | null> {
  const browserlessKey = process.env.BROWSERLESS_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!browserlessKey || !blobToken) return null;
  if (args.modifications.length === 0) return null;

  const enforce = args.enforceSsrfGuard !== false;
  const fetched = await fetchWithSsrfGuard(args.originUrl, enforce);
  if (!fetched.ok) {
    console.warn('[renderBeforeAfter] origin fetch failed', {
      findingId: args.findingId,
      url: args.originUrl,
      message: fetched.message,
    });
    return null;
  }

  const beforeHtmlRaw = fetched.html;
  const afterHtmlRaw = applyModifications(beforeHtmlRaw, args.modifications);
  if (afterHtmlRaw === beforeHtmlRaw) {
    // No mod resolved — the "after" would be identical to the "before".
    // Decline Tier 1 so the orchestrator can try Tier 2 (vision inpaint).
    return null;
  }

  const beforeHtml = stripScripts(beforeHtmlRaw);
  const afterHtml = stripScripts(afterHtmlRaw);

  const pair = await screenshotPair({
    browserlessKey,
    beforeHtml,
    afterHtml,
    baseUrl: args.originUrl,
  });
  if (!pair) return null;

  let beforeUrl: string;
  let afterUrl: string;
  try {
    const stamp = Date.now();
    const [beforeUpload, afterUpload] = await Promise.all([
      put(`fix-preview/${args.findingId}/${stamp}-before.png`, pair.beforeBuffer, {
        access: 'public',
        token: blobToken,
      }),
      put(`fix-preview/${args.findingId}/${stamp}-after.png`, pair.afterBuffer, {
        access: 'public',
        token: blobToken,
      }),
    ]);
    beforeUrl = beforeUpload.url;
    afterUrl = afterUpload.url;
  } catch (err) {
    console.warn('[renderBeforeAfter] blob upload failed', {
      findingId: args.findingId,
      error: String(err),
    });
    return null;
  }

  return { beforeUrl, afterUrl, beforeBuffer: pair.beforeBuffer };
}

/**
 * Open one Browserless connection, screenshot two HTML payloads, close.
 * Errors return `null` so the caller can degrade. Extracted so a test
 * can stub it without faking the Blob layer.
 */
async function screenshotPair(args: {
  browserlessKey: string;
  beforeHtml: string;
  afterHtml: string;
  baseUrl: string;
}): Promise<{ beforeBuffer: Buffer; afterBuffer: Buffer } | null> {
  let beforeBuffer: Buffer | null = null;
  let afterBuffer: Buffer | null = null;
  try {
    const { chromium } = await import('playwright-core');
    const wssUrl = `wss://chrome.browserless.io?token=${encodeURIComponent(args.browserlessKey)}`;
    const browser = await chromium.connectOverCDP(wssUrl);
    try {
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      });
      try {
        // Run the two renders in parallel — same context, two pages. Browserless
        // bills by connection time, not by page count, so this is essentially
        // free vs. a sequential render.
        const [beforeRaw, afterRaw] = await Promise.all([
          renderOne(context, args.beforeHtml),
          renderOne(context, args.afterHtml),
        ]);
        beforeBuffer = Buffer.from(beforeRaw);
        afterBuffer = Buffer.from(afterRaw);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.warn('[renderBeforeAfter] browserless failed', { error: String(err) });
    return null;
  }
  if (!beforeBuffer || !afterBuffer) return null;
  return { beforeBuffer, afterBuffer };
}

async function renderOne(
  context: import('playwright-core').BrowserContext,
  html: string,
): Promise<Uint8Array> {
  const page = await context.newPage();
  await page.setContent(html, {
    waitUntil: 'networkidle',
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
  return page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
  });
}

/**
 * Tier 1 also needs to produce a *before-only* render when Tier 2 takes
 * over (vision inpaint needs the same before image). Exported separately
 * so the orchestrator can call it without committing to a pair render.
 */
export async function renderBeforeOnly(args: {
  findingId: string;
  originUrl: string;
  enforceSsrfGuard?: boolean;
}): Promise<{ beforeUrl: string; beforeBuffer: Buffer } | null> {
  const browserlessKey = process.env.BROWSERLESS_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!browserlessKey || !blobToken) return null;

  const enforce = args.enforceSsrfGuard !== false;
  const fetched = await fetchWithSsrfGuard(args.originUrl, enforce);
  if (!fetched.ok) return null;
  const html = stripScripts(fetched.html);

  let buffer: Buffer | null = null;
  try {
    const { chromium } = await import('playwright-core');
    const wssUrl = `wss://chrome.browserless.io?token=${encodeURIComponent(browserlessKey)}`;
    const browser = await chromium.connectOverCDP(wssUrl);
    try {
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      });
      try {
        const page = await context.newPage();
        await page.setContent(html, {
          waitUntil: 'networkidle',
          timeout: SCREENSHOT_TIMEOUT_MS,
        });
        const raw = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
        });
        buffer = Buffer.from(raw);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.warn('[renderBeforeOnly] browserless failed', { error: String(err) });
    return null;
  }
  if (!buffer) return null;

  try {
    const filename = `fix-preview/${args.findingId}/${Date.now()}-before.png`;
    const result = await put(filename, buffer, { access: 'public', token: blobToken });
    return { beforeUrl: result.url, beforeBuffer: buffer };
  } catch (err) {
    console.warn('[renderBeforeOnly] blob upload failed', { error: String(err) });
    return null;
  }
}

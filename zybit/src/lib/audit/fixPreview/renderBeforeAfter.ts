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
 *      finding-preview route. Orchestrator may pass already-fetched HTML
 *      to avoid a double-fetch when the before render ran first.
 *   2. Apply mods with `applyModifications` → `afterHtml`. If the apply is
 *      a no-op (mods all failed to resolve), return null so the caller can
 *      fall through to Tier 2.
 *   3. Strip scripts from both HTML payloads. The annotated-finding screenshot
 *      already does this for XSS hardening; the same hardening applies here
 *      and also avoids the "page hydrates and lays out differently in
 *      Browserless than the user's browser" class of flakiness.
 *   4. Open one Browserless connection. For each page: `page.route()` swaps
 *      ONLY the main-document response with our mutated HTML, then
 *      `page.goto(originUrl)` so all other requests (CSS, fonts, images,
 *      third-party assets) hit the real origin and the variant hydrates
 *      with real styles. This mirrors the experiment proxy's runtime model
 *      and avoids the `setContent` "no base href" trap that produces
 *      unstyled output.
 *   5. Upload both PNGs to Vercel Blob (public — these are screenshots of
 *      the customer's own page, no secrets).
 *
 * Fail-soft at every step: missing env, fetch failure, no-op apply,
 * Browserless error, Blob error all return `null` and the orchestrator
 * advances to Tier 2.
 */

import { put } from '@vercel/blob';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { applyModifications, stripScripts } from '@/lib/experiments/htmlModifier';
import type { VariantModification } from '@/lib/experiments/types';
import { fetchWithSsrfGuard } from '@/lib/phase2/findings/preview';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 900;
const SCREENSHOT_TIMEOUT_MS = 25_000;
// Cap the WebSocket handshake to Browserless. Without this, a slow/dead
// endpoint hangs the per-finding render — and the orchestrator's
// sequential loop hangs the whole audit run for its full `maxDuration`.
const CDP_CONNECT_TIMEOUT_MS = 15_000;
// `networkidle` hangs on real marketing pages with persistent analytics /
// chat sockets. `load` fires after DOMContentLoaded + onload; settle for
// late-arriving fonts + JS-rendered hero blocks. 3.5 s catches the
// React-hydrated marketing pages whose hero paints 2–4 s after onload —
// shorter waits produced fully-white "below the fold" screenshots on
// real sites.
const POST_LOAD_SETTLE_MS = 3500;
// On blank-frame detection retry once with a longer settle before giving up.
const POST_LOAD_SETTLE_RETRY_MS = 6000;

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
 *
 * When `prefetchedHtml` is provided the SSRF-guarded fetch is skipped —
 * the orchestrator renders the before first (to feed the advisor's vision
 * channel) and re-uses the same HTML for the after pass.
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
  /** Reuse HTML the orchestrator already fetched via `renderBeforeOnly`. */
  prefetchedHtml?: string;
}): Promise<BeforeAfterRenderResult | null> {
  const browserlessKey = process.env.BROWSERLESS_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!browserlessKey || !blobToken) return null;
  if (args.modifications.length === 0) return null;

  let beforeHtmlRaw: string;
  if (typeof args.prefetchedHtml === 'string' && args.prefetchedHtml.length > 0) {
    beforeHtmlRaw = args.prefetchedHtml;
  } else {
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
    beforeHtmlRaw = fetched.html;
  }

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
    originUrl: args.originUrl,
  });
  if (!pair) return null;

  // Defence in depth — if both the long retry inside renderOne and the
  // page settled, but the screenshot is still blank, refuse the pair so
  // we don't email a white image. Caller falls to Tier 2 / Tier 3.
  if (isLikelyBlankFrame(pair.beforeBuffer) || isLikelyBlankFrame(pair.afterBuffer)) {
    console.warn('[renderBeforeAfter] blank frame after retry — declining tier 1', {
      findingId: args.findingId,
    });
    return null;
  }

  // Route() interception produces a real styled render on both legs, so a
  // mod that targets a non-existent selector no longer betrays itself as a
  // wall of unstyled HTML — it renders identically to the before. Bail to
  // Tier 2 when the after PNG is perceptually indistinguishable from the
  // before; the orchestrator's vision inpaint always produces *something*
  // visibly different.
  if (!isVisiblyChanged(pair.beforeBuffer, pair.afterBuffer)) {
    console.warn('[renderBeforeAfter] tier 1 render looks identical — mods did not visibly resolve', {
      findingId: args.findingId,
    });
    return null;
  }

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
  originUrl: string;
}): Promise<{ beforeBuffer: Buffer; afterBuffer: Buffer } | null> {
  let beforeBuffer: Buffer | null = null;
  let afterBuffer: Buffer | null = null;
  try {
    const { chromium } = await import('playwright-core');
    const wssUrl = `wss://chrome.browserless.io?token=${encodeURIComponent(args.browserlessKey)}`;
    const browser = await chromium.connectOverCDP(wssUrl, {
      timeout: CDP_CONNECT_TIMEOUT_MS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
        ignoreHTTPSErrors: true,
        userAgent: DESKTOP_UA,
      });
      try {
        // Run the two renders in parallel — same context, two pages. Browserless
        // bills by connection time, not by page count, so this is essentially
        // free vs. a sequential render.
        const [beforeRaw, afterRaw] = await Promise.all([
          renderOne(context, args.originUrl, args.beforeHtml),
          renderOne(context, args.originUrl, args.afterHtml),
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

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Perceptual diff between the before and after PNGs. Returns `true` when
 * the two screenshots are visibly different — the mod actually moved
 * pixels. Returns `false` when they look the same (e.g. an `attribute-set`
 * mod targeting a selector that doesn't exist; an `element-insert` whose
 * anchor resolves but whose payload is hidden by existing CSS).
 *
 * - `threshold: 0.1` ignores JPEG-style colour noise and anti-aliasing.
 * - `> 1 000 changed pixels` (≈ 0.09 % of a 1280×900 frame) filters
 *   sub-pixel render jitter from font hinting / Browserless connection
 *   variance AND the "172 px ghost" case where a CSS injection wins the
 *   DOM but the host's more-specific rules immediately override it in the
 *   live stylesheet (so the render looks identical to a human, but a
 *   handful of antialiasing pixels differ). Real visible changes — even
 *   a single small button restyled — produce ≥ 5 000 px of diff.
 * - Different dimensions → treat as changed (rare, but safer to surface
 *   than to swallow).
 * - PNG parse errors → treat as changed (don't let Tier 1 silently bail
 *   on corrupt input we still uploaded successfully).
 */
export const PIXEL_DIFF_THRESHOLD = 1_000;

/**
 * Cheap blank-frame check. Samples every Nth pixel of a decoded PNG and
 * returns true when ≥ 99.5% of samples are near-white. Catches the
 * "Browserless screenshot fired before the hero painted" case where
 * the user sees a fully blank Before image in the email.
 *
 * Sampling stride keeps the cost low (~12 KB of work on a 1280×900 frame).
 */
export function isLikelyBlankFrame(buffer: Buffer): boolean {
  let img: PNG;
  try {
    img = PNG.sync.read(buffer);
  } catch {
    return false;
  }
  const data = img.data;
  const totalPixels = img.width * img.height;
  const stride = Math.max(1, Math.floor(totalPixels / 4000));
  let sampled = 0;
  let nearWhite = 0;
  for (let i = 0; i < totalPixels; i += stride) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    // ≥ 245 on all channels = "white-ish" (catches anti-aliased page bg
    // and very light gray Tailwind backgrounds).
    if (r >= 245 && g >= 245 && b >= 245) nearWhite += 1;
    sampled += 1;
  }
  if (sampled === 0) return false;
  return nearWhite / sampled >= 0.995;
}

export function isVisiblyChanged(before: Buffer, after: Buffer): boolean {
  let img1: PNG;
  let img2: PNG;
  try {
    img1 = PNG.sync.read(before);
    img2 = PNG.sync.read(after);
  } catch {
    return true;
  }
  if (img1.width !== img2.width || img1.height !== img2.height) return true;
  // Pass undefined for the diff buffer — we only need the changed-pixel count,
  // not a diff image. Skips allocating ~4.6 MB per comparison (1280×900×4 bytes).
  const changed = pixelmatch(img1.data, img2.data, undefined, img1.width, img1.height, {
    threshold: 0.1,
  });
  return changed > PIXEL_DIFF_THRESHOLD;
}

/**
 * Navigate to the live URL, but swap the main-document response with our
 * mutated HTML. Every other request (CSS, fonts, images, third-party
 * assets) passes through to the real origin so the variant hydrates with
 * the site's real styles. Mirrors the experiment-proxy runtime model.
 *
 * Why not `setContent`: `setContent` does NOT navigate, so the page has
 * no document URL and every relative `<link href="/styles.css">` or
 * relative font URL 404s — the screenshot is then a wall of unstyled
 * raw HTML.
 */
async function renderOne(
  context: import('playwright-core').BrowserContext,
  originUrl: string,
  html: string,
): Promise<Uint8Array> {
  const target = new URL(originUrl);
  const page = await context.newPage();
  try {
    await page.route('**/*', async (route) => {
      const req = route.request();
      let reqUrl: URL;
      try {
        reqUrl = new URL(req.url());
      } catch {
        await route.continue();
        return;
      }
      if (
        req.resourceType() === 'document' &&
        reqUrl.host === target.host &&
        reqUrl.pathname === target.pathname &&
        reqUrl.search === target.search
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: html,
        });
        return;
      }
      await route.continue();
    });
    await page.goto(originUrl, {
      waitUntil: 'load',
      timeout: SCREENSHOT_TIMEOUT_MS,
    });
    await page.waitForTimeout(POST_LOAD_SETTLE_MS);
    let shot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
    });
    if (isLikelyBlankFrame(Buffer.from(shot))) {
      // Hero hasn't painted yet — wait longer and re-shoot once. If still
      // blank we surface the blank frame and let upstream callers decide
      // whether to skip the preview.
      await page.waitForTimeout(POST_LOAD_SETTLE_RETRY_MS);
      shot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
      });
    }
    return shot;
  } finally {
    await page.close().catch(() => {});
  }
}

export interface BeforeOnlyRenderResult {
  beforeUrl: string;
  beforeBuffer: Buffer;
  /**
   * The fetched origin HTML (pre-`stripScripts`). The orchestrator hands
   * this back to `renderBeforeAfter` to skip the second SSRF fetch.
   */
  fetchedHtml: string;
}

/**
 * Tier 1 also needs to produce a *before-only* render — both as Tier 2's
 * input image and as the screenshot we feed to the Tier 1 advisor's
 * vision channel. Exported separately so the orchestrator can call it
 * without committing to a pair render.
 *
 * Returns the fetched HTML so the orchestrator can pass it to
 * `renderBeforeAfter` and avoid a double-fetch.
 */
export async function renderBeforeOnly(args: {
  findingId: string;
  originUrl: string;
  enforceSsrfGuard?: boolean;
}): Promise<BeforeOnlyRenderResult | null> {
  const browserlessKey = process.env.BROWSERLESS_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!browserlessKey || !blobToken) return null;

  const enforce = args.enforceSsrfGuard !== false;
  const fetched = await fetchWithSsrfGuard(args.originUrl, enforce);
  if (!fetched.ok) return null;
  const fetchedHtml = fetched.html;
  const html = stripScripts(fetchedHtml);

  let buffer: Buffer | null = null;
  try {
    const { chromium } = await import('playwright-core');
    const wssUrl = `wss://chrome.browserless.io?token=${encodeURIComponent(browserlessKey)}`;
    const browser = await chromium.connectOverCDP(wssUrl, {
      timeout: CDP_CONNECT_TIMEOUT_MS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
        ignoreHTTPSErrors: true,
        userAgent: DESKTOP_UA,
      });
      try {
        const raw = await renderOne(context, args.originUrl, html);
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
  if (isLikelyBlankFrame(buffer)) {
    console.warn('[renderBeforeOnly] blank frame after retry — declining', {
      findingId: args.findingId,
    });
    return null;
  }

  try {
    const filename = `fix-preview/${args.findingId}/${Date.now()}-before.png`;
    const result = await put(filename, buffer, { access: 'public', token: blobToken });
    return { beforeUrl: result.url, beforeBuffer: buffer, fetchedHtml };
  } catch (err) {
    console.warn('[renderBeforeOnly] blob upload failed', { error: String(err) });
    return null;
  }
}

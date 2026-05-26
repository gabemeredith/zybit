/**
 * Above-fold-only screenshot for the vision-signals capture.
 *
 * `visionPass.ts`'s `captureAuditScreenshot` also uploads to Vercel Blob
 * (the URL is embedded in the report email). This helper just returns a
 * Buffer — used by the runner's per-page vision pass where blob storage
 * is irrelevant. Sharing the same connector + viewport + settle pattern
 * so the model sees what we'd embed in the email.
 *
 * Returns null on any failure (no Browserless creds, connection error,
 * timeout). The caller treats null as "no vision signals for this page"
 * and proceeds with structural-only snapshot data.
 */

import { connectBrowserless } from '@/lib/phase2/capture/browser';

const VIEWPORT_W = 1440;
const VIEWPORT_H = 900;

export async function captureAboveFoldBuffer(url: string): Promise<Buffer | null> {
  const browserlessKey = process.env.BROWSERLESS_KEY;
  if (!browserlessKey) return null;

  let browser: Awaited<ReturnType<typeof connectBrowserless>> | null = null;
  try {
    browser = await connectBrowserless();
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    // Brief settle for animations / lazy-loaded hero images
    await page.waitForTimeout(1500);
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 82,
      clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
    });
    await context.close();
    return Buffer.from(buffer);
  } catch (err) {
    console.warn('[captureAboveFoldBuffer] failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

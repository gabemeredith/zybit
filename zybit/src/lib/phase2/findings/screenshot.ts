/**
 * Slice 2 — render an annotated screenshot for a finding.
 *
 * 1. Build annotated HTML via the shared `buildAnnotatedFindingHtml` helper.
 * 2. Send to Browserless (Playwright over CDP), `setContent` the HTML so the
 *    Browserless instance never has to reach the customer origin, screenshot.
 * 3. Upload PNG to Vercel Blob (public access; screenshots are non-secret —
 *    they're already what the customer's site renders).
 * 4. Persist the Blob URL + capture timestamp on the finding row.
 *
 * Returns null on any failure (missing env, Browserless error, Blob error).
 * The UI falls back to the live iframe modal in that case.
 */

import { eq, and } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { buildAnnotatedFindingHtml } from '@/lib/phase2/findings/preview';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 900;
const SCREENSHOT_TIMEOUT_MS = 15_000;

export interface RenderFindingScreenshotResult {
  screenshotUrl: string;
  annotationsCount: number;
  capturedAt: Date;
}

export async function renderFindingScreenshot(
  findingId: string,
  organizationId: string,
): Promise<RenderFindingScreenshotResult | null> {
  const browserlessKey = process.env.BROWSERLESS_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!browserlessKey || !blobToken) return null;

  const built = await buildAnnotatedFindingHtml(findingId, organizationId);
  if (!built.ok) return null;

  let buffer: Buffer | null = null;
  try {
    const { chromium } = await import('playwright-core');
    const wssUrl = `wss://chrome.browserless.io?token=${encodeURIComponent(browserlessKey)}`;
    const browser = await chromium.connectOverCDP(wssUrl);
    try {
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      });
      const page = await context.newPage();
      await page.setContent(built.html, {
        waitUntil: 'networkidle',
        timeout: SCREENSHOT_TIMEOUT_MS,
      });
      const raw = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
      });
      buffer = Buffer.from(raw);
      await context.close();
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.warn('[renderFindingScreenshot] browserless failed', {
      findingId,
      error: String(err),
    });
    return null;
  }

  if (!buffer) return null;

  let blobUrl: string;
  try {
    const filename = `finding-screenshots/${findingId}/${Date.now()}.png`;
    const result = await put(filename, buffer, { access: 'public', token: blobToken });
    blobUrl = result.url;
  } catch (err) {
    console.warn('[renderFindingScreenshot] blob upload failed', {
      findingId,
      error: String(err),
    });
    return null;
  }

  const capturedAt = new Date();
  try {
    const db = getDb();
    await db
      .update(zybitFindings)
      .set({ screenshotUrl: blobUrl, screenshotCapturedAt: capturedAt, updatedAt: capturedAt })
      .where(
        and(
          eq(zybitFindings.id, findingId),
          eq(zybitFindings.organizationId, organizationId),
        ),
      );
  } catch (err) {
    // Persistence failed but the PNG is uploaded. Log and surface the URL
    // anyway — the next view will regenerate but at least this view sees it.
    console.warn('[renderFindingScreenshot] persist failed', {
      findingId,
      error: String(err),
    });
  }

  return { screenshotUrl: blobUrl, annotationsCount: built.annotationsCount, capturedAt };
}

/**
 * Full-page screenshot → Vercel Blob upload.
 *
 * Non-fatal: if BLOB_READ_WRITE_TOKEN is absent (local dev) or upload
 * fails, returns null. The capture artifact is still complete and usable
 * by rules — screenshots are for dashboard preview, not analysis.
 *
 * Failure modes are now logged via the structured logger so the silent
 * `screenshot_url=null` we saw on the stripe.com and linear.app captures
 * (PR #84 Known Bug #2) shows up in Axiom under
 * `service: 'capture-record'` instead of disappearing into the catch.
 */

import { put } from '@vercel/blob';
import type { Page } from 'playwright-core';
import { logger } from '@/lib/observability';
import type { CaptureBreakpoint } from './types';

export async function captureScreenshot(
  page: Page,
  siteId: string,
  pathRef: string,
  breakpoint: CaptureBreakpoint,
  runId: string,
): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    logger.warn('capture.screenshot.skipped', {
      service: 'capture-record',
      reason: 'no_blob_token',
      siteId,
      pathRef,
      breakpoint,
      runId,
    });
    return null;
  }

  try {
    const buffer = await page.screenshot({ type: 'png', fullPage: true, timeout: 10_000 });
    const safePathRef = pathRef.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_');
    const filename = `captures/${siteId}/${safePathRef}/${breakpoint}/${runId}.png`;
    // `access: 'public'` — the project's Blob store is a public store, so
    // `'private'` throws "Cannot use private access on a public store" and the
    // upload ALWAYS failed (QA finding: design screenshots never persisted).
    // Public matches the only other Blob writer (`visionPass.ts`); these are
    // dashboard-preview artifacts (see file header), not analysis inputs, and
    // the blob path carries an unguessable runId.
    const { url } = await put(filename, buffer, { access: 'public', token });
    return url;
  } catch (err) {
    logger.warn('capture.screenshot.failed', {
      service: 'capture-record',
      siteId,
      pathRef,
      breakpoint,
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

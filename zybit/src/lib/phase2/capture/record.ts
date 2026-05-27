/**
 * Page capture orchestrator.
 *
 * Opens one Browserless browser, creates one context per breakpoint
 * (correct viewport + UA from the first byte), extracts the full
 * PageCapture artifact, and returns all successful captures.
 *
 * Design principles:
 *   - parser.ts runs on rendered HTML → gives us stable `ref` hashes.
 *   - styles.ts runs in the browser → gives us real bboxes and colors.
 *   - Merging by document index (both use the same filter ordering).
 *   - Cost estimated from wall-clock time; stored in every capture row.
 *   - Budget check is the caller's responsibility (API route / cron).
 */

import { randomUUID } from 'node:crypto';

import type { Browser, BrowserContext } from 'playwright-core';

import { parseSnapshot } from '@/lib/phase2/snapshots/parser';
import type {
  CtaCandidate,
  FormCandidate,
  HeadingItem,
  PageSnapshotMeta,
} from '@/lib/phase2/snapshots/types';
import { logger } from '@/lib/observability';

import { connectBrowserless, globalBrowserSemaphore } from './browser';
import { extractRenderedHtml } from './dom';
import { createErrorLog } from './errors';
import { extractLayout } from './layout';
import { extractMetrics } from './metrics';
import { createNetworkLog } from './network';
import { captureScreenshot } from './screenshots';
import { extractMeasurements } from './styles';
import type {
  CaptureBreakpoint,
  CaptureCohort,
  CaptureOptions,
  CaptureRunSummary,
  CtaCandidateMeasured,
  FormCandidateMeasured,
  FormInputItemMeasured,
  HeadingItemMeasured,
  PageCapture,
  PageCaptureMeta,
} from './types';
import type { CtaMeasurement, FormMeasurement, HeadingMeasurement } from './styles';
import {
  BREAKPOINT_VIEWPORTS,
  CAPTURE_USER_AGENTS,
  CaptureError,
  estimateCostUsd,
} from './types';

// ---------------------------------------------------------------------------
// Merge helpers: parsed data + browser measurements → *Measured types
// ---------------------------------------------------------------------------

function mergeHeadings(
  parsed: HeadingItem[],
  measurements: HeadingMeasurement[],
): HeadingItemMeasured[] {
  return parsed.map((h, i) => {
    const m = measurements[i];
    return { ...h, bbox: m?.bbox ?? null, fontSizePx: m?.fontSizePx ?? null, colorHex: m?.colorHex ?? null };
  });
}

function mergeCtasMeasured(
  parsed: CtaCandidate[],
  measurements: CtaMeasurement[],
): CtaCandidateMeasured[] {
  return parsed.map((cta, i) => {
    const m = measurements[i];
    return { ...cta, bbox: m?.bbox ?? null, bgColorHex: m?.bgColorHex ?? null, fgColorHex: m?.fgColorHex ?? null };
  });
}

function mergeFormsMeasured(
  parsed: FormCandidate[],
  measurements: FormMeasurement[],
): FormCandidateMeasured[] {
  return parsed.map((form, i) => {
    const fm = measurements[i];
    const measuredInputs: FormInputItemMeasured[] = form.inputs.map((inp, j) => {
      const im = fm?.inputMeasurements[j];
      return { ...inp, bbox: im?.bbox ?? null, labelProximityPx: im?.labelProximityPx ?? null };
    });
    return {
      ref: form.ref,
      cssSelector: form.cssSelector,
      landmark: form.landmark,
      fieldCount: form.fieldCount,
      documentIndex: form.documentIndex,
      hasSubmitButton: form.hasSubmitButton,
      bbox: fm?.bbox ?? null,
      inputs: measuredInputs,
    };
  });
}

function toMeta(meta: PageSnapshotMeta): PageCaptureMeta {
  return {
    title: meta.title,
    ogTitle: meta.ogTitle,
    ogDescription: meta.ogDescription,
    ogImage: meta.ogImage,
    description: meta.description,
    canonical: meta.canonical,
    lang: meta.lang,
    viewport: meta.viewport,
  };
}

// ---------------------------------------------------------------------------
// Single-page, single-breakpoint capture
// ---------------------------------------------------------------------------

interface SingleCaptureOpts {
  url: string;
  pathRef: string;
  siteId: string;
  breakpoint: CaptureBreakpoint;
  cohort: string;
  storageState?: string | null;
  runId: string;
  pageTimeoutMs: number;
}

async function captureOnePage(
  browser: Browser,
  opts: SingleCaptureOpts,
): Promise<PageCapture> {
  const startMs = Date.now();
  let context: BrowserContext | null = null;

  try {
    const viewport = BREAKPOINT_VIEWPORTS[opts.breakpoint];
    const userAgent = CAPTURE_USER_AGENTS[opts.breakpoint];
    const storageState = opts.storageState ? JSON.parse(opts.storageState) : undefined;

    context = await browser.newContext({
      viewport,
      userAgent,
      ...(storageState ? { storageState } : {}),
    });

    const page = await context.newPage();

    // Wire up listeners before navigation
    const siteHostname = (() => {
      try { return new URL(opts.url).hostname; } catch { return ''; }
    })();
    const networkLog = createNetworkLog(page, siteHostname);
    const errorLog = createErrorLog(page);

    // Navigate — use domcontentloaded for speed, then best-effort networkidle
    await page.goto(opts.url, {
      timeout: opts.pageTimeoutMs,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    // Wait for JS hydration to settle
    await page.waitForTimeout(2_000);

    const finalUrl = page.url();

    // Extract rendered HTML and parse it (gives stable ref hashes)
    const { html: renderedHtml, byteSize } = await extractRenderedHtml(page);
    const parsedData = await parseSnapshot({ html: renderedHtml, finalUrl, rawByteSize: byteSize });

    // Extract measurements from the live browser DOM
    const [measurements, foldData, metricsData] = await Promise.all([
      extractMeasurements(page),
      extractLayout(page),
      extractMetrics(page), // waits ~800 ms internally
    ]);

    // Screenshot → Blob (non-fatal)
    const screenshotUrl = await captureScreenshot(
      page,
      opts.siteId,
      opts.pathRef,
      opts.breakpoint,
      opts.runId,
    );

    const networkSummary = networkLog.summarize();
    networkLog.cleanup();
    errorLog.cleanup();

    const durationMs = Date.now() - startMs;
    const costUsd = estimateCostUsd(durationMs);

    const capture: PageCapture = {
      schemaVersion: 1,
      siteId: opts.siteId,
      pathRef: opts.pathRef,
      finalUrl,
      capturedAt: new Date().toISOString(),
      breakpoint: opts.breakpoint,
      cohort: opts.cohort,
      contentHash: parsedData.contentHash,
      renderedHtml,
      meta: toMeta(parsedData.meta),
      headings: mergeHeadings(parsedData.headings, measurements.headings),
      ctas: mergeCtasMeasured(parsedData.ctas, measurements.ctas),
      forms: mergeFormsMeasured(parsedData.forms, measurements.forms),
      fold: foldData,
      metrics: metricsData,
      network: networkSummary,
      errors: errorLog.getErrors(),
      consoleMessages: errorLog.getConsoleMessages(),
      assets: { screenshotBlobUrl: screenshotUrl, harBlobUrl: null },
      costUsd,
    };

    logger.info('capture.page.done', {
      service: 'capture-record',
      siteId: opts.siteId,
      runId: opts.runId,
      pathRef: opts.pathRef,
      breakpoint: opts.breakpoint,
      latencyMs: durationMs,
      costUsd,
    });

    return capture;
  } catch (err) {
    logger.error('capture.page.failed', {
      service: 'capture-record',
      siteId: opts.siteId,
      runId: opts.runId,
      pathRef: opts.pathRef,
      breakpoint: opts.breakpoint,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw new CaptureError(
      'PAGE_CAPTURE_FAILED',
      err instanceof Error ? err.message : 'page capture failed',
      err,
    );
  } finally {
    await context?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Multi-breakpoint entry point (public surface)
// ---------------------------------------------------------------------------

const PAGE_TIMEOUT_MS = 25_000;

/**
 * Capture one URL across all requested breakpoints.
 *
 * Opens a single Browserless browser, loops over breakpoints (each gets its
 * own context for proper viewport/UA isolation), returns all successful
 * captures. If every breakpoint fails, throws CaptureError.
 */
export async function capturePageAllBreakpoints(
  opts: CaptureOptions,
): Promise<CaptureRunSummary> {
  const runStart = Date.now();
  const runId = opts.runId ?? randomUUID();
  const breakpoints: CaptureBreakpoint[] = opts.breakpoints ?? ['mobile', 'tablet', 'desktop'];
  const cohort: CaptureCohort = opts.cohort ?? 'all';

  await globalBrowserSemaphore.acquire();
  let browser: Browser | null = null;

  try {
    browser = await connectBrowserless();

    const failedBreakpoints: CaptureBreakpoint[] = [];

    // Capture all breakpoints in parallel — each gets its own browser context
    // so viewport/UA isolation is preserved. The global semaphore (acquired above)
    // already bounds total concurrency at the URL level.
    const results = await Promise.all(
      breakpoints.map(async (breakpoint) => {
        try {
          return await captureOnePage(browser!, {
            url: opts.url,
            pathRef: opts.pathRef,
            siteId: opts.siteId,
            breakpoint,
            cohort,
            storageState: opts.storageState,
            runId,
            pageTimeoutMs: PAGE_TIMEOUT_MS,
          });
        } catch {
          failedBreakpoints.push(breakpoint);
          return null;
        }
      }),
    );

    const captures = results.filter((c): c is PageCapture => c !== null);

    if (captures.length === 0) {
      throw new CaptureError(
        'ALL_BREAKPOINTS_FAILED',
        `All ${breakpoints.length} breakpoints failed for ${opts.url}`,
      );
    }

    const totalCostUsd = captures.reduce((sum, c) => sum + c.costUsd, 0);
    const durationMs = Date.now() - runStart;

    return { runId, siteId: opts.siteId, captures, failedBreakpoints, totalCostUsd, durationMs };
  } finally {
    await browser?.close().catch(() => {});
    globalBrowserSemaphore.release();
  }
}

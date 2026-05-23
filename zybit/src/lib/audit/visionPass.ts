/**
 * Vision pass for the public audit pipeline.
 *
 * Two independent steps, both non-fatal:
 *   1. captureAuditScreenshot — above-fold desktop screenshot via Browserless,
 *      uploaded to Vercel Blob (public access so email clients can load it).
 *   2. runVisionPass — sends the JPEG buffer to Gemini 2.0 Flash via the
 *      Generative Language REST API and returns a short visual observation
 *      that enriches the top finding in the email.
 *
 * Both return null if the required env vars are absent or if anything fails.
 * The pipeline never waits for these to retry — they are best-effort.
 *
 * The Gemini call mirrors `src/lib/experiments/aiAdvisor.ts`: same model
 * (`gemini-2.0-flash`), same key location (`x-goog-api-key` header so the
 * key never lands in access logs), same REST endpoint.
 */

import { connectBrowserless } from '@/lib/phase2/capture/browser';
import { put } from '@vercel/blob';

export interface ScreenshotResult {
  screenshotUrl: string;
  buffer: Buffer;
}

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const VIEWPORT_W = 1440;
const VIEWPORT_H = 900;

export async function captureAuditScreenshot(url: string): Promise<ScreenshotResult | null> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
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

    if (!blobToken) {
      // No blob storage configured — return the buffer so vision can still
      // run, but with no public URL the email skips the embed.
      return { screenshotUrl: '', buffer: Buffer.from(buffer) };
    }

    const domain = new URL(url).hostname.replace(/^www\./, '');
    const safeTimestamp = Date.now();
    const filename = `audit-screenshots/${domain}/${safeTimestamp}.jpg`;
    const { url: blobUrl } = await put(filename, buffer, { access: 'public', token: blobToken });

    return { screenshotUrl: blobUrl, buffer: Buffer.from(buffer) };
  } catch (err) {
    console.warn('[visionPass] Screenshot failed', { url, error: String(err) });
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

interface VisionFindingHint {
  title: string;
  whatToChange: string;
}

function buildVisionPrompt(domain: string, finding: VisionFindingHint | null): string {
  const findingSection = finding
    ? `Our audit identified this issue: "${finding.title}". The recommended fix is: "${finding.whatToChange}".`
    : 'Our audit scanned this page for conversion friction.';

  return (
    `This is the above-the-fold view of ${domain}'s homepage at 1440px wide desktop. ` +
    findingSection +
    ' Look at what is literally visible in this screenshot. ' +
    'In exactly 2 sentences, describe the specific visual elements you can see that relate to this finding — ' +
    'name actual elements (buttons, headings, images) and their position on screen. ' +
    'Do not speculate about what might be below the fold. Be concrete and specific.'
  );
}

export async function runVisionPass(
  domain: string,
  buffer: Buffer,
  topFinding: VisionFindingHint | null,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const base64 = buffer.toString('base64');
    const prompt = buildVisionPrompt(domain, topFinding);

    const resp = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Key in header (not URL) so it never lands in Vercel access logs.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 220, temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      console.warn('[visionPass] Gemini API error', { status: resp.status });
      return null;
    }

    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const observation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!observation) return null;

    // Truncate to 400 chars to keep the email clean
    return observation.length > 400 ? observation.slice(0, 397) + '...' : observation;
  } catch (err) {
    console.warn('[visionPass] Vision pass failed', { error: String(err) });
    return null;
  }
}

/**
 * Live end-to-end verification of the audit fix-preview pipeline.
 *
 *   npx tsx scripts/live-fix-preview.ts <url> [<url> ...]
 *
 * What it exercises against the REAL Gemini + a local Chromium (no Browserless,
 * no Vercel Blob, no DB writes — strictly the model + render + sanitize path):
 *
 *   1. Fetch the live origin HTML (same fetcher the audit pipeline uses)
 *   2. Parse the snapshot so the rule engine has structural input
 *   3. Run a small set of structural-only audit rules to surface findings
 *   4. For each top finding:
 *        a. Call `suggestAuditFix` (gemini-3.5-flash) — Tier 1 advisor
 *        b. Apply mods via `applyModifications` on the captured HTML
 *        c. Render BOTH HTMLs (before / after) with local Chromium
 *        d. Hand the before screenshot to Nano Banana 2 (Tier 2)
 *   5. Save every PNG/JPG to /tmp/audit-live/<host>/
 *
 * Outputs an index.json next to the PNGs summarizing what fired and what each
 * tier produced. The audit pipeline itself stays untouched — this script is
 * a parallel harness that *uses* the same modules.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';

import { runSnapshot } from '../src/lib/phase2/snapshots';
import { fetchHtml } from '../src/lib/phase2/snapshots/fetcher';
import {
  suggestAuditFix,
  type AuditFixAdvisorInput,
} from '../src/lib/audit/fixPreview/auditFixAdvisor';
import {
  callInpaint,
  buildInpaintPrompt,
} from '../src/lib/audit/fixPreview/visionInpaint';
import { isVisiblyChanged } from '../src/lib/audit/fixPreview/renderBeforeAfter';
import { applyModifications } from '../src/lib/experiments/htmlModifier';
import type { VariantModification } from '../src/lib/experiments/types';

const CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const VIEWPORT = { width: 1280, height: 900 };
const OUT_ROOT = '/tmp/audit-live';

interface FindingDraft {
  ruleId: string;
  title: string;
  whatToChange: string;
  whyItWorks: string;
  experimentVariantDescription: string;
}

/**
 * Derive a small set of audit-ready finding drafts from the parsed snapshot.
 * This bypasses the full rule engine (which expects an org + DB + canonical
 * events) but emits prescriptions in the same shape the real rules produce,
 * so the advisor sees the input it would in production.
 */
function deriveFindings(snapshotData: Awaited<ReturnType<typeof runSnapshot>>['data']): FindingDraft[] {
  const findings: FindingDraft[] = [];

  // 1. Generic CTA copy. Real rule: `link-text-generic`.
  const GENERIC = /^(click here|learn more|read more|here|more|details)$/i;
  const genericCta = snapshotData.ctas.find((c) => c.text && GENERIC.test(c.text.trim()));
  if (genericCta) {
    findings.push({
      ruleId: 'link-text-generic',
      title: `Generic CTA copy: "${genericCta.text}"`,
      whatToChange:
        `Replace "${genericCta.text}" with action-led copy that names the outcome (e.g. "Get started free", "See pricing"). ` +
        `Restyle with the brand primary color so the CTA reads as a real button.`,
      whyItWorks:
        'Action-named CTAs lift CTR vs. generic phrasing because they preview the destination and ' +
        'tell the reader what happens on click — verb-first copy reduces ambiguity at the moment of intent.',
      experimentVariantDescription:
        'Action-led copy with brand-primary fill, bold weight, increased padding so the CTA dominates the hero.',
    });
  }

  // 2. Hero hierarchy / "weak above-the-fold". Real rule: `hero-hierarchy-inversion`.
  const h1 = snapshotData.headings.find((h) => h.level === 1);
  const firstCta = snapshotData.ctas[0];
  if (h1 && firstCta) {
    findings.push({
      ruleId: 'hero-hierarchy-inversion',
      title: 'Hero CTA reads as secondary',
      whatToChange:
        'Above the hero CTA, insert a quick-answer block that names the value prop in ONE sentence + ' +
        'a single supporting line, then bolden + recolor the existing CTA with the brand primary so it dominates the fold.',
      whyItWorks:
        'A clear one-sentence value statement above a dominant CTA outperforms ambiguous heroes because ' +
        'the visitor decides whether to click before scrolling. Aligning visual weight with intent reduces bounce.',
      experimentVariantDescription:
        'Insert a brand-tinted quick-answer card directly above the hero CTA, with a single bold headline + ' +
        'subhead and the existing CTA restyled to the brand primary color.',
    });
  }

  // 3. Missing meta description. Real rule: `missingMetaDescription`.
  if (!snapshotData.meta.description || snapshotData.meta.description.trim().length === 0) {
    findings.push({
      ruleId: 'missing-meta-description',
      title: 'Missing meta description on a primary page',
      whatToChange:
        'Add a 140–160 character meta description summarizing the page\'s value proposition. ' +
        'Render a banner at the top of the page noting the SEO improvement opportunity.',
      whyItWorks:
        'Pages without meta descriptions get auto-generated snippets in SERPs that under-perform ' +
        'curated copy. A clear meta description is the cheapest CTR lift on the page.',
      experimentVariantDescription:
        'Insert a yellow "SEO opportunity" banner above the hero with the suggested meta description as a quote.',
    });
  }

  return findings;
}

/**
 * Render the live URL to a PNG. Optionally rewrites the main-document
 * response body via Playwright `route()` interception — the same way
 * the production proxy serves mutated HTML to a real browser. This
 * gives us a real, styled, hydrated render for both before and after,
 * not the unstyled-SPA-shell rendered by `setContent`.
 *
 *   mutatedHtml = null  →  control render of the live URL
 *   mutatedHtml = "…"   →  variant render with that HTML served in
 *                          place of the origin response. All other
 *                          requests (CSS, fonts, images, JS) pass
 *                          through to the real origin.
 */
async function renderLiveToPng(
  ctx: BrowserContext,
  url: string,
  outPath: string,
  mutatedHtml: string | null,
): Promise<void> {
  const page = await ctx.newPage();
  try {
    if (mutatedHtml !== null) {
      const target = new URL(url);
      await page.route('**/*', async (route) => {
        const req = route.request();
        const reqUrl = new URL(req.url());
        // Replace ONLY the main HTML document for this exact pathname.
        // Everything else (CSS, JS, fonts, images, third-party scripts)
        // continues to the origin so the variant hydrates identically
        // to the control.
        if (
          req.resourceType() === 'document' &&
          reqUrl.host === target.host &&
          reqUrl.pathname === target.pathname &&
          reqUrl.search === target.search
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: mutatedHtml,
          });
          return;
        }
        await route.continue();
      });
    }
    // `networkidle` hangs on real marketing sites (persistent analytics
    // / chat sockets). `load` fires after DOMContentLoaded + onload, then
    // we settle 1.5s for late-arriving fonts + JS-rendered hero blocks.
    await page.goto(url, { waitUntil: 'load', timeout: 25_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: outPath,
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
  } finally {
    await page.close();
  }
}

interface FindingResult {
  ruleId: string;
  title: string;
  tier1: {
    advisorOk: boolean;
    droppedCount: number;
    modifications: VariantModification[];
    rationale: string | null;
    rendered: boolean;
    beforePath: string | null;
    afterPath: string | null;
  };
  tier2: {
    attempted: boolean;
    ok: boolean;
    outputPath: string | null;
    outputMime: string | null;
    bytes: number | null;
  };
}

async function processOneSite(url: string): Promise<void> {
  const host = new URL(url).host.replace(/^www\./, '');
  const outDir = path.join(OUT_ROOT, host);
  await fs.mkdir(outDir, { recursive: true });
  console.log(`\n── ${url}  →  ${outDir}`);

  // 1. Fetch + parse snapshot. Default fetcher timeout (5s) is too aggressive
  // for marketing pages with chunked transfer + redirects; widen to 20s so
  // a slow CDN doesn't fail us before the bytes land.
  const fetched = await fetchHtml(url, { respectRobots: false, timeoutMs: 20_000 });
  console.log(`  fetched ${fetched.byteSize} bytes from ${fetched.finalUrl}`);
  const snap = await runSnapshot(url, { respectRobots: false, timeoutMs: 20_000 });
  console.log(`  parsed: ${snap.data.headings.length} headings, ${snap.data.ctas.length} ctas, ${snap.data.forms.length} forms`);
  await fs.writeFile(
    path.join(outDir, 'snapshot.json'),
    JSON.stringify(
      {
        meta: snap.data.meta,
        cssSystem: snap.data.cssSystem,
        topCtas: snap.data.ctas.slice(0, 6).map((c) => ({
          text: c.text,
          tag: c.tag,
          cssSelector: c.cssSelector,
          visualWeight: c.visualWeight,
          foldGuess: c.foldGuess,
        })),
        headings: snap.data.headings.slice(0, 8),
      },
      null,
      2,
    ),
  );

  const findings = deriveFindings(snap.data);
  if (findings.length === 0) {
    console.log('  no findings derived — skipping');
    return;
  }
  console.log(`  derived ${findings.length} finding(s): ${findings.map((f) => f.ruleId).join(', ')}`);

  // 2. Browser session — reused across both renders + every finding.
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  // `ignoreHTTPSErrors` for sandbox cert quirks; UA that doesn't scream
  // automation so anti-bot middleware doesn't 403 us.
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  // Pre-render the "before" once — live navigation so styles + fonts
  // hydrate the same way the prospect sees the page. The bytes are also
  // handed to the Tier 1 advisor (vision channel) so the model can see
  // what it's editing.
  const beforePath = path.join(outDir, 'before.png');
  await renderLiveToPng(ctx, fetched.finalUrl, beforePath, null);
  const beforeBytes = await fs.readFile(beforePath);
  const beforeBase64 = beforeBytes.toString('base64');
  console.log(`  before.png saved (${beforeBytes.length} bytes, base64 ${beforeBase64.length} chars)`);

  const results: FindingResult[] = [];

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const slot = `${String(i + 1).padStart(2, '0')}-${f.ruleId}`;
    console.log(`  · [${slot}] advisor …`);

    const input: AuditFixAdvisorInput = {
      finding: {
        ruleId: f.ruleId,
        title: f.title,
        whatToChange: f.whatToChange,
        whyItWorks: f.whyItWorks,
        experimentVariantDescription: f.experimentVariantDescription,
      },
      designTokens: null,
      cssSystem: snap.data.cssSystem ?? null,
      availableSelectors: snap.data.ctas
        .map((c) => c.cssSelector)
        .filter((s): s is string => Boolean(s))
        .slice(0, 12),
      ctaVocabulary: snap.data.ctas
        .map((c) => c.text ?? '')
        .filter((t) => t.length > 0 && t.length < 40)
        .slice(0, 10),
      beforeScreenshotBase64: beforeBase64,
    };

    const suggestion = await suggestAuditFix(input);
    const tier1: FindingResult['tier1'] = {
      advisorOk: !!suggestion,
      droppedCount: suggestion?.droppedCount ?? 0,
      modifications: suggestion?.modifications ?? [],
      rationale: suggestion?.rationale ?? null,
      rendered: false,
      beforePath: beforePath,
      afterPath: null,
    };

    if (suggestion && suggestion.modifications.length > 0) {
      console.log(
        `    advisor: ${suggestion.modifications.length} mods, dropped ${suggestion.droppedCount} — rationale: ${suggestion.rationale}`,
      );
      const mutated = applyModifications(fetched.html, suggestion.modifications);
      if (mutated !== fetched.html) {
        const afterPath = path.join(outDir, `${slot}-after.png`);
        await renderLiveToPng(ctx, fetched.finalUrl, afterPath, mutated);
        // Perceptual diff against the before — route() interception
        // produces a real styled render on both legs, so a mod targeting
        // a selector that doesn't resolve no longer betrays itself as
        // unstyled HTML. Byte-equality (the previous check) misses cases
        // where rendering jitter shifts a few pixels but the page looks
        // identical. The renderer uses this same helper to bail to Tier 2.
        const [beforeBuf, afterBuf] = await Promise.all([
          fs.readFile(beforePath),
          fs.readFile(afterPath),
        ]);
        const visiblyChanged = isVisiblyChanged(beforeBuf, afterBuf);
        tier1.rendered = visiblyChanged;
        tier1.afterPath = visiblyChanged ? afterPath : null;
        console.log(
          `    tier1 after.png saved (${afterBuf.length} bytes${visiblyChanged ? '' : ' — IDENTICAL to before, mod did not visibly resolve'})`,
        );
        if (!visiblyChanged) await fs.unlink(afterPath);
      } else {
        console.log('    apply was a no-op — no mod resolved against the live HTML');
      }
    } else {
      console.log(`    advisor returned no mods (dropped ${suggestion?.droppedCount ?? 0})`);
    }

    // Tier 2 — feed the before image to Nano Banana 2 regardless of Tier 1
    // outcome so we can see both side by side. In production the orchestrator
    // only runs Tier 2 when Tier 1 declines; here we want the comparison.
    const apiKey = process.env.GEMINI_API_KEY;
    const tier2: FindingResult['tier2'] = {
      attempted: !!apiKey,
      ok: false,
      outputPath: null,
      outputMime: null,
      bytes: null,
    };
    if (apiKey) {
      const beforeBuffer = await fs.readFile(beforePath);
      try {
        const out = await callInpaint({
          apiKey,
          prompt: buildInpaintPrompt({
            finding: {
              ruleId: f.ruleId,
              title: f.title,
              whatToChange: f.whatToChange,
              whyItWorks: f.whyItWorks,
            },
            designTokens: null,
          }),
          beforeBuffer,
        });
        if (out) {
          const ext = out.mimeType.endsWith('jpeg') ? 'jpg' : 'png';
          const outPath = path.join(outDir, `${slot}-nano.${ext}`);
          await fs.writeFile(outPath, out.buffer);
          tier2.ok = true;
          tier2.outputPath = outPath;
          tier2.outputMime = out.mimeType;
          tier2.bytes = out.buffer.length;
          console.log(`    tier2 nano-banana saved (${out.buffer.length} bytes, ${out.mimeType})`);
        } else {
          console.log('    tier2 nano-banana returned no image');
        }
      } catch (err) {
        console.log(`    tier2 nano-banana failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    results.push({
      ruleId: f.ruleId,
      title: f.title,
      tier1,
      tier2,
    });
  }

  await ctx.close();
  await browser.close();

  await fs.writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ url, host, results }, null, 2),
  );
  console.log(`  index.json written`);
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('usage: tsx scripts/live-fix-preview.ts <url> [<url> ...]');
    process.exit(1);
  }
  await fs.mkdir(OUT_ROOT, { recursive: true });
  for (const url of urls) {
    try {
      await processOneSite(url);
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.stack : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

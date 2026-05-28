/**
 * FORGE-112 — Preview before deploy
 *
 * GET /api/preview/[experimentId]?bucket=variant  (default: variant)
 *
 * Fetches the origin page HTML and applies the experiment's VariantModification[]
 * inline (CSS injections as <style> tags, text replacements, attribute sets).
 * Returns modified HTML suitable for rendering in an iframe.
 *
 * No proxy traffic, no experiment activation, no assignment logging.
 * This is a read-only preview — the PM sees the change before going live.
 *
 * Usage in experiment detail UI:
 *   <iframe src="/api/preview/[experimentId]?bucket=variant" />
 *   <iframe src="/api/preview/[experimentId]?bucket=control" />
 *
 * Design notes:
 *   - Must be authenticated (session cookie from PM dashboard).
 *   - Must resolve to the correct org (prevent cross-tenant preview).
 *   - Timeout: 8s origin fetch; return 504 if origin is slow.
 *   - Content-Security-Policy: strip X-Frame-Options from origin response
 *     so the iframe can render in the dashboard.
 *   - For SPA origins: the preview will show the initial HTML only (same
 *     limitation as the proxy). Full SPA preview requires Browserless (Priority 4).
 */

import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getServerAuth } from '@/lib/auth/serverAuth';
import { getDb } from '@/lib/db/client';
import { zybitExperiments, phase1Sites } from '@/lib/db/schema';
import { applyModifications } from '@/lib/experiments/htmlModifier';
import type { VariantModification } from '@/lib/experiments/types';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ experimentId: string }> },
) {
  // TODO: authenticate — reject if no valid session
  const auth = await getServerAuth();
  if (!auth.ok) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { experimentId } = await params;
  const { searchParams } = new URL(request.url);
  const bucket = searchParams.get('bucket') === 'control' ? 'control' : 'variant';

  const db = getDb();

  // TODO: load experiment, verify org ownership
  const rows = await db
    .select()
    .from(zybitExperiments)
    .where(
      and(
        eq(zybitExperiments.id, experimentId),
        eq(zybitExperiments.organizationId, auth.orgId),
      ),
    )
    .limit(1);

  const experiment = rows[0];
  if (!experiment) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // TODO: resolve the origin URL from the site record
  const sites = await db
    .select({ domain: phase1Sites.domain })
    .from(phase1Sites)
    .where(eq(phase1Sites.id, experiment.siteId))
    .limit(1);

  const domain = sites[0]?.domain;
  if (!domain) {
    return new NextResponse('Site domain not found', { status: 404 });
  }

  const targetPath = experiment.targetPath ?? '/';
  // Lighthouse synthetic sites are served by the lighthouse server itself at
  // `http://localhost:3001/fake-sites/<slug>/<path>`. The seeded `domain` is
  // just the host, and there's no TLS — so the standard `https://${domain}`
  // path won't resolve. Detect via the `lighthouse_site_<slug>` id convention
  // (from `lighthouse/lib/seeder/orgSite.ts`) and rewrite the origin URL.
  // `urlaudit-*` sites are real-domain audits (the public `/audit` funnel and
  // `/demo`) that reuse the `lighthouse_site_*` id scheme — their pages live at
  // the real domain, not at the Lighthouse dev server's `/fake-sites/<slug>/`
  // path. Only genuine fake-site scenarios (manifest slugs) use that path.
  const rawSlug = experiment.siteId.startsWith('lighthouse_site_')
    ? experiment.siteId.slice('lighthouse_site_'.length)
    : null;
  const lighthouseSlug =
    rawSlug !== null && !rawSlug.startsWith('urlaudit-') ? rawSlug : null;
  const originUrl = lighthouseSlug
    ? `http://${domain}/fake-sites/${lighthouseSlug}${targetPath}`
    : `https://${domain}${targetPath}`;

  // TODO: fetch origin HTML with timeout
  let html: string;
  try {
    const originRes = await fetch(originUrl, {
      headers: { 'User-Agent': 'Zybit-Preview/1.0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
    if (!originRes.ok) {
      return new NextResponse(`Origin returned ${originRes.status}`, { status: 502 });
    }
    html = await originRes.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed';
    return new NextResponse(`Could not reach origin: ${message}`, { status: 504 });
  }

  // TODO: apply modifications only for variant bucket; control gets unmodified HTML
  let outputHtml = html;
  if (bucket === 'variant') {
    const modifications = experiment.modifications as VariantModification[] | null;
    if (modifications && modifications.length > 0) {
      outputHtml = applyModifications(html, modifications);
    }
  }

  // TODO: inject a visible banner so the PM knows this is a preview
  const banner = `
    <div style="position:fixed;top:0;left:0;right:0;z-index:999999;background:#7C3AED;color:#fff;
                font-family:system-ui,sans-serif;font-size:13px;padding:6px 16px;
                display:flex;align-items:center;gap:8px;">
      <strong>Zybit Preview</strong>
      <span style="opacity:0.8">${bucket === 'variant' ? 'Variant' : 'Control (unmodified)'}</span>
      <span style="opacity:0.5;margin-left:auto">Not live — preview only</span>
    </div>
    <div style="height:36px"></div>
  `;
  outputHtml = outputHtml.replace(/(<body[^>]*>)/i, `$1${banner}`);

  // Origin headers are NOT forwarded here — we build fresh headers from scratch.
  // X-Frame-Options from the origin is therefore already stripped.
  // Explicitly set frame-ancestors 'self' so the dashboard iframe can embed this response
  // even if the browser defaults change in the future. For Lighthouse synthetic
  // sites, the experiment detail page is itself embedded inside the Lighthouse
  // UI (port 3001 by default; override with LIGHTHOUSE_FRAME_ANCESTORS for
  // multi-port local-dev setups where Lighthouse is on e.g. :3003). The
  // browser's frame-ancestors check walks the whole chain and fails on
  // `'self'` alone, so allow the Lighthouse origin too in that case.
  const lighthouseAncestors =
    process.env.LIGHTHOUSE_FRAME_ANCESTORS ?? 'http://localhost:3001';
  const frameAncestors = lighthouseSlug
    ? `'self' ${lighthouseAncestors}`
    : "'self'";
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': 'noindex',
    'content-security-policy': `frame-ancestors ${frameAncestors}`,
  });

  return new NextResponse(outputHtml, { status: 200, headers });
}

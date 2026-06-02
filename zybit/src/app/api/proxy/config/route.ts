/**
 * GET /api/proxy/config?slug=acme
 *
 * Public (no auth) -- called by proxy middleware for visitor traffic.
 * Returns site info and running experiments for the given proxy slug.
 */

import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { phase1Sites, zybitExperiments } from '@/lib/db/schema';
import type { VariantModification } from '@/lib/experiments/types';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (!slug) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: '`slug` query param is required.' } },
      { status: 400 },
    );
  }

  const db = getDb();

  const sites = await db
    .select()
    .from(phase1Sites)
    .where(eq(phase1Sites.proxySlug, slug))
    .limit(1);

  const site = sites[0];
  if (!site) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Site not found for slug.' } },
      { status: 404 },
    );
  }

  const experiments = await db
    .select({
      id: zybitExperiments.id,
      targetPath: zybitExperiments.targetPath,
      modifications: zybitExperiments.modifications,
      controlPct: zybitExperiments.audienceControlPct,
      durationDays: zybitExperiments.durationDays,
      status: zybitExperiments.status,
    })
    .from(zybitExperiments)
    .where(
      and(
        eq(zybitExperiments.siteId, site.id),
        eq(zybitExperiments.status, 'running'),
        // Preview-only experiments are projected, never served to real
        // visitors (free-experiment loop §5). Exclude them here so a preview
        // can never be published to the proxy, regardless of status.
        eq(zybitExperiments.previewOnly, false),
      ),
    );

  return NextResponse.json(
    {
      success: true,
      data: {
        site: { id: site.id, domain: site.domain },
        experiments: experiments.map((e) => ({
          id: e.id,
          targetPath: e.targetPath,
          modifications: (e.modifications ?? []) as VariantModification[],
          controlPct: e.controlPct,
          durationDays: e.durationDays,
          status: e.status,
        })),
      },
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=60' },
    },
  );
}

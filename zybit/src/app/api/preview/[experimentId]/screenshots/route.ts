/**
 * GET /api/preview/[experimentId]/screenshots
 *
 * Renders a polished before/after screenshot pair for an experiment via the
 * same Browserless pipeline the audit fix-preview uses (`renderBeforeAfter`).
 * Unlike the live `<iframe>` preview, this strips scripts before screenshotting
 * — so the variant survives on client-rendered (SPA) pages instead of being
 * wiped on hydration, and the result is a styled image, not a raw fragment.
 *
 * Renders on first call and caches the Blob URLs on the experiment's `notes`
 * JSON so subsequent views are instant. Returns `{ beforeUrl, afterUrl }`, or
 * `{ beforeUrl: null }` when there's nothing to render / the render failed
 * (the UI falls back to a message).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getServerAuth } from '@/lib/auth/serverAuth';
import { getDb } from '@/lib/db/client';
import { phase1Sites, zybitExperiments } from '@/lib/db/schema';
import type { VariantModification } from '@/lib/experiments/types';
import { renderBeforeAfter } from '@/lib/audit/fixPreview/renderBeforeAfter';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ExperimentNotes {
  name?: string;
  selector?: string;
  changeType?: string;
  newValue?: string;
  insertPosition?: string | null;
  screenshotBeforeUrl?: string;
  screenshotAfterUrl?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ experimentId: string }> },
): Promise<NextResponse> {
  const auth = await getServerAuth();
  if (!auth.ok) return new NextResponse('Unauthorized', { status: 401 });

  const { experimentId } = await params;
  const db = getDb();

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
  if (!experiment) return new NextResponse('Not Found', { status: 404 });

  const notes: ExperimentNotes = experiment.notes ? JSON.parse(experiment.notes) : {};

  // Cache hit — return the already-rendered pair.
  if (notes.screenshotBeforeUrl && notes.screenshotAfterUrl) {
    return NextResponse.json({
      beforeUrl: notes.screenshotBeforeUrl,
      afterUrl: notes.screenshotAfterUrl,
      cached: true,
    });
  }

  const modifications = (experiment.modifications ?? []) as VariantModification[];
  if (modifications.length === 0) {
    return NextResponse.json({ beforeUrl: null, reason: 'no_modifications' });
  }

  const siteRows = await db
    .select({ domain: phase1Sites.domain })
    .from(phase1Sites)
    .where(eq(phase1Sites.id, experiment.siteId))
    .limit(1);
  const domain = siteRows[0]?.domain;
  if (!domain) return NextResponse.json({ beforeUrl: null, reason: 'no_domain' });

  const targetPath = experiment.targetPath ?? '/';
  // `urlaudit-*` sites are real-domain audits (public funnel + /demo) reusing
  // the `lighthouse_site_*` id scheme — render the real domain. Genuine
  // fake-site scenarios live at the Lighthouse dev server's /fake-sites/ path.
  const rawSlug = experiment.siteId.startsWith('lighthouse_site_')
    ? experiment.siteId.slice('lighthouse_site_'.length)
    : null;
  const isFakeSite = rawSlug !== null && !rawSlug.startsWith('urlaudit-');
  const originUrl = isFakeSite
    ? `http://${domain}/fake-sites/${rawSlug}${targetPath}`
    : `https://${domain}${targetPath}`;

  const result = await renderBeforeAfter({
    findingId: `exp_${experimentId}`,
    originUrl,
    modifications,
    // Fake-site renders legitimately hit a localhost dev server; real-domain
    // audits keep the SSRF guard on.
    enforceSsrfGuard: !isFakeSite,
  });

  if (!result) {
    return NextResponse.json({ beforeUrl: null, reason: 'render_failed' }, { status: 502 });
  }

  // Cache the URLs on the experiment so later views skip the render.
  const nextNotes: ExperimentNotes = {
    ...notes,
    screenshotBeforeUrl: result.beforeUrl,
    screenshotAfterUrl: result.afterUrl,
  };
  await db
    .update(zybitExperiments)
    .set({ notes: JSON.stringify(nextNotes), updatedAt: new Date() })
    .where(eq(zybitExperiments.id, experimentId));

  return NextResponse.json({ beforeUrl: result.beforeUrl, afterUrl: result.afterUrl, cached: false });
}

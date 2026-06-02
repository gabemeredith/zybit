/**
 * Slice 2 — POST /api/dashboard/findings/[id]/screenshot
 *
 * Returns the persisted Blob URL if `finding.screenshotUrl` is set.
 * Otherwise calls `renderFindingScreenshot` (Browserless + Blob), persists
 * the result, and returns the new URL. On failure or missing env, returns
 * `{ screenshotUrl: null, reason }` so the UI falls back to the live iframe.
 */

import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { resolveZybitActor } from '@/lib/auth/actor';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { renderFindingScreenshot } from '@/lib/phase2/findings/screenshot';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await resolveZybitActor(request, { allowQueryFallback: false });
  if (!actor.ok) return actor.response;
  const organizationId = actor.actor.organizationId;

  const db = getDb();
  const rows = await db
    .select({
      id: zybitFindings.id,
      screenshotUrl: zybitFindings.screenshotUrl,
      screenshotCapturedAt: zybitFindings.screenshotCapturedAt,
    })
    .from(zybitFindings)
    .where(and(eq(zybitFindings.id, id), eq(zybitFindings.organizationId, organizationId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (existing.screenshotUrl) {
    return NextResponse.json({
      screenshotUrl: existing.screenshotUrl,
      capturedAt: existing.screenshotCapturedAt,
      cached: true,
    });
  }

  const result = await renderFindingScreenshot(id, organizationId);
  if (!result) {
    // 502: render attempt failed upstream (Browserless / Blob / missing env).
    // Body shape kept so AnnotatedFindingPreview's existing
    // `data.screenshotUrl === null → fallback` path still works; the status
    // change is so other callers (monitoring, tests, future UI surfaces) that
    // switch on status codes treat this as the failure it actually is.
    return NextResponse.json(
      { screenshotUrl: null, reason: 'render_failed' },
      { status: 502 },
    );
  }
  return NextResponse.json({
    screenshotUrl: result.screenshotUrl,
    capturedAt: result.capturedAt,
    annotationsCount: result.annotationsCount,
    cached: false,
  });
}

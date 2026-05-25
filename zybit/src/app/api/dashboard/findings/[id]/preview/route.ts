/**
 * Slice 2 — annotated finding preview
 *
 * GET /api/dashboard/findings/[id]/preview
 *
 * Renders the customer's page with diagnosis overlays drawn by the rule's
 * `proposeAnnotations` template. Thin wrapper around
 * `buildAnnotatedFindingHtml`; the screenshot pipeline calls the same
 * helper so iframe and screenshot stay byte-identical.
 *
 * Response headers:
 *   X-Zybit-Annotations: <integer>  — count of overlay mods applied (0 = none)
 *   Content-Security-Policy: frame-ancestors 'self'  (+ lighthouse:3001 for synthetic)
 */

import { NextResponse } from 'next/server';
import { resolveZybitActor } from '@/lib/auth/actor';
import { buildAnnotatedFindingHtml } from '@/lib/phase2/findings/preview';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actor = await resolveZybitActor(request, { allowQueryFallback: true });
  if (!actor.ok) return actor.response;

  const result = await buildAnnotatedFindingHtml(id, actor.actor.organizationId);
  if (!result.ok) {
    return new NextResponse(result.message, { status: result.status });
  }

  const frameAncestors = result.lighthouseSlug
    ? "'self' http://localhost:3001"
    : "'self'";
  return new NextResponse(result.html, {
    status: 200,
    headers: new Headers({
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      'x-zybit-annotations': String(result.annotationsCount),
      'content-security-policy': `frame-ancestors ${frameAncestors}`,
    }),
  });
}

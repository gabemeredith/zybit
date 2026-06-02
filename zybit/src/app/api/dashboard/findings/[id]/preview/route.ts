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
 *   Content-Security-Policy: locks the response down so customer-controlled
 *     HTML cannot execute scripts on the Zybit origin if a user navigates
 *     directly to this URL (iframe parent uses sandbox="" as belt+braces).
 *     `script-src 'none'` blocks both <script> tags and inline event
 *     handlers; `stripScripts` removes them at the source as well.
 */

import { NextResponse } from 'next/server';
import { resolveZybitActor } from '@/lib/auth/actor';
import { buildAnnotatedFindingHtml } from '@/lib/phase2/findings/preview';

export const runtime = 'nodejs';

// Locks down everything that could exfiltrate or execute on the Zybit
// origin while still allowing the page to render visually for screenshots
// and the click-to-expand modal. Images and fonts are allowed from any
// origin because customer pages reference external CDNs; styles are
// allowed inline so the injected `<style data-zybit-variant>` overlay
// block renders.
const PREVIEW_CSP_LOCKDOWN =
  "default-src 'none'; " +
  "script-src 'none'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "img-src * data: blob:; " +
  "style-src 'self' 'unsafe-inline' *; " +
  "font-src * data:; " +
  "connect-src 'none'; " +
  "media-src 'none'; " +
  "frame-src 'none'; ";

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

  // Lighthouse (synthetic-site) previews are embedded by the Lighthouse dev
  // server during local development. In production this env var is unset and
  // only same-origin embedding is allowed. We additionally validate the value
  // matches a strict `scheme://host[:port]` shape so a stray env value can't
  // inject extra CSP directives.
  const lighthouseOrigin = result.lighthouseSlug
    ? sanitizePreviewOrigin(process.env.LIGHTHOUSE_PREVIEW_ORIGIN)
    : null;
  const frameAncestors = lighthouseOrigin ? `'self' ${lighthouseOrigin}` : "'self'";
  return new NextResponse(result.html, {
    status: 200,
    headers: new Headers({
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      'x-zybit-annotations': String(result.annotationsCount),
      'content-security-policy': `${PREVIEW_CSP_LOCKDOWN}frame-ancestors ${frameAncestors}`,
    }),
  });
}

const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

function sanitizePreviewOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!ORIGIN_PATTERN.test(trimmed)) return null;
  return trimmed;
}

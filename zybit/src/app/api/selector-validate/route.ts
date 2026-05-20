import { NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import { and, eq } from 'drizzle-orm';
import { getServerAuth } from '@/lib/auth/serverAuth';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { createPhase1Repository } from '@/lib/phase1';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';

// Build a minimal HTML document from the structured snapshot elements so we
// can run querySelectorAll against it. This covers tags and data-zybit-ref
// attributes from our extraction pass — class-based selectors won't match
// unless they're present in the CTA's ariaLabel or text.
function buildMinimalHtml(data: PageSnapshotData): string {
  const parts: string[] = ['<html><body>'];

  for (const h of data.headings) {
    const tag = `h${h.level}`;
    const escaped = h.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    parts.push(`<${tag} data-idx="${h.documentIndex}">${escaped}</${tag}>`);
  }

  for (const cta of data.ctas) {
    const tag = cta.tag;
    const text = cta.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const href = cta.href ? ` href="${cta.href}"` : '';
    const aria = cta.ariaLabel ? ` aria-label="${cta.ariaLabel}"` : '';
    const disabled = cta.disabled ? ' disabled' : '';
    parts.push(
      `<${tag} data-zybit-ref="${cta.ref}" data-landmark="${cta.landmark}"${href}${aria}${disabled}>${text}</${tag}>`
    );
  }

  for (const form of data.forms) {
    const submitBtn = form.hasSubmitButton ? '<button type="submit">Submit</button>' : '';
    parts.push(`<form data-zybit-ref="${form.ref}" data-landmark="${form.landmark}">${submitBtn}</form>`);
  }

  parts.push('</body></html>');
  return parts.join('\n');
}

export async function POST(request: Request) {
  const auth = await getServerAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let findingId: string, selector: string;
  try {
    const body = await request.json() as { findingId?: unknown; selector?: unknown };
    if (typeof body.findingId !== 'string' || !body.findingId) {
      return NextResponse.json({ error: 'findingId required' }, { status: 400 });
    }
    if (typeof body.selector !== 'string') {
      return NextResponse.json({ error: 'selector required' }, { status: 400 });
    }
    findingId = body.findingId;
    selector = body.selector.trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!selector) {
    return NextResponse.json({ count: null, status: 'empty' });
  }

  // Load the finding to get siteId + pathRef
  const db = getDb();
  const [finding] = await db
    .select({ siteId: zybitFindings.siteId, pathRef: zybitFindings.pathRef })
    .from(zybitFindings)
    .where(
      and(
        eq(zybitFindings.id, findingId),
        eq(zybitFindings.organizationId, auth.orgId),
      )
    )
    .limit(1);

  if (!finding?.pathRef) {
    return NextResponse.json({ count: null, status: 'no_snapshot' });
  }

  const repository = createPhase1Repository();
  const snapshot = await repository.getPageSnapshot({
    organizationId: auth.orgId,
    siteId: finding.siteId,
    pathRef: finding.pathRef,
  });

  if (!snapshot) {
    return NextResponse.json({ count: null, status: 'no_snapshot' });
  }

  const html = buildMinimalHtml(snapshot.data as PageSnapshotData);
  const root = parse(html);

  let count: number;
  try {
    const matches = root.querySelectorAll(selector);
    count = matches.length;
  } catch {
    return NextResponse.json({ count: null, status: 'invalid_selector' });
  }

  return NextResponse.json({ count, status: 'ok' });
}

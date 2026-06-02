import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getServerAuth } from '@/lib/auth/serverAuth';
import { getDb } from '@/lib/db/client';
import { zybitFindings } from '@/lib/db/schema';
import { createPhase1Repository } from '@/lib/phase1';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { countSelectorMatches } from '@/lib/phase2/snapshots/selectorUtils';

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

  const result = countSelectorMatches(snapshot.data as PageSnapshotData, selector);
  return NextResponse.json(result);
}

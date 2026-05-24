import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

// Mirror of run/route.ts maxDuration. A 'running' audit older than this could
// not still be in-flight on the same invocation, so it is safe to assume the
// after() dispatch died and lazy-flip the row to 'failed' on read.
const RUN_MAX_DURATION_MS = 5 * 60 * 1000;

type AuditStatusRow = {
  id: string;
  status: string;
  domain: string;
  confirmed_at: string | null;
  completed_at: string | null;
  error: string | null;
};

// Don't pipe raw pipeline error strings to the browser — they can contain
// provider names, request IDs, stack fragments, or partial credentials. Keep
// the raw text in the DB for operators (read via `/admin/ops` or psql) and
// return a small bounded set of user-friendly categories instead.
function userFacingError(status: string, raw: string | null): string | null {
  if (status === 'unreachable') {
    return 'No pages could be crawled — likely bot protection, robots.txt, or JS-only navigation.';
  }
  if (status !== 'failed') return null;
  if (!raw) return 'The audit pipeline encountered an error.';

  const lower = raw.toLowerCase();
  if (lower.includes('url re-validation failed')) {
    return 'The site\'s DNS changed between submission and run. Please try again.';
  }
  if (lower.includes('report email failed')) {
    return 'The audit finished but the report email failed to send. We\'ll resend it shortly.';
  }
  if (lower.includes('daily audit capacity')) {
    return 'Daily audit capacity is full. Please try again tomorrow.';
  }
  return 'The audit pipeline encountered an error. Email us if it keeps happening.';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^pub_[0-9a-f]{24}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  }

  const db = getDb();
  const result = await db.execute<AuditStatusRow>(sql`
    SELECT id, status, domain, confirmed_at, completed_at, error
    FROM public_audits WHERE id = ${id} LIMIT 1
  `);

  const row = result.rows[0] as AuditStatusRow | undefined;
  if (!row) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Lazy recovery: if the row has been stuck in 'running' past the run
  // route's maxDuration, the after() dispatch in /confirm almost certainly
  // died (cold-start race, function killed, or run route 5xx that was
  // silently swallowed). Flip to 'failed' on read so the poller stops
  // spinning and the user sees a real error.
  let status = row.status;
  let error = row.error;
  if (status === 'running' && row.confirmed_at) {
    const startedAt = new Date(row.confirmed_at).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt > RUN_MAX_DURATION_MS) {
      await db.execute(sql`
        UPDATE public_audits
        SET status = 'failed',
            error = ${'Pipeline dispatch timed out — audit did not complete within the run window.'},
            completed_at = now()
        WHERE id = ${id} AND status = 'running'
      `);
      status = 'failed';
      error = 'Pipeline dispatch timed out — audit did not complete within the run window.';
    }
  }

  return NextResponse.json({
    id: row.id,
    status,
    domain: row.domain,
    completedAt: row.completed_at ?? null,
    error: userFacingError(status, error),
  });
}

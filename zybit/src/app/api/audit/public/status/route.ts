import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

type AuditStatusRow = {
  id: string;
  status: string;
  domain: string;
  completed_at: string | null;
  error: string | null;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^pub_[0-9a-f]{24}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  }

  const db = getDb();
  const result = await db.execute<AuditStatusRow>(sql`
    SELECT id, status, domain, completed_at, error
    FROM public_audits WHERE id = ${id} LIMIT 1
  `);

  const row = result.rows[0] as AuditStatusRow | undefined;
  if (!row) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    status: row.status,
    domain: row.domain,
    completedAt: row.completed_at ?? null,
    error: row.error ?? null,
  });
}

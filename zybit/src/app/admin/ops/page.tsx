import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifyAdminCookie, ADMIN_COOKIE } from '@/lib/auth/adminSession';
import { getDb } from '@/lib/db/client';
import { listOpsRows } from '@/lib/admin/opsQueries';
import OpsTable from './OpsTable';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const cookieStore = await cookies();
  if (!verifyAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect('/admin/login');
  }

  const db = getDb();
  const rows = await listOpsRows(db);
  const generatedAt = new Date().toISOString();

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-4 flex items-center gap-3 text-xs text-zinc-500">
          <Link href="/admin" className="hover:text-zinc-900">← Admin</Link>
          <span>/</span>
          <span className="text-zinc-700">Ops</span>
        </div>
        <OpsTable rows={rows} generatedAt={generatedAt} />
      </div>
    </div>
  );
}

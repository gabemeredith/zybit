import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminCookie, ADMIN_COOKIE } from '@/lib/auth/adminSession';
import { getDb } from '@/lib/db/client';
import { accessRequests, appUsers } from '@/lib/db/schema';
import AdminDashboard from './AdminDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const cookieStore = await cookies();
  if (!verifyAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect('/admin/login');
  }

  const db = getDb();
  const users = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      organizationId: appUsers.organizationId,
      role: appUsers.role,
      status: appUsers.status,
      createdAt: appUsers.createdAt,
    })
    .from(appUsers)
    .orderBy(appUsers.createdAt);

  const requests = await db
    .select({
      id: accessRequests.id,
      email: accessRequests.email,
      domain: accessRequests.domain,
      roleTitle: accessRequests.roleTitle,
      analyticsTool: accessRequests.analyticsTool,
      source: accessRequests.source,
      status: accessRequests.status,
      stripePaymentLink: accessRequests.stripePaymentLink,
      requestedAt: accessRequests.requestedAt,
    })
    .from(accessRequests)
    .orderBy(accessRequests.requestedAt);

  return <AdminDashboard initialUsers={users} initialRequests={requests} />;
}

export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getOrCreateOrg } from "@/lib/db/queries/org";
import { createPhase1Repository } from "@/lib/phase1";
import AppShell from "@/components/app/AppShell";
import ImpersonationBanner from "@/components/app/ImpersonationBanner";
import { PostHogIdentify } from "@/components/PostHogIdentify";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authResult = await getServerAuth();
  if (!authResult.ok) redirect("/sign-in");

  const { orgId, userId, email, role } = authResult;

  await getOrCreateOrg(orgId);

  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId: orgId, limit: 1 });
  const domain = sites[0]?.domain ?? null;

  return (
    <AppShell domain={domain}>
      <PostHogIdentify userId={userId} orgId={orgId} email={email} role={role} />
      <ImpersonationBanner orgId={orgId} />
      {children}
    </AppShell>
  );
}

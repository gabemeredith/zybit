import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import { getCockpitData } from "@/lib/dashboard/cockpit";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import CockpitView from "@/components/app/CockpitView";

export default async function CockpitPage() {
  const authResult = await getServerAuth();
  if (!authResult.ok) redirect("/sign-in");

  if (authResult.orgId === DEMO_ORG_ID) {
    const data = await getCockpitData(authResult.orgId);
    return <CockpitView data={data} orgId={authResult.orgId} />;
  }

  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId: authResult.orgId, limit: 1 });

  if (!sites[0]) {
    redirect("/app/onboarding");
  }

  const data = await getCockpitData(authResult.orgId);
  return <CockpitView data={data} orgId={authResult.orgId} />;
}

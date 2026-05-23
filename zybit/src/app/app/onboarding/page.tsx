export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import OnboardingWizard from "@/components/app/OnboardingWizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId: auth.orgId, limit: 1 });
  const existingSite = sites[0] ?? null;

  const integrations = existingSite
    ? await repository.listIntegrations({
        organizationId: auth.orgId,
        siteId: existingSite.id,
        limit: 10,
      })
    : [];

  const hasIntegration = integrations.length > 0;

  const { step } = await searchParams;
  const parsed = step ? Number.parseInt(step, 10) : NaN;
  const initialStep =
    parsed === 1 || parsed === 2 || parsed === 3 ? parsed : null;

  return (
    <OnboardingWizard
      existingSite={existingSite}
      hasIntegration={hasIntegration}
      initialStep={initialStep}
    />
  );
}

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { loadFreeExperimentGate } from "@/lib/billing/freeExperimentGate";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import TryExperimentForm from "@/components/app/TryExperimentForm";

/**
 * "Try one free experiment" — the in-app cold-URL on-ramp
 * (docs/sprints/free-experiment-loop.md §1). Paste a URL + your numbers → the
 * audit silently manufactures a finding → a projected before/after lands as a
 * preview experiment in the cockpit. One free per org, then the upgrade wall.
 */
export default async function TryPage() {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  // Gate state drives whether we render the form or the upgrade wall. The demo
  // org is exempt — it stages several experiments by design.
  const gate =
    auth.orgId === DEMO_ORG_ID
      ? { allowed: true as const }
      : await loadFreeExperimentGate(auth.orgId);

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <div className="brut-label mb-2">Free experiment</div>
        <h1 className="text-3xl font-black tracking-tighter text-[#111]">
          Try one free experiment
        </h1>
        <p className="mt-2 text-[#6B6B6B] leading-relaxed">
          Paste a page URL and we&apos;ll find the highest-leverage change, then
          project the lift on your numbers. No install, no traffic needed.
        </p>
      </div>

      {gate.allowed ? (
        <TryExperimentForm />
      ) : (
        <div className="brut-card p-8 text-center">
          <div className="brut-label mb-3">Free experiment used</div>
          <p className="text-[#111] font-bold text-lg mb-1">
            You&apos;ve run your one free experiment.
          </p>
          <p className="text-[#6B6B6B] leading-relaxed mb-6">
            Upgrade to run experiments on real traffic and measure the actual
            lift, not just the projection.
          </p>
          <Link href="/app/settings" className="brut-action">
            See upgrade options
          </Link>
        </div>
      )}
    </div>
  );
}

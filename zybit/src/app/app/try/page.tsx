export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import TryExperimentForm from "@/components/app/TryExperimentForm";

/**
 * "Try one free experiment" — the in-app cold-URL on-ramp
 * (docs/sprints/free-experiment-loop.md §1, Option 2). Paste a URL + your
 * numbers → the real audit surfaces a finding, renders the fix as a before/after
 * on your own page, and projects the lift on your numbers. The whole preview
 * builds to a "Launch on real traffic" button — the upgrade wall.
 */
export default async function TryPage() {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <div className="brut-label mb-2">Free experiment</div>
        <h1 className="text-3xl font-black tracking-tighter text-[#111]">
          Try one free experiment
        </h1>
        <p className="mt-2 text-[#6B6B6B] leading-relaxed">
          Paste a page URL and we&apos;ll find the highest-leverage change, render the fix on your
          own page, and project the lift on your numbers. No install, no traffic needed.
        </p>
      </div>

      <TryExperimentForm />
    </div>
  );
}

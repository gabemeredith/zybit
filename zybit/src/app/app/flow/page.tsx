export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import { getDb } from "@/lib/db/client";
import { zybitFindings } from "@/lib/db/schema";
import { createFlowGraphRepository } from "@/lib/phase2/flow";
import type { FlowGraph } from "@/lib/phase2/flow/types";
import FlowGraphView from "@/components/app/FlowGraphView";
import type { InferSelectModel } from "drizzle-orm";

type FindingRow = InferSelectModel<typeof zybitFindings>;

const SEVERITY_STYLES = {
  critical: "bg-red-50 text-red-700 border-red-100",
  warn: "bg-amber-50 text-amber-700 border-amber-100",
  info: "bg-sky-50 text-sky-700 border-sky-100",
} as const;

export default async function FlowPage() {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId: auth.orgId, limit: 1 });
  const site = sites[0] ?? null;
  if (!site) redirect("/app/onboarding");

  const db = getDb();

  // Load flow graph (table may not yet exist) and flow findings in parallel.
  const [flowGraph, flowFindings] = await Promise.all([
    (createFlowGraphRepository().get(auth.orgId, site.id) as Promise<FlowGraph | null>).catch(
      () => null,
    ),
    db
      .select()
      .from(zybitFindings)
      .where(
        and(
          eq(zybitFindings.siteId, site.id),
          eq(zybitFindings.organizationId, auth.orgId),
          eq(zybitFindings.category, "flow"),
          eq(zybitFindings.status, "open"),
        ),
      )
      .orderBy(desc(zybitFindings.priorityScore))
      .limit(10)
      .catch((): FindingRow[] => []),
  ]);

  const topFinding = flowFindings[0] ?? null;
  const highlightRoute = topFinding?.pathRef ?? undefined;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-[#111] mb-1.5">
          Flow advisory
        </h1>
        <p className="text-sm text-[#6B6B6B]">
          How users move through your product — and the step where most of them leave.
        </p>
      </div>

      {/* Flow graph */}
      <section className="mb-8">
        {flowGraph ? (
          <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B]">
                Route map &middot;{" "}
                <span className="font-mono normal-case tracking-normal">
                  {flowGraph.sessionCount.toLocaleString("en-US")} sessions
                </span>
              </div>
              <div className="text-[11px] font-mono text-[#9B9B9B]">
                {flowGraph.windowStart.slice(0, 10)} – {flowGraph.windowEnd.slice(0, 10)}
              </div>
            </div>
            <FlowGraphView graph={flowGraph} highlightRoute={highlightRoute} />
          </div>
        ) : (
          <div className="bg-white border border-black/[0.05] rounded-2xl px-8 py-12 text-center">
            <div className="text-sm font-semibold text-[#111] mb-1.5">
              No flow data yet
            </div>
            <p className="text-sm text-[#9B9B9B] mb-5">
              Run insights from the Findings page to generate a route map for this site.
            </p>
            <Link
              href="/app/findings"
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-[#111] border border-black/[0.12] rounded-lg px-4 py-2 hover:bg-black/[0.03] transition-colors"
            >
              Go to Findings
            </Link>
          </div>
        )}
      </section>

      {/* Flow findings */}
      {flowFindings.length > 0 && (
        <section>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">
            Flow findings
          </div>
          <div className="space-y-2">
            {flowFindings.map((finding: FindingRow) => (
              <Link
                key={finding.id}
                href={`/app/findings/${finding.id}`}
                className="flex items-start gap-4 bg-white border border-black/[0.05] rounded-2xl px-6 py-5 hover:border-black/[0.12] transition-colors"
              >
                {/* Priority bar */}
                <div
                  className="w-1 self-stretch rounded-full shrink-0 bg-[#111]"
                  style={{ opacity: 0.08 + finding.priorityScore * 0.6 }}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${
                        SEVERITY_STYLES[
                          finding.severity as keyof typeof SEVERITY_STYLES
                        ] ?? SEVERITY_STYLES.info
                      }`}
                    >
                      {finding.severity}
                    </span>
                    {finding.pathRef && (
                      <span className="font-mono text-xs text-[#6B6B6B] bg-black/[0.04] px-1.5 py-0.5 rounded">
                        {finding.pathRef}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[#111] mb-1">
                    {finding.title}
                  </p>
                  <p className="text-xs text-[#6B6B6B] leading-relaxed line-clamp-2">
                    {finding.summary}
                  </p>
                </div>

                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="shrink-0 text-[#9B9B9B] mt-1"
                  aria-hidden
                >
                  <path
                    d="M6 3l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty findings state (graph present but no flow findings yet) */}
      {flowGraph && flowFindings.length === 0 && (
        <section>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">
            Flow findings
          </div>
          <div className="bg-white border border-black/[0.05] rounded-2xl px-6 py-8 text-center">
            <p className="text-sm text-[#9B9B9B]">
              No open flow findings for this site. Every step in the flow above the
              detection threshold looks healthy.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

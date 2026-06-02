export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { desc, eq, and } from "drizzle-orm";
import Link from "next/link";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import { getDb } from "@/lib/db/client";
import { zybitFindings, zybitSiteMeta } from "@/lib/db/schema";
import { countSiteSessions } from "@/lib/phase2/jobs/insightsTrigger";
import RunInsightsButton from "@/components/app/RunInsightsButton";
import FindingRowActions from "@/components/app/FindingRowActions";

function timeAgo(isoDate: string | Date): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SEVERITY_STYLES = {
  critical: "bg-[#FF4A5A] text-white",
  warn: "bg-amber-300 text-[#111]",
  info: "bg-[#00E5FF] text-[#111]",
} as const;

const STATUS_STYLES = {
  open: "bg-white text-[#6B6B6B]",
  approved: "bg-emerald-300 text-[#111]",
  dismissed: "bg-black/[0.06] text-[#9B9B9B]",
  shipped: "bg-[#00E5FF] text-[#111]",
  measured: "bg-[#8A2BE2] text-white",
} as const;

const ALL_STATUSES = ["open", "approved", "dismissed", "shipped", "measured"] as const;
type FindingStatus = (typeof ALL_STATUSES)[number];

const FILTER_TABS: Array<{ key: FindingStatus | "all"; label: string }> = [
  { key: "open", label: "Open" },
  { key: "approved", label: "Approved" },
  { key: "shipped", label: "Shipped" },
  { key: "all", label: "All" },
];

function formatImpact(impactEstimate: { formatted: string; unit: string } | null | undefined): string | null {
  if (!impactEstimate) return null;
  return impactEstimate.formatted;
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const { status: statusParam } = await searchParams;
  const activeFilter: FindingStatus | "all" =
    statusParam && [...ALL_STATUSES, "all"].includes(statusParam as FindingStatus | "all")
      ? (statusParam as FindingStatus | "all")
      : "open";

  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId: auth.orgId, limit: 1 });
  const site = sites[0] ?? null;

  if (!site) redirect("/app/onboarding");

  const db = getDb();

  // Fetch site meta, all finding stubs (for tab counts), and live session count in parallel.
  // countSiteSessions does COUNT(DISTINCT session_id) — only shown when findings list is empty,
  // so this page is low-traffic at precisely the moment the accurate count matters most.
  const [siteMeta, allFindings, currentSessions] = await Promise.all([
    db
      .select({ threshold: zybitSiteMeta.insightThreshold })
      .from(zybitSiteMeta)
      .where(eq(zybitSiteMeta.siteId, site.id))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ id: zybitFindings.id, status: zybitFindings.status })
      .from(zybitFindings)
      .where(and(eq(zybitFindings.siteId, site.id), eq(zybitFindings.organizationId, auth.orgId))),
    countSiteSessions(site.id),
  ]);

  const sessionThreshold = siteMeta?.threshold ?? 100;

  const countsByStatus = ALL_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = allFindings.filter((f) => f.status === s).length;
    return acc;
  }, {});
  countsByStatus.all = allFindings.length;

  // Filtered findings with full data
  const conditions = [
    eq(zybitFindings.siteId, site.id),
    eq(zybitFindings.organizationId, auth.orgId),
  ];
  if (activeFilter !== "all") {
    conditions.push(eq(zybitFindings.status, activeFilter));
  }

  const findings = await db
    .select()
    .from(zybitFindings)
    .where(and(...conditions))
    .orderBy(desc(zybitFindings.priorityScore))
    .limit(100);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="brut-label mb-1 tracking-[0.2em]">Findings</div>
          <h1 className="text-4xl font-bold tracking-tighter text-[#111]">
            {countsByStatus.open} open finding{countsByStatus.open !== 1 ? "s" : ""}
          </h1>
        </div>
        <RunInsightsButton siteId={site.id} orgId={auth.orgId} />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 border-b-[1.5px] border-black/[0.1] pb-0">
        {FILTER_TABS.map((tab) => {
          const count = countsByStatus[tab.key] ?? 0;
          const isActive = activeFilter === tab.key;
          return (
            <Link
              key={tab.key}
              href={`/app/findings?status=${tab.key}`}
              className={`relative mono-text px-4 py-2.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors ${
                isActive
                  ? "text-[#111] after:absolute after:-bottom-[1.5px] after:left-0 after:right-0 after:h-[2.5px] after:bg-[#111]"
                  : "text-[#6B6B6B] hover:text-[#111]"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold ${
                    isActive ? "bg-[#111] text-[#FAFAF8]" : "bg-black/[0.06] text-[#6B6B6B]"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {findings.length === 0 ? (
        <div className="brut-card p-10">
          {allFindings.length === 0 ? (
            <div className="max-w-sm mx-auto text-center">
              <p className="text-base font-semibold text-[#111] mb-1">
                Waiting for enough data
              </p>
              <p className="text-sm text-[#6B6B6B] mb-6 leading-relaxed">
                Zybit needs ~{sessionThreshold.toLocaleString()} sessions on{" "}
                <span className="font-medium text-[#111]">{site.domain}</span> before
                the audit rules have enough signal to surface findings.
              </p>

              {/* Session progress bar */}
              <div className="mb-6">
                <div className="flex items-center justify-between text-xs text-[#9B9B9B] mb-1.5">
                  <span>{currentSessions.toLocaleString()} sessions recorded</span>
                  <span>~{sessionThreshold.toLocaleString()} needed</span>
                </div>
                <div className="w-full h-2 bg-black/[0.06] border border-black/10 overflow-hidden">
                  <div
                    className="h-full bg-[#111] transition-all"
                    style={{ width: `${Math.min(100, Math.round((currentSessions / sessionThreshold) * 100))}%` }}
                  />
                </div>
                {currentSessions >= sessionThreshold && (
                  <p className="text-xs text-emerald-600 font-medium mt-1.5">
                    Enough sessions — run the pipeline to generate findings.
                  </p>
                )}
              </div>

              <RunInsightsButton siteId={site.id} orgId={auth.orgId} />
            </div>
          ) : (
            <p className="text-[#6B6B6B] leading-relaxed text-center">
              No {activeFilter === "all" ? "" : activeFilter} findings.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((finding) => {
            const impactLabel = formatImpact(
              finding.impactEstimate as { formatted: string; unit: string } | null
            );

            return (
              <div key={finding.id} className="group relative">
                <Link href={`/app/findings/${finding.id}`} className="block brut-card-link px-5 py-4">
                  <div className="flex items-start gap-3">
                    {/* Priority bar */}
                    <div className="shrink-0 mt-1">
                      <div className="w-1.5 h-8 bg-black/[0.06] overflow-hidden flex flex-col justify-end">
                        <div
                          className="w-full bg-[#111] transition-all"
                          style={{ height: `${Math.round(finding.priorityScore * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
                        <span
                          className={`brut-badge ${
                            SEVERITY_STYLES[finding.severity as keyof typeof SEVERITY_STYLES] ??
                            SEVERITY_STYLES.info
                          }`}
                        >
                          {finding.severity}
                        </span>
                        {finding.pathRef && (
                          <span className="brut-tag text-[#6B6B6B]">{finding.pathRef}</span>
                        )}
                        {impactLabel && (
                          <span className="brut-tag font-bold text-[#111]">{impactLabel}</span>
                        )}
                        {finding.learnAdjustment?.visible && (
                          <span
                            className={`brut-badge ${
                              finding.learnAdjustment.direction === 'boost'
                                ? 'bg-emerald-300 text-[#111]'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                            title={finding.learnAdjustment.reason}
                          >
                            {finding.learnAdjustment.direction === 'boost' ? '↑' : '↓'}{' '}
                            {finding.learnAdjustment.delta >= 0 ? '+' : '−'}
                            {Math.abs(finding.learnAdjustment.delta).toFixed(2)} past tests
                          </span>
                        )}
                        {(finding.learnAdjustment as { calibration?: { direction: string } } | null)?.calibration && (
                          <span
                            className={`brut-badge ${
                              (finding.learnAdjustment as { calibration?: { direction: string } })?.calibration?.direction === 'loosen'
                                ? 'bg-[#8A2BE2] text-white'
                                : 'bg-orange-300 text-[#111]'
                            }`}
                            title={(finding.learnAdjustment as { calibration?: { reason: string } })?.calibration?.reason}
                          >
                            Tuned
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-[#111] leading-snug mb-1 truncate">
                        {finding.title}
                      </p>
                      <p className="text-xs text-[#6B6B6B] leading-relaxed line-clamp-2">
                        {finding.summary}
                      </p>
                    </div>

                    {/* Right meta */}
                    <div className="shrink-0 flex flex-col items-end gap-1.5 ml-2">
                      <span
                        className={`brut-badge ${
                          STATUS_STYLES[finding.status as keyof typeof STATUS_STYLES] ??
                          STATUS_STYLES.open
                        }`}
                      >
                        {finding.status}
                      </span>
                      <span className="mono-text text-[11px] text-[#9B9B9B]">
                        {timeAgo(finding.lastSeenAt)}
                      </span>
                    </div>
                  </div>
                </Link>

                {/* Inline row actions — visible on hover, don't navigate */}
                {(finding.status === "open" || finding.status === "approved") && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                    <FindingRowActions
                      findingId={finding.id}
                      currentStatus={finding.status as "open" | "approved"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

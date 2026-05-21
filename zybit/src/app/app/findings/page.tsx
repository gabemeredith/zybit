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
  critical: "bg-red-50 text-red-700 border-red-100",
  warn: "bg-amber-50 text-amber-700 border-amber-100",
  info: "bg-sky-50 text-sky-700 border-sky-100",
} as const;

const STATUS_STYLES = {
  open: "bg-black/[0.05] text-[#6B6B6B]",
  approved: "bg-emerald-50 text-emerald-700",
  dismissed: "bg-black/[0.04] text-[#9B9B9B]",
  shipped: "bg-sky-50 text-sky-700",
  measured: "bg-violet-50 text-violet-700",
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
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-1">
            Findings
          </div>
          <h1 className="text-3xl font-bold tracking-tighter text-[#111]">
            {countsByStatus.open} open finding{countsByStatus.open !== 1 ? "s" : ""}
          </h1>
        </div>
        <RunInsightsButton siteId={site.id} orgId={auth.orgId} />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-black/[0.06] pb-0">
        {FILTER_TABS.map((tab) => {
          const count = countsByStatus[tab.key] ?? 0;
          const isActive = activeFilter === tab.key;
          return (
            <Link
              key={tab.key}
              href={`/app/findings?status=${tab.key}`}
              className={`relative px-4 py-2.5 text-sm font-bold transition-colors ${
                isActive
                  ? "text-[#111] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#111]"
                  : "text-[#6B6B6B] hover:text-[#111]"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
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
        <div className="bg-white border border-black/[0.05] rounded-2xl p-10">
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
                <div className="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#111] rounded-full transition-all"
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
                <Link
                  href={`/app/findings/${finding.id}`}
                  className="block"
                >
                  <div className="bg-white border border-black/[0.05] rounded-2xl px-5 py-4 transition-all group-hover:-translate-y-0.5 group-hover:shadow-sm">
                    <div className="flex items-start gap-3">
                      {/* Priority bar */}
                      <div className="shrink-0 mt-1">
                        <div className="w-1 h-8 rounded-full bg-black/[0.06] overflow-hidden">
                          <div
                            className="w-full rounded-full bg-[#111] transition-all"
                            style={{ height: `${Math.round(finding.priorityScore * 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${
                              SEVERITY_STYLES[finding.severity as keyof typeof SEVERITY_STYLES] ??
                              SEVERITY_STYLES.info
                            }`}
                          >
                            {finding.severity}
                          </span>
                          {finding.pathRef && (
                            <span className="font-mono text-xs text-[#6B6B6B] bg-black/[0.04] px-1.5 py-0.5 rounded">
                              {finding.pathRef}
                            </span>
                          )}
                          {impactLabel && (
                            <span className="text-xs font-bold text-[#111] bg-black/[0.04] px-1.5 py-0.5 rounded">
                              {impactLabel}
                            </span>
                          )}
                          {finding.learnAdjustment?.visible && (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${
                                finding.learnAdjustment.direction === 'boost'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                  : 'bg-slate-50 text-slate-700 border-slate-200'
                              }`}
                              title={finding.learnAdjustment.reason}
                            >
                              {finding.learnAdjustment.direction === 'boost' ? '↑' : '↓'}{' '}
                              {finding.learnAdjustment.delta >= 0 ? '+' : '−'}
                              {Math.abs(finding.learnAdjustment.delta).toFixed(2)} from past tests
                            </span>
                          )}
                          {(finding.learnAdjustment as { calibration?: { direction: string } } | null)?.calibration && (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${
                                (finding.learnAdjustment as { calibration?: { direction: string } })?.calibration?.direction === 'loosen'
                                  ? 'bg-violet-50 text-violet-700 border-violet-100'
                                  : 'bg-orange-50 text-orange-700 border-orange-100'
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
                          className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            STATUS_STYLES[finding.status as keyof typeof STATUS_STYLES] ??
                            STATUS_STYLES.open
                          }`}
                        >
                          {finding.status}
                        </span>
                        <span className="text-xs text-[#9B9B9B]">
                          {timeAgo(finding.lastSeenAt)}
                        </span>
                      </div>
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

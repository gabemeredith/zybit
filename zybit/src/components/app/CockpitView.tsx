import Link from "next/link";
import type { CockpitData } from "@/lib/dashboard/cockpit";
import { SESSION_DISPLAY_THRESHOLD, deriveIntegrationHealth } from "@/lib/dashboard/cockpit";
import WelcomeState from "@/components/dashboard/WelcomeState";
import EmptyFindings from "@/components/dashboard/EmptyFindings";
import RunInsightsButton from "./RunInsightsButton";

interface CockpitViewProps {
  data: CockpitData;
  orgId: string;
}

/** Snapshots older than this (days) flag the Understand layer as stale. */
const SNAPSHOT_STALE_DAYS = 7;

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: "bg-red-50 text-red-700 border-red-100",
    warn: "bg-amber-50 text-amber-700 border-amber-100",
    info: "bg-sky-50 text-sky-700 border-sky-100",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-widest border ${
        styles[severity] ?? styles.info
      }`}
    >
      {severity}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-2">
        {label}
      </div>
      <div className="text-4xl font-bold tracking-tighter text-[#111] leading-none mb-1">
        {value}
      </div>
      {sub && (
        <div className="text-sm text-[#6B6B6B] mt-1">{sub}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block group transition-transform hover:-translate-y-0.5">
        {inner}
      </Link>
    );
  }
  return inner;
}

function PipelineHealth({ integrations }: { integrations: NonNullable<CockpitData["pipeline"]> }) {
  return (
    <div className="mt-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">
        Pipeline health
      </div>
      <div className="space-y-2">
        {integrations.integrations.map((integration) => {
          const health = deriveIntegrationHealth(integration);
          const dotClass =
            health.tone === "green"
              ? "bg-emerald-400"
              : health.tone === "amber"
                ? "bg-amber-400"
                : health.tone === "red"
                  ? "bg-red-400"
                  : "bg-gray-300";
          const labelClass =
            health.tone === "red"
              ? "text-red-600 font-medium"
              : health.tone === "amber"
                ? "text-amber-600 font-medium"
                : "text-[#6B6B6B]";
          return (
            <div
              key={integration.id}
              className="flex items-center justify-between bg-white border border-black/[0.05] rounded-xl px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-[#111] capitalize">
                    {integration.provider}
                  </span>
                  <span className={`text-xs ${labelClass}`}>{health.label}</span>
                </div>
              </div>
              <div className="text-right text-xs text-[#6B6B6B]">
                <div>
                  {integration.lastSyncedAt
                    ? `Synced ${timeAgo(integration.lastSyncedAt)}`
                    : "Never synced"}
                </div>
                <div className="text-[#9B9B9B]">
                  {integrations.eventCount7d.toLocaleString()} events · 7d
                </div>
              </div>
            </div>
          );
        })}
        {integrations.integrations.length === 0 && (
          <div className="bg-white border border-black/[0.05] rounded-xl px-5 py-5 flex items-center justify-between gap-4">
            <div className="text-sm text-[#6B6B6B]">
              No integrations connected. Zybit needs analytics data to generate findings.
            </div>
            <Link
              href="/app/onboarding?step=3"
              className="shrink-0 inline-flex items-center gap-2 bg-[#111] text-[#FAFAF8] px-4 py-2.5 font-bold text-xs uppercase tracking-[0.08em] hover:opacity-80 transition-opacity"
            >
              Connect PostHog
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function NoSiteCTA() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-6">
      <div className="max-w-md">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4">
          Get started
        </div>
        <h1 className="text-5xl font-bold tracking-tighter text-[#111] mb-4 leading-[0.95]">
          Connect your<br />first site.
        </h1>
        <p className="text-lg text-[#6B6B6B] leading-relaxed mb-8">
          Zybit needs to know which product to analyze. Start by adding your site URL and
          connecting your analytics.
        </p>
        <Link
          href="/app/onboarding"
          className="inline-flex items-center gap-2 bg-[#111] text-[#FAFAF8] px-8 py-4 font-bold text-sm uppercase tracking-[0.1em] hover:opacity-80 transition-opacity"
        >
          Connect site
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

export default function CockpitView({ data, orgId }: CockpitViewProps) {
  if (!data.site) {
    return <NoSiteCTA />;
  }

  const { site, pipeline, gate, findings, experiments, snapshots, lastInsightAt } = data;

  // No integration → show guidance
  if (!pipeline || pipeline.integrations.length === 0) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <EmptyFindings reason="no-integration" />
      </div>
    );
  }

  // Gate not met → baseline learning state
  if (gate && !gate.trustworthy) {
    return (
      <div className="p-8">
        <WelcomeState
          domain={site.domain}
          sessionsObserved={gate.sessionCount7d}
          threshold={SESSION_DISPLAY_THRESHOLD}
          siteId={site.id}
        />
      </div>
    );
  }

  // Full cockpit
  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-1">
            Cockpit
          </div>
          <h1 className="text-3xl font-bold tracking-tighter text-[#111]">
            {site.domain}
          </h1>
        </div>
        <RunInsightsButton siteId={site.id} orgId={orgId} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Open findings"
          value={findings.openCount}
          sub={findings.openCount === 1 ? "issue to address" : "issues to address"}
          href={findings.openCount > 0 ? "/app/findings" : undefined}
        />
        <StatCard
          label="Running experiments"
          value={experiments.runningCount}
          sub={
            experiments.totalCount === 0
              ? "none started"
              : experiments.lastComputedAt
                ? `${experiments.totalCount} total · results ${timeAgo(experiments.lastComputedAt)}`
                : `${experiments.totalCount} total · awaiting first compute`
          }
          href={experiments.runningCount > 0 ? "/app/experiments" : undefined}
        />
        <StatCard
          label="Last analysis"
          value={lastInsightAt ? timeAgo(lastInsightAt) : "—"}
          sub={lastInsightAt ? "insights pipeline ran" : "run insights to start"}
        />
      </div>

      {/* Snapshot staleness — Zybit-023 */}
      {snapshots.staleDays != null && snapshots.staleDays > SNAPSHOT_STALE_DAYS && (
        <div className="mb-8 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Page snapshots are {snapshots.staleDays} days old — the Understand layer may be stale.
        </div>
      )}

      {/* GA4-only measurement gap — Zybit-157 */}
      {pipeline.ga4OnlyMeasurementGap && (
        <div className="mb-8 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <span>
            GA4 connected — findings and proposals are available, but outcome
            measurement requires PostHog or Segment. GA4 is aggregate-grain and
            cannot be joined to A/B test assignments.
          </span>
        </div>
      )}

      {/* Top finding */}
      {findings.topFinding && (
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">
            Top priority finding
          </div>
          <Link href={`/app/findings/${findings.topFinding.id}`} className="block group">
            <div className="bg-white border border-black/[0.05] rounded-2xl p-6 transition-all group-hover:-translate-y-0.5 group-hover:shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-3">
                <h2 className="text-xl font-bold tracking-tight text-[#111] leading-snug">
                  {findings.topFinding.title}
                </h2>
                <SeverityBadge severity={findings.topFinding.severity} />
              </div>
              <p className="text-sm text-[#6B6B6B] leading-relaxed mb-4">
                {findings.topFinding.summary}
              </p>
              <div className="flex items-center justify-between">
                {findings.topFinding.pathRef && (
                  <span className="text-xs font-mono text-[#6B6B6B] bg-black/[0.04] px-2 py-1 rounded">
                    {findings.topFinding.pathRef}
                  </span>
                )}
                <span className="text-sm font-bold text-[#111] ml-auto group-hover:underline underline-offset-2">
                  View finding →
                </span>
              </div>
            </div>
          </Link>
          {findings.openCount > 1 && (
            <div className="mt-2 text-right">
              <Link
                href="/app/findings"
                className="text-sm text-[#6B6B6B] hover:text-[#111] transition-colors"
              >
                +{findings.openCount - 1} more finding{findings.openCount - 1 !== 1 ? "s" : ""} →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* No findings yet but gate passed */}
      {findings.openCount === 0 && (
        <div className="mb-8 bg-white border border-black/[0.05] rounded-2xl p-8 text-center">
          <div className="text-[#6B6B6B] mb-4">
            No findings yet. Run the insights pipeline to analyze your site.
          </div>
          <RunInsightsButton siteId={site.id} orgId={orgId} />
        </div>
      )}

      {/* Pipeline health */}
      {pipeline && (
        <PipelineHealth integrations={pipeline} />
      )}
    </div>
  );
}

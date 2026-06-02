import Link from "next/link";
import type { CockpitData } from "@/lib/dashboard/cockpit";
import { SESSION_DISPLAY_THRESHOLD, deriveIntegrationHealth } from "@/lib/dashboard/cockpit";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import WelcomeState from "@/components/dashboard/WelcomeState";
import EmptyFindings from "@/components/dashboard/EmptyFindings";
import PostHogStream from "@/components/demo/PostHogStream";
import HowTrackingWorks from "@/components/demo/HowTrackingWorks";
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
    critical: "bg-[#FF4A5A] text-white",
    warn: "bg-amber-300 text-[#111]",
    info: "bg-[#00E5FF] text-[#111]",
  };
  return (
    <span className={`brut-badge ${styles[severity] ?? styles.info}`}>
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
  const body = (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="brut-label pt-0">{label}</span>
        <span className="mono-text text-lg font-bold text-[#111] leading-none">{value}</span>
      </div>
      {sub && <div className="text-xs text-[#9B9B9B]">{sub}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block brut-card-link">
        {body}
      </Link>
    );
  }
  return <div className="brut-card">{body}</div>;
}

function PipelineHealth({ integrations }: { integrations: NonNullable<CockpitData["pipeline"]> }) {
  return (
    <div className="mt-6">
      <div className="brut-label mb-3">Pipeline health</div>
      <div className="space-y-2">
        {integrations.integrations.map((integration) => {
          const health = deriveIntegrationHealth(integration);
          const dotClass =
            health.tone === "green"
              ? "bg-emerald-400"
              : health.tone === "amber"
                ? "bg-amber-400"
                : health.tone === "red"
                  ? "bg-red-500"
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
              className="flex items-center justify-between brut-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 shrink-0 ${dotClass}`} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-[#111] capitalize tracking-tight">
                    {integration.provider}
                  </span>
                  <span className={`text-xs ${labelClass}`}>{health.label}</span>
                </div>
              </div>
              <div className="text-right text-xs text-[#6B6B6B] mono-text">
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
          <div className="brut-card px-5 py-5 flex items-center justify-between gap-4">
            <div className="text-sm text-[#6B6B6B]">
              No integrations connected. Zybit needs analytics data to generate findings.
            </div>
            <Link href="/app/onboarding?step=2" className="brut-action shrink-0">
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
        <div className="brut-label mb-4 tracking-[0.2em]">Get started</div>
        <h1 className="text-5xl font-bold tracking-tighter text-[#111] mb-4 leading-[0.95]">
          Connect your<br />first site.
        </h1>
        <p className="text-lg text-[#6B6B6B] leading-relaxed mb-8">
          Zybit needs to know which product to analyze. Start by adding your site URL and
          connecting your analytics.
        </p>
        <Link href="/app/onboarding" className="brut-action">
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

  const { site, pipeline, gate, findings, experiments, snapshots, bridge, lastInsightAt } = data;

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
          <div className="brut-label mb-1 tracking-[0.2em]">Cockpit</div>
          <h1 className="text-4xl font-bold tracking-tighter text-[#111]">
            {site.domain}
          </h1>
        </div>
        <RunInsightsButton siteId={site.id} orgId={orgId} />
      </div>

      {orgId === DEMO_ORG_ID && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <PostHogStream
            eventCount7d={pipeline.eventCount7d}
            bridgeLabel={bridge.label}
          />
          <HowTrackingWorks />
        </div>
      )}

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
          value={lastInsightAt ? timeAgo(lastInsightAt) : "never"}
          sub={lastInsightAt ? "insights pipeline ran" : "run insights to start"}
        />
      </div>

      {/* Snapshot staleness notice */}
      {snapshots.staleDays != null && snapshots.staleDays > SNAPSHOT_STALE_DAYS && (
        <div className="mb-6 brut-card px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-[#6B6B6B]">
            <span className="w-1.5 h-1.5 shrink-0 bg-[#111]" />
            <span>
              <span className="font-medium text-[#111]">Snapshots {snapshots.staleDays}d old.</span>{" "}
              The Understand layer may be stale.
            </span>
          </div>
          {snapshots.perPath.filter((p) => (p.staleDays ?? 0) > SNAPSHOT_STALE_DAYS).length > 0 && (
            <ul className="mt-2 space-y-0.5 pl-5">
              {snapshots.perPath
                .filter((p) => (p.staleDays ?? 0) > SNAPSHOT_STALE_DAYS)
                .slice(0, 8)
                .map((p) => (
                  <li key={p.pathRef} className="flex items-center justify-between gap-3 text-xs text-[#9B9B9B]">
                    <span className="font-mono truncate">{p.pathRef}</span>
                    <span className="shrink-0">{p.staleDays}d</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* PostHog bridge notice */}
      {bridge.state === "not-detected" && (
        <div className="mb-6 brut-card px-4 py-3 flex items-start gap-2 text-sm text-[#6B6B6B]">
          <span className="w-1.5 h-1.5 shrink-0 mt-1 bg-[#111]" />
          <span>
            <span className="font-medium text-[#111]">PostHog bridge not detected.</span>{" "}
            {bridge.assignedVisitors} visitors assigned but none joined to a conversion. Experiment outcomes may be undercounted.
          </span>
        </div>
      )}

      {/* GA4-only measurement gap */}
      {pipeline.ga4OnlyMeasurementGap && (
        <div className="mb-6 brut-card px-4 py-3 flex items-start gap-2 text-sm text-[#6B6B6B]">
          <span className="w-1.5 h-1.5 shrink-0 mt-1 bg-[#111]" />
          <span>
            <span className="font-medium text-[#111]">GA4 connected.</span>{" "}
            Findings and proposals are available, but outcome measurement requires PostHog or Segment.
            GA4 is aggregate-grain and cannot be joined to A/B test assignments.
          </span>
        </div>
      )}

      {/* Circuit breaker */}
      {pipeline.integrations.some((i) => i.status === "disconnected") && (
        <div className="mb-6 border-[1.5px] border-red-400 px-4 py-3 flex items-start gap-2 text-sm text-red-700">
          <span className="w-1.5 h-1.5 shrink-0 mt-1 bg-red-500" />
          <span>
            <span className="font-medium">
              {pipeline.integrations
                .filter((i) => i.status === "disconnected")
                .map((i) => i.provider)
                .join(", ")}{" "}
              sync paused.
            </span>{" "}
            Stopped retrying after repeated failures to avoid burning quota. Resume once the connection is fixed
            (POST <code className="font-mono text-xs">/api/phase2/integrations/:id/resume</code>).
          </span>
        </div>
      )}

      {/* Top finding */}
      {findings.topFinding && (
        <div className="mb-8">
          <div className="brut-label mb-3">Top priority finding</div>
          <Link href={`/app/findings/${findings.topFinding.id}`} className="block brut-card-link p-6 group">
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
                <span className="brut-tag text-[#6B6B6B]">
                  {findings.topFinding.pathRef}
                </span>
              )}
              <span className="mono-text text-xs font-bold uppercase tracking-[0.08em] text-[#111] ml-auto group-hover:underline underline-offset-2">
                View finding →
              </span>
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
        <div className="mb-8 brut-card p-8 text-center">
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

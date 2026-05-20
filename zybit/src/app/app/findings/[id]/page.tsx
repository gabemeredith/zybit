export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { zybitFindings } from "@/lib/db/schema";
import EvidencePanel from "@/components/app/EvidencePanel";
import FindingStatusActions from "@/components/app/FindingStatusActions";
import ExperimentBriefCard from "@/components/app/ExperimentBriefCard";
import type {
  AuditFindingEvidence,
  AuditFindingImpactEstimate,
  AuditFindingPrescription,
  LearnAdjustment,
  SnapshotDiagram,
} from "@/lib/phase2/rules/types";
import { createOutcomesRepository, type ExperimentOutcomeRow } from "@/lib/phase2/outcomes/repository";

const SEVERITY_STYLES = {
  critical: "bg-red-50 text-red-700 border-red-100",
  warn: "bg-amber-50 text-amber-700 border-amber-100",
  info: "bg-sky-50 text-sky-700 border-sky-100",
} as const;

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  approved: "Approved",
  dismissed: "Dismissed",
  shipped: "Shipped",
  measured: "Measured",
};

function outcomeGlyph(o: ExperimentOutcomeRow): string {
  if (o.guardrailBreached) return "⚠";
  if (o.result === "positive") return "✓";
  if (o.result === "negative") return "✗";
  return "○";
}

function outcomeSentence(o: ExperimentOutcomeRow): string {
  const path = o.pathRef ?? "(site-wide)";
  const mod = o.modificationType ? ` · ${o.modificationType}` : "";
  if (o.guardrailBreached) {
    const sign = (o.liftPct ?? 0) >= 0 ? "+" : "−";
    return `Stopped early — breached ${o.guardrailBreached} on ${path} · primary ${sign}${Math.abs(o.liftPct ?? 0).toFixed(1)}%${mod}`;
  }
  if (o.result === "positive") {
    return `Won +${(o.liftPct ?? 0).toFixed(1)}% on ${path}${mod}`;
  }
  if (o.result === "negative") {
    return `Lost ${(o.liftPct ?? 0).toFixed(1)}% on ${path}${mod}`;
  }
  return `Inconclusive on ${path}${mod}`;
}

function timeAgo(d: Date | string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select()
    .from(zybitFindings)
    .where(
      and(
        eq(zybitFindings.id, id),
        eq(zybitFindings.organizationId, auth.orgId),
      )
    )
    .limit(1);

  const finding = rows[0];
  if (!finding) notFound();

  // Layer 1 Learn — load matched past outcomes for the "Past tests" panel.
  const learn = finding.learnAdjustment as LearnAdjustment | null;
  const pastOutcomes: ExperimentOutcomeRow[] =
    learn && learn.basedOnOutcomeIds.length > 0
      ? await createOutcomesRepository().listByIds(finding.siteId, learn.basedOnOutcomeIds)
      : [];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#6B6B6B] mb-6">
        <Link href="/app/findings" className="hover:text-[#111] transition-colors">
          Findings
        </Link>
        <span>/</span>
        <span className="text-[#111]">{finding.title}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
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
          <span className="text-xs text-[#9B9B9B] ml-auto">
            Seen {timeAgo(finding.lastSeenAt)}
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-[#111] leading-snug mb-3">
          {finding.title}
        </h1>

        <p className="text-sm text-[#6B6B6B] leading-relaxed mb-5">{finding.summary}</p>

        {/* Status + actions row */}
        <div className="flex items-center gap-3 pt-4 border-t border-black/[0.04]">
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#9B9B9B]">
            Status:
          </span>
          <span className="text-xs font-bold text-[#111]">
            {STATUS_LABELS[finding.status] ?? finding.status}
          </span>
          <div className="ml-auto">
            <FindingStatusActions
              findingId={finding.id}
              currentStatus={finding.status as "open" | "approved" | "dismissed" | "shipped" | "measured"}
            />
          </div>
        </div>
      </div>

      {/* Evidence panel */}
      <EvidencePanel
        evidence={(finding.evidence ?? []) as AuditFindingEvidence[]}
        recommendation={(finding.recommendation ?? []) as string[]}
        prescription={finding.prescription as AuditFindingPrescription | null}
        impactEstimate={finding.impactEstimate as AuditFindingImpactEstimate | null}
        snapshotDiagram={finding.snapshotDiagram as unknown as SnapshotDiagram | null}
      />

      {/* Past-tests panel (Z-3 / Zybit-093) */}
      {learn && pastOutcomes.length > 0 && (
        <section className="mt-6 bg-white border border-black/[0.05] rounded-2xl px-6 py-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1">
            Past tests on your site
          </div>
          <div className="text-xs text-[#9B9B9B] mb-4">
            Tier {learn.tier} match · Adjusted by {learn.delta >= 0 ? "+" : "−"}
            {Math.abs(learn.delta).toFixed(2)}
          </div>
          <ul className="space-y-2 text-sm">
            {pastOutcomes.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <Link
                  href={`/app/experiments/${o.experimentId}`}
                  className="flex-1 flex items-center gap-2 text-[#111] hover:text-[#6B6B6B] transition-colors"
                >
                  <span className="font-mono text-base shrink-0">{outcomeGlyph(o)}</span>
                  <span className="text-sm">{outcomeSentence(o)}</span>
                </Link>
                <span className="text-xs text-[#9B9B9B] shrink-0">
                  {o.concludedAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Experiment section */}
      {finding.prescription && finding.status !== "dismissed" && (
        <div className="mt-6">
          {finding.experimentBrief ? (
            <ExperimentBriefCard
              brief={finding.experimentBrief as {
                experimentName: string;
                selector: string;
                changeType: "copy" | "style" | "hide";
                newValue: string;
                variantDescription: string;
                primaryMetric: string;
                hypothesis: string | null;
                createdAt: string;
              }}
              findingId={finding.id}
            />
          ) : (
            <div className="bg-white border border-black/[0.05] rounded-2xl px-6 py-5 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1">
                  Experiment brief
                </div>
                <p className="text-sm text-[#6B6B6B]">
                  Ready to test this finding? Create an experiment brief.
                </p>
              </div>
              <Link
                href={`/app/findings/${finding.id}/experiment`}
                className="shrink-0 ml-4 bg-[#111] text-[#FAFAF8] px-5 py-2.5 font-bold text-sm uppercase tracking-[0.08em] hover:opacity-80 transition-opacity"
              >
                Create experiment
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

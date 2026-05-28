export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { phase1Sites, zybitExperiments, zybitFindings } from "@/lib/db/schema";
import ExperimentControls from "@/components/app/ExperimentControls";
import ExperimentScreenshotPreview from "@/components/app/ExperimentScreenshotPreview";
import type { VariantModification } from "@/lib/experiments/types";
import { describeModification } from "@/lib/experiments/describeModification";

function timeAgo(d: Date | string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-black/[0.05] text-[#6B6B6B] border-transparent",
  running: "bg-emerald-50 text-emerald-700 border-emerald-100",
  completed: "bg-sky-50 text-sky-700 border-sky-100",
  stopped: "bg-black/[0.04] text-[#9B9B9B] border-transparent",
};

const SECTION_LABEL = "text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1";

function lift(control: number, variant: number): string {
  if (control === 0) return "—";
  const pp = ((variant - control) * 100).toFixed(1);
  const rel = ((variant - control) / control * 100).toFixed(0);
  return `${pp}pp (${Number(rel) >= 0 ? "+" : ""}${rel}% relative)`;
}

/** PM-facing change-type labels (the raw values are `copy|style|hide|insert`). */
const CHANGE_TYPE_DISPLAY: Record<string, string> = {
  copy: "Change text",
  style: "Swap styles",
  hide: "Hide element",
  insert: "Add a section",
};

/** The bare site root reads as "Homepage" in PM-facing copy. */
function pathLabel(p: string | null | undefined): string {
  return !p || p === "/" ? "Homepage" : p;
}

/** Humanize a primary-metric string like "conversion rate on /". */
function metricLabel(m: string): string {
  return m.replace(/\son\s\/(?=\s|$)/g, " on the homepage");
}

export default async function ExperimentDetailPage({
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
    .from(zybitExperiments)
    .where(
      and(
        eq(zybitExperiments.id, id),
        eq(zybitExperiments.organizationId, auth.orgId),
      )
    )
    .limit(1);

  const exp = rows[0];
  if (!exp) notFound();

  // Load the experiment's site to surface a "complete DNS setup" banner if the
  // proxy isn't wired yet. Without proxy_slug, this experiment can't actually
  // serve modified traffic — we want the PM to know that.
  const siteRows = await db
    .select({ proxySlug: phase1Sites.proxySlug })
    .from(phase1Sites)
    .where(eq(phase1Sites.id, exp.siteId))
    .limit(1);
  const siteProxySlug = siteRows[0]?.proxySlug ?? null;

  // Load linked finding for context
  let findingTitle: string | null = null;
  if (exp.findingId) {
    const findings = await db
      .select({ title: zybitFindings.title })
      .from(zybitFindings)
      .where(eq(zybitFindings.id, exp.findingId))
      .limit(1);
    findingTitle = findings[0]?.title ?? null;
  }

  const notes = exp.notes ? JSON.parse(exp.notes) as {
    name?: string;
    selector?: string;
    changeType?: string;
    newValue?: string;
    insertPosition?: string | null;
  } : null;

  const name = notes?.name ?? exp.hypothesis;
  const modifications = (exp.modifications ?? []) as VariantModification[];
  const hasResults = exp.resultVariantRate !== null && exp.resultControlRate !== null;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#6B6B6B] mb-6">
        <Link href="/app/experiments" className="hover:text-[#111] transition-colors">
          Experiments
        </Link>
        <span>/</span>
        <span className="text-[#111] truncate max-w-xs">{name}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
              STATUS_STYLES[exp.status] ?? STATUS_STYLES.draft
            }`}
          >
            {exp.status === "running" && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            )}
            {exp.status}
          </span>
          {exp.targetPath && (
            <span className="text-xs text-[#6B6B6B] bg-black/[0.04] px-1.5 py-0.5 rounded">
              {pathLabel(exp.targetPath)}
            </span>
          )}
          <span className="text-xs text-[#9B9B9B] ml-auto">
            {exp.startedAt ? `Started ${timeAgo(exp.startedAt)}` : `Created ${timeAgo(exp.createdAt)}`}
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-[#111] leading-snug mb-2">
          {name}
        </h1>

        {findingTitle && exp.findingId && (
          <div className="flex items-center gap-1.5 text-xs text-[#9B9B9B]">
            <span>From finding:</span>
            <Link
              href={`/app/findings/${exp.findingId}`}
              className="hover:text-[#111] transition-colors underline underline-offset-2"
            >
              {findingTitle}
            </Link>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {/* Proxy / DNS gating — experiments need proxy_slug to actually serve traffic */}
        {!siteProxySlug && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-amber-900">
              <span className="font-bold">Complete DNS setup to deploy this experiment.</span>{" "}
              Zybit needs a proxy slug + CNAME before variant traffic can route through us.
            </div>
            <Link
              href="/app/settings#proxy"
              className="shrink-0 text-sm font-bold text-amber-900 hover:text-amber-700 underline underline-offset-2"
            >
              Set up →
            </Link>
          </div>
        )}

        {/* Config card */}
        <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-5">
            Configuration
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            {notes?.changeType && (
              <div>
                <div className={SECTION_LABEL}>Change</div>
                <p className="text-sm text-[#111]">
                  {CHANGE_TYPE_DISPLAY[notes.changeType] ?? notes.changeType}
                </p>
              </div>
            )}
            {notes?.selector && (
              <div>
                <div className={SECTION_LABEL}>Target element</div>
                <p className="text-sm font-mono text-[#111]">{notes.selector}</p>
              </div>
            )}
            {notes?.newValue && notes.changeType !== "hide" && (
              <div className="col-span-2">
                <div className={SECTION_LABEL}>
                  {notes.changeType === "copy"
                    ? "Variant copy"
                    : notes.changeType === "insert"
                      ? "New section"
                      : "CSS value"}
                </div>
                <p className={`text-sm font-mono text-[#111] ${notes.changeType === "insert" ? "whitespace-pre-wrap break-words" : ""}`}>
                  {notes.newValue}
                </p>
              </div>
            )}
            <div>
              <div className={SECTION_LABEL}>Traffic split</div>
              <p className="text-sm text-[#111]">
                {exp.audienceControlPct}% control / {exp.audienceVariantPct}% variant
              </p>
            </div>
            <div>
              <div className={SECTION_LABEL}>Duration</div>
              <p className="text-sm text-[#111]">{exp.durationDays} days</p>
            </div>
            <div className="col-span-2">
              <div className={SECTION_LABEL}>Primary metric</div>
              <p className="text-sm text-[#111]">{metricLabel(exp.primaryMetric)}</p>
            </div>
            <div className="col-span-2">
              <div className={SECTION_LABEL}>Hypothesis</div>
              <p className="text-sm text-[#111] leading-relaxed">{exp.hypothesis}</p>
            </div>
          </div>

          {modifications.length > 0 && (
            <div className="mt-5 pt-5 border-t border-black/[0.04]">
              <div className={`${SECTION_LABEL} mb-3`}>What the variant changes</div>
              {(() => {
                // Hide the cosmetic css-inject companions that style an inserted
                // section — they're an implementation detail of how the new
                // block looks, not a distinct change the PM authored. (Pure
                // "style" experiments with no insert still show their css.)
                const hasInsert = modifications.some((m) => m.type === "element-insert");
                const visibleMods = modifications.filter(
                  (m) => !(hasInsert && m.type === "css-inject"),
                );
                const described = visibleMods.map(describeModification);
                const anyNoOp = described.some((d) => d.noOp);
                const allNoOp = described.every((d) => d.noOp);
                return (
                  <>
                    {anyNoOp && (
                      <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
                        {allNoOp
                          ? "All modifications below are no-ops — the variant iframe will render identical HTML to control. Edit the brief to give the modification a real selector and value."
                          : "One or more modifications below are no-ops (empty selector or empty value). They will be silently skipped at proxy time."}
                      </div>
                    )}
                    <div className="space-y-2">
                      {described.map((d, i) => {
                        const mod = visibleMods[i];
                        return (
                          <div
                            key={i}
                            className={`rounded-xl px-4 py-3 font-mono text-xs ${
                              d.noOp
                                ? "bg-amber-50 border border-amber-200 text-amber-900"
                                : "bg-[#F5F5F3] text-[#333]"
                            }`}
                          >
                            <div>
                              <span className="text-[#6B6B6B]">{mod.type}</span>{" "}
                              <span>{d.selector || <em className="not-italic text-red-600">(empty selector)</em>}</span>
                            </div>
                            {d.payloadLabel && (
                              <div className="mt-1 text-[#6B6B6B]">
                                <span>{d.payloadLabel} </span>
                                <span className="text-[#333]">
                                  {d.payloadValue && d.payloadValue.length > 0 ? (
                                    `"${d.payloadValue}"`
                                  ) : (
                                    <em className="not-italic text-red-600">(empty)</em>
                                  )}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              {/* Before/after screenshots rendered via Browserless (scripts
                  stripped, so the variant survives on SPA pages — unlike the
                  old live-iframe preview). */}
              <ExperimentScreenshotPreview experimentId={id} />
            </div>
          )}
        </div>

        {/* Deployment via the reverse proxy is gated on proxy_slug being set
            (see banner above). A real "Deploy" CTA wired to the proxy will land
            in a future PR. */}

        {/* Results card */}
        {hasResults ? (
          <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-5">
              Results
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className={SECTION_LABEL}>Control rate</div>
                <p className="text-2xl font-bold tracking-tighter text-[#111]">
                  {(exp.resultControlRate! * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <div className={SECTION_LABEL}>Variant rate</div>
                <p className={`text-2xl font-bold tracking-tighter ${
                  exp.resultVariantRate! > exp.resultControlRate!
                    ? "text-emerald-700"
                    : "text-red-700"
                }`}>
                  {(exp.resultVariantRate! * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <div className={SECTION_LABEL}>Lift</div>
                <p className="text-2xl font-bold tracking-tighter text-[#111]">
                  {lift(exp.resultControlRate!, exp.resultVariantRate!)}
                </p>
              </div>
            </div>
            {exp.resultConfidence !== null && (
              <div className="flex items-center gap-3 pt-4 border-t border-black/[0.04]">
                <div className="text-sm text-[#6B6B6B]">
                  Statistical confidence:{" "}
                  <span className="font-bold text-[#111]">
                    {(exp.resultConfidence * 100).toFixed(0)}%
                  </span>
                </div>
                {exp.resultParticipants && (
                  <>
                    <span className="text-[#9B9B9B]">·</span>
                    <div className="text-sm text-[#6B6B6B]">
                      Participants:{" "}
                      <span className="font-bold text-[#111]">
                        {exp.resultParticipants.toLocaleString()}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* Controls */}
        <ExperimentControls
          experimentId={id}
          currentStatus={exp.status as "draft" | "running" | "completed" | "stopped"}
          hasResults={hasResults}
          defaultResults={{
            controlRate: exp.resultControlRate ?? undefined,
            variantRate: exp.resultVariantRate ?? undefined,
            confidence: exp.resultConfidence ?? undefined,
            participants: exp.resultParticipants ?? undefined,
          }}
        />
      </div>
    </div>
  );
}

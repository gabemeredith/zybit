"use server";

/**
 * `/app/try` — the in-app "Try one free experiment" funnel
 * (docs/sprints/free-experiment-loop.md §1).
 *
 * Option 2 (render-only): for a cold URL we run the SAME real audit pipeline the
 * public `/audit` lead magnet uses (`runUrlAudit` → top finding →
 * `generateFixPreviews`), then render the result inline — the "why" (evidence +
 * prescription), the before/after fix preview as the hero, and a projected
 * dollar range from the PM's own numbers. The whole experience builds to a
 * "Launch on real traffic" button that is the upgrade wall: the projected
 * before/after is the free value; running it on real traffic is the paid unlock.
 *
 * Deliberately NO persistence into the PM's org (that's what made Option 1
 * heavier): `runUrlAudit` provisions its own `lighthouse_*` org for the findings
 * to hang off, and we only READ that to render. Keeping the viewer's org out of
 * it means a cold prospect feels the value with zero cockpit clutter.
 */

import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { zybitFindings } from "@/lib/db/schema";
import { validatePublicUrl } from "@/lib/audit/urlValidator";
import { generateFixPreviews } from "@/lib/audit/fixPreview";
import type {
  AuditFindingEvidence,
  AuditFindingPrescription,
  AuditFindingImpactEstimate,
} from "@/lib/phase2/rules/types";
import { runUrlAudit } from "../../../../lighthouse/lib/runner/runUrlAudit";

export interface FreeExperimentNumbersInput {
  monthlyVisitors: number | null;
  monthlyRevenue: number | null;
}

/** The renderable finding — plain props for EvidencePanel, no DB coupling. */
export interface RichFinding {
  title: string;
  summary: string;
  severity: string;
  ruleId: string;
  pathRef: string | null;
  evidence: AuditFindingEvidence[];
  recommendation: string[];
  prescription: AuditFindingPrescription | null;
  impactEstimate: AuditFindingImpactEstimate | null;
}

/** Projected lift/$ from the PM's own numbers — always a benchmark forecast. */
export interface ProjectedRange {
  liftPctRange: { min: number; max: number };
  revenueRange: { min: number; max: number } | null;
}

export type GenerateFreeExperimentResult =
  | {
      status: "ok";
      domain: string;
      finding: RichFinding;
      beforeUrl: string | null;
      afterUrl: string | null;
      fixTier: number | null;
      fixRationale: string | null;
      projection: ProjectedRange;
    }
  // Audit ran but the page is clean / structurally sound — nothing to show.
  | { status: "no_finding"; domain: string }
  // Crawl/render failed or the page was unreachable (bot wall, login, JS-only).
  | { status: "error"; reason: string }
  // Bad / unsafe URL — surfaced inline on the form.
  | { status: "invalid"; reason: string };

// A generic structural-fix conversion-lift band (published-heuristic range),
// surfaced to the PM as a *projection*, never a measured result. Kept as a
// fixed constant so it can never read as an invented per-site number.
const BENCHMARK_LIFT = { min: 5, max: 12 };

function buildProjection(monthlyRevenue: number | null): ProjectedRange {
  const rev =
    typeof monthlyRevenue === "number" && Number.isFinite(monthlyRevenue) && monthlyRevenue > 0
      ? monthlyRevenue
      : null;
  return {
    liftPctRange: BENCHMARK_LIFT,
    revenueRange: rev
      ? {
          min: Math.round((rev * BENCHMARK_LIFT.min) / 100),
          max: Math.round((rev * BENCHMARK_LIFT.max) / 100),
        }
      : null,
  };
}

/**
 * Run the real audit on a cold URL and return a fully renderable rich preview.
 * Heavy: crawls + snapshots + runs the rule engine + renders a before/after
 * screenshot pair (Browserless + AI). Bounded to a single page to keep it as
 * fast as the pipeline allows. No DB writes into the viewer's org.
 */
export async function generateFreeExperimentAction(
  url: string,
  numbers: FreeExperimentNumbersInput,
): Promise<GenerateFreeExperimentResult> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const validation = await validatePublicUrl(url);
  if (!validation.valid) return { status: "invalid", reason: validation.reason };
  const safeUrl = validation.url.toString();
  const domain = validation.url.hostname.replace(/^www\./, "");

  // Run the real pipeline (same as the public /audit lead magnet). One page,
  // prospect-safe copy, one vision pass — bounded for latency/cost.
  let result;
  try {
    result = await runUrlAudit({
      url: safeUrl,
      maxPages: 1,
      mode: "public-audit",
      visionPagesLimit: 1,
    });
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "Audit failed" };
  }

  const { siteId, organizationId, counts } = result;
  // Zero crawled pages ⇒ bot wall / login / JS-only nav. Don't fake a finding.
  if (counts.snapshots === 0) {
    return { status: "error", reason: "unreachable" };
  }

  // Top finding by priority (read from the lighthouse org runUrlAudit provisioned).
  const db = getDb();
  const [top] = await db
    .select()
    .from(zybitFindings)
    .where(eq(zybitFindings.siteId, siteId))
    .orderBy(desc(zybitFindings.priorityScore))
    .limit(1);

  if (!top) return { status: "no_finding", domain };

  const prescription = (top.prescription ?? null) as AuditFindingPrescription | null;

  // Before/after fix preview — the hero. Fail-soft: a thrown error or empty
  // result just drops the visual; the rest of the preview still renders.
  let beforeUrl: string | null = null;
  let afterUrl: string | null = null;
  let fixTier: number | null = null;
  let fixRationale: string | null = null;
  try {
    const outcomes = await generateFixPreviews({
      organizationId,
      siteId,
      auditUrl: safeUrl,
      findings: [
        {
          id: top.id,
          ruleId: top.ruleId,
          title: top.title,
          pathRef: top.pathRef,
          prescription: prescription
            ? {
                ...(prescription.whyItMatters !== undefined
                  ? { whyItMatters: prescription.whyItMatters }
                  : {}),
                whatToChange: prescription.whatToChange,
                whyItWorks: prescription.whyItWorks,
                experimentVariantDescription: prescription.experimentVariantDescription,
              }
            : null,
        },
      ],
    });
    const preview = outcomes.find((o) => o.preview)?.preview ?? null;
    if (preview) {
      beforeUrl = preview.beforeUrl;
      afterUrl = preview.afterUrl;
      fixTier = preview.tier;
      fixRationale = preview.rationale;
    }
  } catch (err) {
    console.error("[app/try] generateFixPreviews threw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    status: "ok",
    domain,
    finding: {
      title: top.title,
      summary: top.summary,
      severity: top.severity,
      ruleId: top.ruleId,
      pathRef: top.pathRef,
      evidence: (top.evidence ?? []) as AuditFindingEvidence[],
      recommendation: (top.recommendation ?? []) as string[],
      prescription,
      impactEstimate: (top.impactEstimate ?? null) as AuditFindingImpactEstimate | null,
    },
    beforeUrl,
    afterUrl,
    fixTier,
    fixRationale,
    projection: buildProjection(numbers.monthlyRevenue),
  };
}

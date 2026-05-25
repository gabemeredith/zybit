export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { zybitFindings } from "@/lib/db/schema";
import { createPhase1Repository } from "@/lib/phase1";
import ExperimentBuilderForm from "@/components/app/ExperimentBuilderForm";
import type {
  AuditFindingEvidence,
  AuditFindingPrescription,
} from "@/lib/phase2/rules/types";
import type { CtaCandidate, HeadingItem } from "@/lib/phase2/snapshots/types";
import { pickSelectorForFinding } from "@/lib/phase2/snapshots/pickSelector";
import { selectorStability, type SelectorStability } from "@/lib/phase2/snapshots/selectorUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeType = "copy" | "style" | "hide";

export interface SelectorSuggestion {
  label: string;       // display text shown in dropdown
  selector: string;    // the CSS selector string
  stability: SelectorStability; // Zybit-134 — how robust the selector is
}

const STABILITY_RANK: Record<SelectorStability, number> = { stable: 0, medium: 1, fragile: 2 };

// ---------------------------------------------------------------------------
// Default derivation helpers
// ---------------------------------------------------------------------------

function defaultChangeType(category: string): ChangeType {
  if (category === "hierarchy") return "style";
  return "copy";
}

function defaultPrimaryMetric(category: string, pathRef: string | null): string {
  const page = pathRef ? ` on ${pathRef}` : "";
  if (category === "rage") return `rage_click rate${page}`;
  if (category === "abandonment") return `form_submit rate${page}`;
  if (category === "hierarchy") return `CTA click-through rate${page}`;
  if (category === "bounce") return `bounce rate${page}`;
  return `conversion rate${page}`;
}

function defaultSelector(
  refs: Record<string, string | undefined> | null,
  ctas: CtaCandidate[],
): string {
  // Snapshot-grounded: prefer the parser-computed `cssSelector` from the
  // referenced CTA (testid → human id → name → role+aria-label ladder),
  // falling back to the highest-visual-weight CTA with a stable selector.
  // Returns "" only when no element on the page has a selector that will
  // survive into production — better empty than a synthetic `data-zybit-ref`
  // or evidence-derived `:has-text()` selector that the proxy can't match.
  return pickSelectorForFinding(ctas, refs?.ctaRef) ?? "";
}

function defaultNewValue(
  changeType: ChangeType,
  category: string,
  evidence: AuditFindingEvidence[],
): string {
  if (changeType === "hide") return "";
  if (changeType === "style") {
    // For hierarchy: the prescription says to swap classes — extract the class
    const heavy = evidence.find((e) => e.label.toLowerCase().includes("heaviest"));
    if (heavy?.context) {
      // context contains "weight 12, bg-blue-600 text-white text-lg"
      const classMatch = heavy.context.match(/bg-[\w-]+ text-white[\w\s-]*/);
      if (classMatch) return classMatch[0].trim();
    }
    return "";
  }
  // copy: pull the most-clicked CTA value or form submit label from evidence
  if (category === "abandonment") return "Get started — free";
  if (category === "hierarchy") {
    const clicked = evidence.find((e) => e.label.toLowerCase().includes("most-clicked"));
    if (clicked) return String(clicked.value);
  }
  return "";
}

function buildSuggestions(
  ctas: CtaCandidate[],
  headings: HeadingItem[],
): SelectorSuggestion[] {
  const suggestions: SelectorSuggestion[] = [];

  for (const cta of ctas) {
    const text = cta.text.trim().slice(0, 60);
    if (!text) continue;
    // Only suggest CTAs the parser found a real, browser-runnable selector
    // for. `cta.cssSelector` walks testid → human id → name → role+aria-label
    // (see `cssSelector.ts`) and is null when nothing stable exists — in
    // which case suggesting `[data-zybit-ref="…"]` would match Zybit's
    // internal snapshot HTML but no-op silently against the live page.
    if (!cta.cssSelector) continue;
    suggestions.push({
      label: `${cta.tag} "${text}" (${cta.landmark})`,
      selector: cta.cssSelector,
      stability: selectorStability(cta.cssSelector),
    });
  }

  for (const h of headings) {
    const text = h.text.trim().slice(0, 60);
    if (!text) continue;
    const tag = `h${h.level}`;
    // Headings have no stable ref — use nth-of-type keyed by documentIndex
    const selector = `${tag}:nth-of-type(${h.documentIndex + 1})`;
    suggestions.push({
      label: `${tag} "${text}"`,
      selector,
      stability: selectorStability(selector),
    });
  }

  // Stable selectors first so the PM reaches for durable ones (Zybit-134).
  return suggestions.sort((a, b) => STABILITY_RANK[a.stability] - STABILITY_RANK[b.stability]);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ExperimentBuilderPage({
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

  if (!finding.prescription || finding.status === "dismissed") {
    redirect(`/app/findings/${id}`);
  }

  const prescription = finding.prescription as AuditFindingPrescription;
  const evidence = (finding.evidence ?? []) as AuditFindingEvidence[];
  const refs = (finding.refs ?? null) as Record<string, string | undefined> | null;

  // Load snapshot for selector suggestions and CSS system hint (best-effort)
  let suggestions: SelectorSuggestion[] = [];
  let ctas: CtaCandidate[] = [];
  let cssSystem: import('@/lib/phase2/snapshots/cssSystemDetector').CssSystem | undefined;
  if (finding.pathRef) {
    try {
      const repository = createPhase1Repository();
      const snapshot = await repository.getPageSnapshot({
        organizationId: auth.orgId,
        siteId: finding.siteId,
        pathRef: finding.pathRef,
      });
      if (snapshot?.data) {
        ctas = snapshot.data.ctas ?? [];
        suggestions = buildSuggestions(
          ctas,
          snapshot.data.headings ?? [],
        );
        cssSystem = snapshot.data.cssSystem;
      }
    } catch {
      // no snapshot — suggestions, ctas, and cssSystem stay empty
    }
  }

  const changeType = defaultChangeType(finding.category);

  const freshDefaults = {
    experimentName: `${finding.title} — Variant B`,
    selector: defaultSelector(refs, ctas),
    changeType,
    newValue: defaultNewValue(changeType, finding.category, evidence),
    variantDescription: prescription.experimentVariantDescription,
    primaryMetric: defaultPrimaryMetric(finding.category, finding.pathRef),
    hypothesis: "",
  };

  const savedBrief = finding.experimentBrief;
  const isEditing = !!savedBrief;

  const formDefaults = isEditing && savedBrief
    ? {
        experimentName: savedBrief.experimentName,
        selector: savedBrief.selector,
        changeType: savedBrief.changeType,
        newValue: savedBrief.newValue,
        variantDescription: savedBrief.variantDescription,
        primaryMetric: savedBrief.primaryMetric,
        hypothesis: savedBrief.hypothesis ?? "",
      }
    : freshDefaults;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#6B6B6B] mb-6">
        <Link href="/app/findings" className="hover:text-[#111] transition-colors">
          Findings
        </Link>
        <span>/</span>
        <Link href={`/app/findings/${id}`} className="hover:text-[#111] transition-colors">
          {finding.title}
        </Link>
        <span>/</span>
        <span className="text-[#111]">
          {isEditing ? "Edit experiment" : "Create experiment"}
        </span>
      </div>

      <div className="mb-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-1">
          Experiment builder
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[#111]">
          {isEditing ? "Edit experiment brief" : "Create experiment brief"}
        </h1>
        <p className="text-sm text-[#6B6B6B] mt-2 leading-relaxed">
          Define the variant. The Zybit script applies this mutation at runtime — no
          code changes, no deploys.
        </p>
      </div>

      <ExperimentBuilderForm
        key={id}
        findingId={id}
        defaults={formDefaults}
        suggestions={suggestions}
        cssSystem={cssSystem}
      />
    </div>
  );
}

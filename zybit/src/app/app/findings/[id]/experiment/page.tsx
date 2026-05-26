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
import type { CtaCandidate, FormCandidate, HeadingItem } from "@/lib/phase2/snapshots/types";
import { pickSelectorForFinding } from "@/lib/phase2/snapshots/pickSelector";
import { selectorStability, type SelectorStability } from "@/lib/phase2/snapshots/selectorUtils";
import { nthOfTypeIndex } from "@/lib/phase2/rules/annotationHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeType = "copy" | "style" | "hide" | "insert";
export type InsertPosition = "before" | "after" | "prepend" | "append";

export interface SelectorSuggestion {
  label: string;       // display text shown in dropdown
  selector: string;    // the CSS selector string
  stability: SelectorStability; // Zybit-134 — how robust the selector is
}

const STABILITY_RANK: Record<SelectorStability, number> = { stable: 0, medium: 1, fragile: 2 };

// ---------------------------------------------------------------------------
// Default derivation helpers
// ---------------------------------------------------------------------------

// Category → default change type. The mapping is deterministic and mirrors
// the prescription verb each rule emits ("Add a…" → insert, "Rewrite…" →
// copy, "Promote…" → style). The PM can still override via the change-type
// buttons; this just opens the brief pointed at the modification the
// prescription is actually asking for, instead of always defaulting to
// "copy."
function defaultChangeType(category: string): ChangeType {
  switch (category) {
    // "Add a quick-answer section / FAQ / proof" — markup that didn't exist
    // on the page before. Needs `element-insert`.
    case "thrash":
    case "help":
    case "hesitation":
      return "insert";
    // "Promote / restyle / move above the fold" — re-skinning existing
    // elements via class swaps or CSS injection.
    case "hierarchy":
    case "fold":
      return "style";
    // Default to copy for everything else (bounce, abandonment, mismatch,
    // asymmetry, rage, error, nav, flow) — those prescriptions are
    // dominated by "rewrite the headline / submit label / nav copy."
    default:
      return "copy";
  }
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
  category: string,
  changeType: ChangeType,
  refs: Record<string, string | undefined> | null,
  ctas: CtaCandidate[],
  forms: FormCandidate[],
  headings: HeadingItem[],
): string {
  // For `insert` briefs the anchor depends on what we're inserting:
  //   - "hesitation" prescribes proof copy *immediately above the CTA*, so
  //     anchor the primary CTA and use position: before.
  //   - "thrash"/"help" prescribe a quick-answer block or FAQ at the top of
  //     the page, so anchor the first <h1> (with the position dropdown
  //     defaulting to "before" → the new section lands above the hero).
  // If no anchor is available the field stays empty and the PM picks from
  // the selector-suggestion dropdown.
  if (changeType === "insert") {
    if (category === "hesitation") {
      const ctaSelector = pickSelectorForFinding(ctas, forms, refs);
      if (ctaSelector) return ctaSelector;
    }
    const firstH1 = headings.find((h) => h.level === 1);
    const firstHeading = headings[0];
    const target = firstH1 ?? firstHeading;
    if (target) return `h${target.level}:nth-of-type(${nthOfTypeIndex(headings, target)})`;
    return "";
  }

  // Snapshot-grounded: prefer the parser-computed `cssSelector` from the
  // referenced element (CTA via `ctaRef`, form via `formRef` — see
  // `pickSelectorForFinding` for the ladder). Returns "" only when no
  // element on the page has a selector that will survive into production —
  // better empty than a synthetic `data-zybit-ref` or evidence-derived
  // `:has-text()` selector that the proxy can't match.
  return pickSelectorForFinding(ctas, forms, refs) ?? "";
}

function defaultNewValue(
  changeType: ChangeType,
  category: string,
  evidence: AuditFindingEvidence[],
  pathRef: string | null,
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
  if (changeType === "insert") {
    // Per-category scaffolds so the brief opens with copy that matches the
    // rule's actual prescription — not a generic placeholder the PM has to
    // throw away. All scaffolds use tags from the sanitizer's allowlist so
    // they round-trip unchanged.
    const path = pathRef ?? "/this-page";
    if (category === "help") {
      return `<section class="zybit-faq">
  <h2>Frequently asked</h2>
  <p><strong>How long does this take?</strong> A few minutes — no commitment.</p>
  <p><strong>Is there a fee?</strong> No setup fees, no minimums.</p>
  <p><strong>Can I cancel anytime?</strong> Yes — one click, no questions.</p>
</section>`;
    }
    if (category === "hesitation") {
      return `<aside class="zybit-proof">
  <p><strong>Used by 12,000+ teams</strong> — average setup time under 5 minutes.</p>
</aside>`;
    }
    // thrash (and any future insert categories) — quick-answer / anchor nav.
    return `<section class="zybit-quick-answer">
  <h2>Quick answer for ${path}</h2>
  <p>Most visitors here are looking for one of:</p>
  <ul>
    <li><a href="#option-1">Option 1</a></li>
    <li><a href="#option-2">Option 2</a></li>
    <li><a href="#option-3">Option 3</a></li>
  </ul>
</section>`;
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
  forms: FormCandidate[],
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

  // Forms with a stable selector — surfaces the abandoned form itself as a
  // pickable target so form-abandonment experiments aren't limited to
  // whatever CTAs happen to share the page.
  for (const form of forms) {
    if (!form.cssSelector) continue;
    suggestions.push({
      label: `form (${form.landmark}, ${form.fieldCount} field${form.fieldCount === 1 ? '' : 's'})`,
      selector: form.cssSelector,
      stability: selectorStability(form.cssSelector),
    });
  }

  for (const h of headings) {
    const text = h.text.trim().slice(0, 60);
    if (!text) continue;
    const tag = `h${h.level}`;
    // Headings have no stable ref — use nth-of-type. Note `:nth-of-type` is
    // per-tag and parent-scoped, so we count earlier same-level headings, not
    // the global document index (which would skip past headings of other
    // levels and produce a non-matching selector).
    const selector = `${tag}:nth-of-type(${nthOfTypeIndex(headings, h)})`;
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
  let forms: FormCandidate[] = [];
  let headings: HeadingItem[] = [];
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
        forms = snapshot.data.forms ?? [];
        headings = snapshot.data.headings ?? [];
        suggestions = buildSuggestions(ctas, forms, headings);
        cssSystem = snapshot.data.cssSystem;
      }
    } catch {
      // no snapshot — suggestions, ctas, forms, headings, and cssSystem stay empty
    }
  }

  const changeType = defaultChangeType(finding.category);

  const freshDefaults = {
    experimentName: `${finding.title} — Variant B`,
    selector: defaultSelector(finding.category, changeType, refs, ctas, forms, headings),
    changeType,
    newValue: defaultNewValue(changeType, finding.category, evidence, finding.pathRef),
    variantDescription: prescription.experimentVariantDescription,
    primaryMetric: defaultPrimaryMetric(finding.category, finding.pathRef),
    hypothesis: "",
    insertPosition: "before" as InsertPosition,
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
        insertPosition: (savedBrief.insertPosition ?? "before") as InsertPosition,
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

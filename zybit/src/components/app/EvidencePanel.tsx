import type {
  AuditFindingEvidence,
  AuditFindingImpactEstimate,
  AuditFindingPrescription,
  SnapshotDiagram,
  SnapshotFunnelStep,
} from "@/lib/phase2/rules/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidencePanelProps {
  evidence: AuditFindingEvidence[];
  recommendation: string[];
  prescription?: AuditFindingPrescription | null;
  impactEstimate?: AuditFindingImpactEstimate | null;
  snapshotDiagram?: SnapshotDiagram | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METADATA_LABELS = new Set([
  "page", "form landmark", "element role", "sample size",
  "heaviest cta position",
]);

function isMetadata(label: string): boolean {
  return METADATA_LABELS.has(label.toLowerCase());
}

function isPercentage(value: string | number): boolean {
  return typeof value === "string" && /^\d+(\.\d+)?%$/.test(value.trim());
}

function isPath(value: string | number): boolean {
  return typeof value === "string" && value.startsWith("/");
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Impact estimate banner
// ---------------------------------------------------------------------------

function ImpactBanner({ estimate }: { estimate: AuditFindingImpactEstimate }) {
  const isRevenue = estimate.unit === "USD";

  if (isRevenue) {
    return (
      <div className="bg-[#111] rounded-2xl px-6 py-5 mb-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/50 mb-1">
          Estimated impact
        </div>
        <div className="text-3xl font-bold tracking-tighter text-[#FAFAF8] leading-none mb-2">
          {estimate.formatted}
        </div>
        <div className="text-xs text-white/40 leading-relaxed font-mono">{estimate.basis}</div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-100 rounded-2xl px-6 py-5 mb-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-700/70 mb-1">
        Estimated impact
      </div>
      <div className="text-3xl font-bold tracking-tighter text-amber-900 leading-none mb-2">
        {estimate.formatted}
      </div>
      <div className="text-xs text-amber-700/60 leading-relaxed font-mono">{estimate.basis}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence grid
// ---------------------------------------------------------------------------

function EvidenceValue({ value }: { value: string | number }) {
  if (typeof value === "number") {
    return (
      <span className="text-3xl font-bold tracking-tighter text-[#111] leading-none">
        {formatNumber(value)}
      </span>
    );
  }
  if (isPercentage(value)) {
    return (
      <span className="text-3xl font-bold tracking-tighter text-amber-700 leading-none">
        {value}
      </span>
    );
  }
  if (isPath(value)) {
    return (
      <span className="font-mono text-sm text-[#111] bg-black/[0.04] px-1.5 py-0.5 rounded">
        {value}
      </span>
    );
  }
  // CTA name, element label, or other string
  return (
    <span className="text-base font-semibold text-[#111] leading-snug">
      &ldquo;{value}&rdquo;
    </span>
  );
}

function EvidenceItem({ item }: { item: AuditFindingEvidence }) {
  return (
    <div className="bg-white border border-black/[0.05] rounded-xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-2">
        {item.label}
      </div>
      <div className="mb-1">
        <EvidenceValue value={item.value} />
      </div>
      {item.context && (
        <div className="text-xs text-[#9B9B9B] leading-relaxed">{item.context}</div>
      )}
    </div>
  );
}

function MetadataRow({ items }: { items: AuditFindingEvidence[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 mt-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#9B9B9B]">
            {item.label}:
          </span>
          <span className="font-mono text-xs text-[#6B6B6B] bg-black/[0.04] px-1.5 py-0.5 rounded">
            {item.value}
          </span>
          {item.context && (
            <span className="text-[10px] text-[#9B9B9B]">({item.context})</span>
          )}
        </div>
      ))}
    </div>
  );
}

// Locked 2-up comparison block for CTA pair (hero-hierarchy-inversion)
function CtaComparisonBlock({
  clicked,
  heavy,
}: {
  clicked: AuditFindingEvidence;
  heavy: AuditFindingEvidence;
}) {
  return (
    <div className="col-span-full grid grid-cols-2 gap-3 mb-0">
      <div className="bg-white border border-black/[0.05] rounded-xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-2">
          {clicked.label}
        </div>
        <div className="text-base font-semibold text-[#111] leading-snug mb-1">
          &ldquo;{clicked.value}&rdquo;
        </div>
        {clicked.context && (
          <div className="text-xs text-[#9B9B9B]">{clicked.context}</div>
        )}
      </div>
      {/* vs divider */}
      <div className="relative">
        <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-10 w-3 h-3 rounded-full bg-[#FAFAF8] border border-black/[0.08] flex items-center justify-center">
          <span className="text-[8px] font-bold text-[#6B6B6B]">vs</span>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 h-full">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-700/70 mb-2">
            {heavy.label}
          </div>
          <div className="text-base font-semibold text-amber-900 leading-snug mb-1">
            &ldquo;{heavy.value}&rdquo;
          </div>
          {heavy.context && (
            <div className="text-xs text-amber-700/60">{heavy.context}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function EvidenceGrid({ evidence }: { evidence: AuditFindingEvidence[] }) {
  const primary: AuditFindingEvidence[] = [];
  const meta: AuditFindingEvidence[] = [];

  // Detect CTA comparison pair (hero-hierarchy-inversion pattern)
  const isCTAPair =
    evidence.length >= 2 &&
    evidence[0].label.toLowerCase().includes("cta") &&
    evidence[1].label.toLowerCase().includes("cta");

  for (const item of evidence) {
    if (isMetadata(item.label)) {
      meta.push(item);
    } else {
      primary.push(item);
    }
  }

  if (isCTAPair) {
    const ctaPrimary = primary.filter(
      (item) =>
        item.label.toLowerCase().includes("cta") ||
        item.label.toLowerCase().includes("heaviest")
    );
    const rest = primary.filter(
      (item) =>
        !item.label.toLowerCase().includes("cta") &&
        !item.label.toLowerCase().includes("heaviest")
    );

    return (
      <div>
        <div className="grid grid-cols-1 gap-3">
          {ctaPrimary.length >= 2 && (
            <CtaComparisonBlock clicked={ctaPrimary[0]} heavy={ctaPrimary[1]} />
          )}
          {rest.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {rest.map((item, i) => (
                <EvidenceItem key={i} item={item} />
              ))}
            </div>
          )}
        </div>
        <MetadataRow items={meta} />
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {primary.map((item, i) => (
          <EvidenceItem key={i} item={item} />
        ))}
      </div>
      <MetadataRow items={meta} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prescription card
// ---------------------------------------------------------------------------

function PrescriptionCard({ prescription }: { prescription: AuditFindingPrescription }) {
  return (
    <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-4">
        Recommended fix
      </div>
      <p className="text-sm text-[#111] leading-relaxed mb-3">
        {prescription.whatToChange}
      </p>
      <p className="text-sm text-[#6B6B6B] leading-relaxed mb-4">
        {prescription.whyItWorks}
      </p>
      <div className="border-t border-black/[0.04] pt-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#9B9B9B] mb-2">
          A/B variant
        </div>
        <div className="bg-[#F5F5F3] rounded-xl px-4 py-3 font-mono text-xs text-[#333] leading-relaxed">
          {prescription.experimentVariantDescription}
        </div>
      </div>
    </div>
  );
}

function RecommendationFallback({ recommendation }: { recommendation: string[] }) {
  if (recommendation.length === 0) return null;
  return (
    <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-4">
        Recommendation
      </div>
      <div className="space-y-3">
        {recommendation.map((para, i) => (
          <p key={i} className="text-sm text-[#111] leading-relaxed">{para}</p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snapshot diagram — form funnel
// ---------------------------------------------------------------------------

function FormFunnel({ diagram }: { diagram: SnapshotDiagram }) {
  const steps = diagram.funnelSteps ?? [];
  if (steps.length < 2) return null;

  const maxValue = Math.max(...steps.map((s) => s.value));
  const first = steps[0];
  const last = steps[steps.length - 1];
  const dropPct =
    first.value > 0 ? Math.round(((first.value - last.value) / first.value) * 100) : 0;

  const fields = diagram.items ?? [];

  return (
    <div className="bg-white border border-black/[0.05] rounded-2xl p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-5">
        Form funnel
      </div>

      {/* Bars */}
      <div className="space-y-3 mb-5">
        {steps.map((step: SnapshotFunnelStep, i: number) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-28 text-xs text-[#6B6B6B] shrink-0 text-right">{step.label}</div>
            <div className="flex-1 h-7 bg-black/[0.04] rounded-lg overflow-hidden">
              <div
                className={`h-full rounded-lg transition-all ${
                  step.isFlagged ? "bg-amber-400/70" : "bg-[#111]"
                }`}
                style={{ width: `${maxValue > 0 ? (step.value / maxValue) * 100 : 0}%` }}
              />
            </div>
            <div className="w-12 text-xs font-mono text-[#111] shrink-0">
              {formatNumber(step.value)}
            </div>
          </div>
        ))}
      </div>

      {/* Drop-off callout — percentage only, matching engine framing */}
      {dropPct > 0 && (
        <div className="flex items-center gap-2 mb-5">
          <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-700">
            {dropPct}% didn&rsquo;t finish
          </span>
        </div>
      )}

      {/* Field pills */}
      {fields.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-2">
            Form fields
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {fields.map((field, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                  field.isFlagged
                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                    : "bg-black/[0.04] text-[#6B6B6B]"
                }`}
              >
                {field.text}
                {field.isFlagged && (
                  <span className="text-[10px] font-bold text-amber-600">*</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Proposed fix */}
      {diagram.proposedFix && (
        <p className="text-sm text-[#6B6B6B] leading-relaxed border-t border-black/[0.04] pt-4">
          {diagram.proposedFix}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export default function EvidencePanel({
  evidence,
  recommendation,
  prescription,
  impactEstimate,
  snapshotDiagram,
}: EvidencePanelProps) {
  return (
    <div className="space-y-4">
      {/* 1. Impact estimate banner */}
      {impactEstimate && <ImpactBanner estimate={impactEstimate} />}

      {/* 2. Evidence grid */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">
          Why we flagged this
        </div>
        <EvidenceGrid evidence={evidence} />
      </div>

      {/* 3. Prescription or fallback recommendation */}
      {prescription ? (
        <PrescriptionCard prescription={prescription} />
      ) : (
        <RecommendationFallback recommendation={recommendation} />
      )}

      {/* 4. Snapshot diagram — form funnel or flow funnel */}
      {(snapshotDiagram?.type === "form-funnel" ||
        snapshotDiagram?.type === "flow-funnel") && (
        <FormFunnel diagram={snapshotDiagram} />
      )}
    </div>
  );
}

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
// Impact estimate
// ---------------------------------------------------------------------------

function ImpactBanner({ estimate }: { estimate: AuditFindingImpactEstimate }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-t-[1.5px] border-b-[1.5px] border-black/[0.08] mb-4">
      <span className="brut-label pt-0.5">Estimated impact</span>
      <div className="text-right">
        <span className="mono-text text-sm font-bold text-[#111]">{estimate.formatted}</span>
        {estimate.basis && (
          <div className="text-[11px] text-[#9B9B9B] mt-0.5 leading-relaxed max-w-[260px]">{estimate.basis}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence data table
// ---------------------------------------------------------------------------

function EvidenceValue({ value }: { value: string | number }) {
  if (typeof value === "number") {
    return (
      <span className="mono-text text-sm font-bold text-[#111]">
        {formatNumber(value)}
      </span>
    );
  }
  if (isPercentage(value)) {
    return (
      <span className="mono-text text-sm font-bold text-[#111]">
        {value}
      </span>
    );
  }
  if (isPath(value)) {
    return (
      <span className="font-mono text-xs text-[#111] bg-black/[0.04] px-1.5 py-0.5">
        {value}
      </span>
    );
  }
  return (
    <span className="text-sm font-semibold text-[#111] leading-snug">
      &ldquo;{value}&rdquo;
    </span>
  );
}

function EvidenceRow({ item }: { item: AuditFindingEvidence }) {
  return (
    <div className="py-2.5 border-t border-black/[0.08] first:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs text-[#6B6B6B] shrink-0">{item.label}</span>
        <EvidenceValue value={item.value} />
      </div>
      {item.context && (
        <div className="text-[11px] text-[#9B9B9B] mt-0.5 leading-relaxed text-right">{item.context}</div>
      )}
    </div>
  );
}

function CtaComparisonRows({
  clicked,
  heavy,
}: {
  clicked: AuditFindingEvidence;
  heavy: AuditFindingEvidence;
}) {
  return (
    <>
      <div className="py-2.5 border-t border-black/[0.08] first:border-0">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-xs text-[#6B6B6B] shrink-0">{clicked.label}</span>
          <span className="text-sm font-semibold text-[#111]">&ldquo;{clicked.value}&rdquo;</span>
        </div>
        {clicked.context && (
          <div className="text-[11px] text-[#9B9B9B] mt-0.5 leading-relaxed text-right">{clicked.context}</div>
        )}
      </div>
      <div className="py-2.5 border-t border-black/[0.08]">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-xs text-[#6B6B6B] shrink-0">{heavy.label}</span>
          <span className="text-sm font-semibold text-[#111]">&ldquo;{heavy.value}&rdquo;</span>
        </div>
        {heavy.context && (
          <div className="text-[11px] text-[#9B9B9B] mt-0.5 leading-relaxed text-right">{heavy.context}</div>
        )}
      </div>
    </>
  );
}

function MetadataRow({ items }: { items: AuditFindingEvidence[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-black/[0.08]">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#9B9B9B]">{item.label}:</span>
          <span className="font-mono text-[11px] text-[#6B6B6B]">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function EvidenceTable({ evidence }: { evidence: AuditFindingEvidence[] }) {
  const primary: AuditFindingEvidence[] = [];
  const meta: AuditFindingEvidence[] = [];

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
    const ctaItems = primary.filter(
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
        {ctaItems.length >= 2 && (
          <CtaComparisonRows clicked={ctaItems[0]} heavy={ctaItems[1]} />
        )}
        {rest.map((item, i) => (
          <EvidenceRow key={i} item={item} />
        ))}
        <MetadataRow items={meta} />
      </div>
    );
  }

  return (
    <div>
      {primary.map((item, i) => (
        <EvidenceRow key={i} item={item} />
      ))}
      <MetadataRow items={meta} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prescription card
// ---------------------------------------------------------------------------

function PrescriptionCard({ prescription }: { prescription: AuditFindingPrescription }) {
  return (
    <div className="brut-card p-6">
      <div className="brut-label mb-4">
        Recommended fix
      </div>
      <p className="text-sm text-[#111] leading-relaxed mb-3">
        {prescription.whatToChange}
      </p>
      <p className="text-sm text-[#6B6B6B] leading-relaxed mb-4">
        {prescription.whyItWorks}
      </p>
      <div className="border-t-[1.5px] border-black/[0.08] pt-4">
        <div className="brut-label mb-2">
          A/B variant
        </div>
        <div className="bg-[#F5F5F3] border-l-4 border-[#111] px-4 py-3 font-mono text-xs text-[#333] leading-relaxed">
          {prescription.experimentVariantDescription}
        </div>
      </div>
    </div>
  );
}

function RecommendationFallback({ recommendation }: { recommendation: string[] }) {
  if (recommendation.length === 0) return null;
  return (
    <div className="brut-card p-6">
      <div className="brut-label mb-4">
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
// Snapshot diagram
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
    <div className="brut-card p-6">
      <div className="flex items-baseline justify-between mb-5">
        <div className="brut-label">Form funnel</div>
        {dropPct > 0 && (
          <span className="mono-text text-xs text-[#6B6B6B]">{dropPct}% drop-off</span>
        )}
      </div>

      <div className="space-y-2.5 mb-5">
        {steps.map((step: SnapshotFunnelStep, i: number) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-24 text-xs text-[#6B6B6B] shrink-0 text-right truncate">{step.label}</div>
            <div className="flex-1 h-5 bg-black/[0.04] overflow-hidden">
              <div
                className="h-full bg-[#111] transition-all"
                style={{
                  width: `${maxValue > 0 ? (step.value / maxValue) * 100 : 0}%`,
                  opacity: step.isFlagged ? 0.45 : 1,
                }}
              />
            </div>
            <div className="w-14 text-right">
              <span className="mono-text text-xs text-[#111]">{formatNumber(step.value)}</span>
              {step.isFlagged && (
                <span className="ml-1 mono-text text-[10px] text-[#9B9B9B]">*</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {fields.length > 0 && (
        <div>
          <div className="brut-label mb-2">Form fields</div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {fields.map((field, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono border border-black/[0.1] ${
                  field.isFlagged
                    ? "text-[#111] border-black/[0.25]"
                    : "text-[#6B6B6B]"
                }`}
              >
                {field.text}
                {field.isFlagged && (
                  <span className="text-[10px] font-bold text-[#111]">*</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {diagram.proposedFix && (
        <p className="text-sm text-[#6B6B6B] leading-relaxed border-t-[1.5px] border-black/[0.08] pt-4">
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
      {/* 1. Impact estimate */}
      {impactEstimate && <ImpactBanner estimate={impactEstimate} />}

      {/* 2. Evidence */}
      <div>
        <div className="brut-label mb-3">
          Why we flagged this
        </div>
        <EvidenceTable evidence={evidence} />
      </div>

      {/* 3. Prescription or fallback recommendation */}
      {prescription ? (
        <PrescriptionCard prescription={prescription} />
      ) : (
        <RecommendationFallback recommendation={recommendation} />
      )}

      {/* 4. Snapshot diagram */}
      {(snapshotDiagram?.type === "form-funnel" ||
        snapshotDiagram?.type === "flow-funnel") && (
        <FormFunnel diagram={snapshotDiagram} />
      )}
    </div>
  );
}

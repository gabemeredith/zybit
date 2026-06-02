/**
 * Phase 2 contracts: versioned canonical event, per-site config, rollup orchestrator I/O,
 * and validation-gate types. Pure data shapes; no runtime side effects.
 */

import type {
  CohortAggregate,
  CtaAggregate,
  DeadEndAggregate,
  InsightFinding,
  InsightInput,
  InsightTotals,
  NarrativePathAggregate,
  OnboardingStepAggregate,
} from "@/lib/phase1/insights/types";
import type { FlowGraph } from "@/lib/phase2/flow/types";

export type ISODateString = string;

/**
 * Schema version for the canonical event. Bump when semantics change.
 * v1 = original Phase 1 event (no occurredAt/source/sourceEventId).
 * v2 = Phase 2 canonical event with provenance + windowing fields.
 */
export const CANONICAL_EVENT_SCHEMA_VERSION = 2 as const;
export type CanonicalEventSchemaVersion = 1 | 2;

/** First-class sources Zybit knows how to map. `api` covers raw client posts. */
export type CanonicalEventSource =
  | "api"
  | "shopify"
  | "segment"
  | "ga4"
  | "posthog"
  | "custom";

/**
 * Canonical Phase 2 event. Backward compatible with `Phase1EventRecord`:
 * legacy events lack `occurredAt`/`source`/`sourceEventId` and are treated as
 * `source="api"`, `occurredAt = createdAt`.
 */
export interface CanonicalEvent {
  id: string;
  organizationId: string;
  siteId: string;
  sessionId: string;
  type: string;
  path: string;

  /** Engine-time when the event happened (used by windowing). Falls back to createdAt. */
  occurredAt: ISODateString;
  /** Ingestion-time. */
  createdAt: ISODateString;

  /** Optional canonical numeric metrics (e.g. dwellMs, scrollPct). */
  metrics?: Record<string, number>;

  /** Optional canonical key-value properties (mapped, not raw provider blobs). */
  properties?: Record<string, string | number | boolean | null>;

  /** Stable user/visitor handle for stitching; opaque to Zybit. */
  anonymousId?: string;

  /** Provenance for dedupe + audit. */
  source: CanonicalEventSource;
  /** External event id from the source for dedupe (per (siteId, source, sourceEventId)). */
  sourceEventId?: string;

  schemaVersion: CanonicalEventSchemaVersion;
}

/**
 * Input shape for canonical event ingestion. Server fills `id`, `createdAt`,
 * defaults `source="api"`, `occurredAt = createdAt` if absent, sets `schemaVersion`.
 */
export interface CanonicalEventInput {
  siteId: string;
  sessionId: string;
  type: string;
  path: string;
  occurredAt?: ISODateString;
  metrics?: Record<string, number>;
  properties?: Record<string, string | number | boolean | null>;
  anonymousId?: string;
  source?: CanonicalEventSource;
  sourceEventId?: string;
}

/* ------------------------------------------------------------------ */
/* Per-site Phase 2 configuration                                       */
/* ------------------------------------------------------------------ */

/**
 * Cohort dimension declares how rollups split sessions into cohorts.
 * Example: { source: "property", key: "utm_source" } → groups sessions by `utm_source`.
 */
export interface CohortDimensionConfig {
  /** Stable id for the dimension (used in evidenceRefs and finding ids). */
  id: string;
  label: string;
  /** Where to read the cohort value from on each event. */
  source: "property" | "metric" | "path-prefix";
  /** Property/metric name when source is property/metric; ignored otherwise. */
  key?: string;
  /** Optional fallback when value is missing. */
  fallback?: string;
}

/** Definition of an onboarding step keyed by an event matcher. */
export interface OnboardingStepConfig {
  id: string;
  label: string;
  /** Match by event type (exact) or path prefix. */
  match:
    | { kind: "event-type"; type: string }
    | { kind: "path-prefix"; prefix: string };
  /** Step ordering — lower numbers are earlier in the funnel. */
  order: number;
}

/** Definition of a CTA on a page (by ref). */
export interface CtaConfig {
  /** Page reference: path or path prefix used for grouping. */
  pageRef: string;
  ctaId: string;
  label: string;
  /** Visual weight (0..1) — declared by site team; not inferred. */
  visualWeight: number;
  /** Match condition for CTA click events. */
  match:
    | { kind: "event-type"; type: string }
    | { kind: "property-equals"; key: string; value: string | number | boolean };
}

/** Declared narrative: a story page that should funnel into expected paths. */
export interface NarrativeConfig {
  id: string;
  label: string;
  sourcePathRef: string;
  expectedPathRefs: string[];
}

/**
 * How the site measures success. Used by audit rules to frame impact in
 * meaningful units instead of defaulting to dollars for every product type.
 *
 * - 'revenue':    SaaS / subscription — impact expressed in currency via ARPU.
 * - 'ecommerce':  Transactional — impact expressed in currency via AOV.
 * - 'growth':     Signups, leads, activations — impact expressed as conversions/month.
 * - 'engagement': Media, internal tools, content — impact expressed as sessions/month.
 * - 'custom':     Anything else — impact expressed in a user-defined metric label.
 */
export type GoalType = 'revenue' | 'ecommerce' | 'growth' | 'engagement' | 'custom';

export interface GoalConfig {
  /** Monthly average revenue per user. Used when goalType='revenue'. */
  arpu?: number;
  /** Average order value. Used when goalType='ecommerce'. */
  aov?: number;
  /** ISO 4217 currency code, e.g. 'USD', 'EUR', 'GBP'. Defaults to 'USD'. */
  currencyCode?: string;
  /** Human label for the conversion event, e.g. "signup" or "lead". Used when goalType='growth'. */
  conversionLabel?: string;
  /** Label for a custom metric, e.g. "donations" or "referrals". Used when goalType='custom'. */
  customMetricLabel?: string;
  /** Value per conversion in the custom metric unit. Used when goalType='custom'. */
  customMetricValue?: number;
  /** Estimated monthly unique visitors to the site. Improves impact math accuracy. */
  monthlyVisitors?: number;
  /** Site-level baseline conversion rate (0..1). Used to convert sessions → conversions. */
  baselineConversionRate?: number;
}

export interface Phase2SiteConfig {
  siteId: string;
  organizationId: string;
  cohortDimensions: CohortDimensionConfig[];
  onboardingSteps: OnboardingStepConfig[];
  ctas: CtaConfig[];
  narratives: NarrativeConfig[];
  /** Conversion event types beyond the global default set. */
  conversionEventTypes?: string[];
  /** How this site measures success — drives impact framing in findings. */
  goalType?: GoalType;
  /** Goal-specific config (ARPU, AOV, conversion label, etc.). */
  goalConfig?: GoalConfig;
  updatedAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Rollup pipeline I/O                                                  */
/* ------------------------------------------------------------------ */

export interface TimeWindow {
  /** Inclusive start. */
  start: ISODateString;
  /** Exclusive end. */
  end: ISODateString;
}

export interface RollupContext {
  siteId: string;
  window: TimeWindow;
  config: Phase2SiteConfig;
  events: CanonicalEvent[];
}

/**
 * Output of the rollup orchestrator: the InsightInput consumed by Phase 1
 * `generateFindings`, plus diagnostic metadata for the validation gate.
 */
export interface RollupResult {
  insightInput: InsightInput;
  diagnostics: RollupDiagnostics;
}

export interface RollupDiagnostics {
  windowDurationMs: number;
  totalEvents: number;
  uniqueSessions: number;
  /** Coverage stats per aggregate category. */
  perCategory: {
    /** `assignments` = total session-cohort pairs across all dimensions. */
    cohorts: { assignments: number; cohortCount: number };
    narratives: { matched: number; configured: number };
    onboarding: { matched: number; configured: number };
    ctas: { clicks: number; configured: number };
    deadEnds: { pages: number };
  };
  /** Event sources observed in the window. */
  sources: CanonicalEventSource[];
  /** Per-source event counts; enables share-based warnings. */
  sourceCounts: Array<{ source: CanonicalEventSource; events: number }>;
}

/* ------------------------------------------------------------------ */
/* Validation gate                                                      */
/* ------------------------------------------------------------------ */

export type GateLevel = "info" | "warn" | "block";

export interface GateWarning {
  code:
    | "WINDOW_TOO_SHORT"
    | "LOW_SESSION_COUNT"
    | "COHORT_IMBALANCE"
    | "EMPTY_NARRATIVES_CONFIG"
    | "EMPTY_ONBOARDING_CONFIG"
    | "EMPTY_CTA_CONFIG"
    | "NO_DEAD_END_DATA"
    | "DOMINANT_SOURCE";
  level: GateLevel;
  message: string;
  /** Optional structured payload describing the offending values. */
  detail?: Record<string, string | number | boolean | null>;
}

export interface GateResult {
  ok: boolean;
  warnings: GateWarning[];
}

/* ------------------------------------------------------------------ */
/* Phase 2 insights run (API)                                           */
/* ------------------------------------------------------------------ */

export interface RunInsightsRequest {
  siteId: string;
  window: TimeWindow;
  maxFindings?: number;
}

export interface RunInsightsResponse {
  siteId: string;
  window: TimeWindow;
  generatedAt: ISODateString;
  findings: InsightFinding[];
  warnings: GateWarning[];
  diagnostics: RollupDiagnostics;
  /** Whether engine output meets the gate's minimum bar. */
  trustworthy: boolean;
  /**
   * Derived route-transition flow graph for the window (PRD Milestone 1).
   * Always present — empty (no nodes/edges) when the window carried no
   * usable route data. Persisted by `maybeRunInsightsForSite` and read by
   * the `/app/flow` view.
   */
  flowGraph?: FlowGraph;
  /**
   * Phase 2 design-rule output (Layer B+C). Optional in v1 — empty when
   * no page snapshots are available or when rules find nothing actionable.
   * The shape lives in `@/lib/phase2/rules/types` to avoid a hard
   * dependency from `phase2/types.ts` on the rules module.
   */
  auditReport?: {
    findings: Array<{
      id: string;
      ruleId: string;
      category: string;
      severity: 'info' | 'warn' | 'critical';
      confidence: number;
      priorityScore: number;
      pathRef: string | null;
      title: string;
      summary: string;
      recommendation: string[];
      evidence: Array<{ label: string; value: string | number; context?: string }>;
      refs?: { snapshotId?: string; ctaRef?: string; elementRef?: string };
      calibration?: {
        direction: 'loosen' | 'tighten';
        multiplier: number;
        reason: string;
        conclusiveCount: number;
      };
    }>;
    diagnostics: Array<{
      ruleId: string;
      emitted: number;
      skippedReason?: string;
      candidatesEvaluated?: number;
      calibration?: {
        multiplier: number;
        direction: 'loosen' | 'tighten' | 'neutral';
        reason: string;
      };
    }>;
    groundedInSnapshots: boolean;
  };
  /**
   * Layer B (LLM finding prose) telemetry for this run — per-finding outcomes,
   * both prose versions, tokens/cost/latency, and run aggregates. Present
   * whenever the pipeline ran the Layer B post-pass (which records
   * `enabled: false` when the flag is off). Consumed by Lighthouse + the eval
   * harness. Type-only import; no runtime dependency.
   */
  layerB?: import('@/lib/phase2/layerB/orchestrator').LayerBRunTelemetry;
}

/**
 * Credibility artifact — stable envelope for offline export (`zybit.receipt.v1`).
 */
export interface ZybitReceiptV1Envelope {
  schemaVersion: 'zybit.receipt.v1';
  exportedAt: ISODateString;
  run: RunInsightsResponse;
}

/* ------------------------------------------------------------------ */
/* Re-exports of Phase 1 aggregate types for convenience                */
/* ------------------------------------------------------------------ */

export type {
  CohortAggregate,
  CtaAggregate,
  DeadEndAggregate,
  InsightInput,
  InsightTotals,
  NarrativePathAggregate,
  OnboardingStepAggregate,
};

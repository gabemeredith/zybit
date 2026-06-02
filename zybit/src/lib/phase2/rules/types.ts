/**
 * Phase 2 — Audit rules
 *
 * Audit rules consume canonical events + page snapshots + rollup output
 * and emit findings that name *the actual page elements* — the H1 we
 * saw, the button class signals, the rage-click target, the form field
 * that gets abandoned — so the audit reads as a tasteful designer- /
 * researcher-voiced review rather than a generic metrics dump.
 *
 * Rules cover two flavors:
 *   - **Design**: hierarchy, fold, nav structure, content/promise mismatch.
 *   - **Pain**:   rage, abandonment, hesitation, bounce, error, thrash,
 *                 cohort-pain asymmetry.
 *
 * Rules are pure functions (`evaluate`). They never throw on missing
 * data; they return an empty array. Each rule is responsible for its
 * own minimum-sample threshold so callers can run them blindly across
 * sites without producing noise on small windows.
 */

import type { CanonicalEvent, Phase2SiteConfig, RollupResult, TimeWindow } from '@/lib/phase2/types';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';
import type { PageCapture } from '@/lib/phase2/capture/types';
import type { FlowGraph } from '@/lib/phase2/flow/types';
import type { DesignTokens } from '@/lib/phase2/snapshots/tokenExtractor';
import type { VariantModification } from '@/lib/experiments/types';

export type AuditFindingSeverity = 'info' | 'warn' | 'critical';

export type AuditFindingCategory =
  // Design-shaped
  | 'hierarchy'        // visual weight vs click share mismatch
  | 'fold'             // above/below the fold coverage problems
  | 'nav'              // nav IA dispersion / over-faceted menus
  | 'mismatch'         // landing promise vs page content mismatch
  // Pain-shaped
  | 'rage'             // rage-click clusters
  | 'asymmetry'        // mobile vs desktop / cohort gap problems
  | 'abandonment'      // form views with no submission, by form
  | 'help'             // help/contact-seeking spike on a non-help page
  | 'hesitation'       // long active dwell with no follow-up click
  | 'bounce'           // single-page sessions on a key page
  | 'error'            // JS exception clusters
  | 'thrash'           // return-visit loops without progression
  // Flow-shaped
  | 'flow'             // inter-step drop-off across the product flow graph
  // Structural — grounded in snapshot data, no behavioral events required
  | 'accessibility'    // missing alt text, unlabelled inputs, generic link text
  | 'seo';             // missing meta description, canonical, heading structure

/**
 * One named piece of structured evidence the rule used to make its
 * call. Rules should populate this generously — finding consumers
 * can render it as "Why we said this" tooltips or full evidence cards.
 */
export interface AuditFindingEvidence {
  label: string;
  value: string | number;
  context?: string;
}

/**
 * Operator-facing impact estimate — what fixing this finding is worth, expressed
 * in the site's goal units (revenue, signups, sessions, or a custom label).
 */
export interface AuditFindingImpactEstimate {
  /** Numeric value of the estimate. */
  value: number;
  /** Unit string, e.g. 'USD', 'signups', 'sessions', 'donations'. */
  unit: string;
  /** Period, always 'monthly' for now. */
  period: 'monthly';
  /** Human-readable formatted string ready for display, e.g. '~150 conversions/month'. */
  formatted: string;
  /** Napkin-math basis so the estimate is auditable. */
  basis: string;
}

/**
 * Opinionated brief that tells the operator exactly what to change and why —
 * more specific and action-oriented than the analytical `recommendation` field.
 */
export interface AuditFindingPrescription {
  /**
   * PM-first business framing: 1-2 sentences on why this matters to the
   * reader's outcomes (activation, conversion, revenue). Optional — being
   * adopted rule-by-rule. When set, surfaces above `whatToChange` in
   * prospect-facing surfaces (e.g. the audit report email).
   */
  whyItMatters?: string;
  /** The concrete action to take. E.g. "Move 'Get started' above the fold on mobile." */
  whatToChange: string;
  /** Causal explanation of why this works. */
  whyItWorks: string;
  /** Description of the A/B variant to run. Pre-fills the experiment creation panel. */
  experimentVariantDescription: string;
}

/**
 * Structural page or funnel diagram derived from snapshot + event data.
 * Rendered by the finding detail UI as a before/after wireframe — no screenshot
 * service required; built purely from existing analysis artifacts.
 */
export interface SnapshotDiagramItem {
  type: 'h1' | 'h2' | 'h3' | 'cta' | 'form' | 'content-block';
  text: string;
  isFlagged: boolean;
  foldGuess?: 'above' | 'below' | 'uncertain';
  /** Where the proposed fix repositions this item. */
  proposedPosition?: 'above-fold';
  /** Secondary detail, e.g. required field labels. */
  subtext?: string;
}

export interface SnapshotFunnelStep {
  label: string;
  value: number;
  isFlagged?: boolean;
}

export interface SnapshotDiagram {
  /**
   * 'page-structure' renders a wireframe with a fold line; 'form-funnel' and
   * 'flow-funnel' render a stepped funnel ('flow-funnel' carries the
   * predecessor → chokepoint → continued steps of a flow-graph finding).
   */
  type: 'page-structure' | 'form-funnel' | 'flow-funnel';
  pathRef: string;
  items?: SnapshotDiagramItem[];
  /** Index in `items` after which the fold line is drawn. */
  foldAfterIndex?: number;
  funnelSteps?: SnapshotFunnelStep[];
  /** One-sentence description of the proposed fix shown below the diagram. */
  proposedFix: string;
}

/**
 * Layer 1 Learn — per-site re-ranking metadata applied after rules run.
 * `delta` is added to `priorityScore`. `visible` gates the card-view pill at
 * |delta| >= 0.05; the math is always applied to the score regardless.
 */
export interface LearnAdjustment {
  delta: number;
  tier: 1 | 2 | 3 | 4;
  direction: 'boost' | 'dampen';
  reason: string;
  basedOnOutcomeIds: string[];
  visible: boolean;
}

/**
 * Layer 2 Learn — per-site rule-threshold calibration. Derived purely from a
 * site's accumulated experiment outcomes for a given `ruleId` and applied to
 * that rule's detection floor before it runs. `multiplier` scales the floor:
 * `< 1` loosens (the rule fires on weaker signal because past tests on this
 * site won), `> 1` tightens (past tests lost). Bounded to ±30%; neutral (1.0)
 * until enough conclusive outcomes accumulate.
 */
export interface RuleCalibration {
  ruleId: string;
  /** Scales the rule's detection floor. Clamped to [0.7, 1.3]. */
  multiplier: number;
  direction: 'loosen' | 'tighten' | 'neutral';
  /** Confidence-weighted win/loss signal that produced the multiplier. */
  netSignal: number;
  /** Conclusive (positive/negative) outcomes that fed the calibration. */
  conclusiveCount: number;
  reason: string;
  basedOnOutcomeIds: string[];
}

export interface AuditFinding {
  /** Stable, human-readable id, e.g. `hero-hierarchy-inversion:/pricing`. */
  id: string;
  /** Rule that produced this finding. */
  ruleId: string;
  category: AuditFindingCategory;
  severity: AuditFindingSeverity;
  /** 0..1 — heuristic confidence (sample size + signal strength). */
  confidence: number;
  /** 0..1 — heuristic priority (impact × addressability). */
  priorityScore: number;
  /** Page this finding is about. `null` for site-wide findings. */
  pathRef: string | null;
  title: string;
  summary: string;
  /** Designer- / researcher-voiced paragraph(s). Each string is one paragraph. */
  recommendation: string[];
  evidence: AuditFindingEvidence[];
  /**
   * Rule's structured facts (the input to Layer B). Present on rules that
   * have been converted to the Layer A/B contract (see
   * `docs/sprints/llm-refactor.md`). Layer B reads this to generate
   * `summary` / `recommendation` / `prescription` when
   * `LLM_REFACTOR_ENABLED=1`; the deterministic templating function on the
   * rule produces the same fields when the flag is off OR when Layer B
   * fails. The persisted JSON value is the rule's own — never the LLM's.
   */
  factsJson?: Record<string, unknown>;
  /**
   * Which path produced the narrative prose (`summary` / `recommendation` /
   * `prescription`). `'template'` = the rule's deterministic templating;
   * `'llm-v1'` = Layer B generated it (and passed strict-JSON validation +
   * numeric grounding). Absent on rules not yet converted to Layer A/B, or
   * when Layer B is disabled. Set by the Layer B orchestrator, never a rule.
   */
  proseSource?: 'template' | 'llm-v1';
  /**
   * Opinionated fix brief. More concrete than `recommendation` — tells the
   * operator exactly what to change, not just what the problem is.
   */
  prescription?: AuditFindingPrescription;
  /**
   * Impact estimate in the site's goal units. Present when the site has
   * `goalConfig` set, or defaults to sessions-affected when it doesn't.
   */
  impactEstimate?: AuditFindingImpactEstimate;
  /**
   * Structural visualization derived from snapshot data. Rendered by the
   * finding detail page as a before/after wireframe.
   */
  snapshotDiagram?: SnapshotDiagram;
  /**
   * Optional refs into snapshots/CTAs/element ancestry so a UI can deep-link
   * back into the artifact that produced the finding.
   */
  refs?: {
    snapshotId?: string;
    /**
     * The primary CTA this finding is about — semantics per rule:
     * `hero-hierarchy-inversion` = the visually-heaviest CTA;
     * `rage-click-target` = the rage target; `help-seeking-spike` = the help CTA;
     * `hesitation-pattern` = the dwelt-on CTA;
     * `flow-inter-step-dropoff` = the primary CTA on the chokepoint (drop-off) step page.
     */
    ctaRef?: string;
    /** For inversion-shaped findings: the CTA the user actually clicks most. */
    clickedCtaRef?: string;
    elementRef?: string;
    formRef?: string;
  };
  /**
   * Layer 1 Learn metadata. Present when the re-ranker matched past outcomes
   * for this finding. `priorityScore` already reflects the `delta`; this field
   * carries the explanation + audit trail.
   */
  learnAdjustment?: LearnAdjustment;
  /**
   * Layer 2 Learn metadata. Present when this finding's rule had its detection
   * floor calibrated from past outcomes on this site. The `multiplier` was
   * already applied before the rule ran — this field is the PM-visible receipt.
   */
  calibration?: {
    direction: 'loosen' | 'tighten';
    multiplier: number;
    reason: string;
    conclusiveCount: number;
  };
}

/**
 * Audit mode — where the pipeline is running. Determines which rules can emit
 * and how. `public-audit` is the prospect-facing surface backed by synthetic
 * (lighthouse-generated) events: rules that depend on real behavioral data
 * have nothing trustworthy to say, so they declare a `publicAuditBehavior`
 * that this mode reads. `in-app` is the default; everything emits as-is.
 *
 * The default is `in-app` and rules are unaffected when it is. Public-audit
 * mode is fail-closed: a rule that does not declare a `publicAuditBehavior`
 * emits nothing in public mode (see `AuditRule.publicAuditBehavior`). That
 * removes the "forgot to update the blocklist" class of bug.
 */
export type AuditMode = 'in-app' | 'public-audit';

/**
 * Everything a rule needs to run. The route handler builds this once
 * per request and feeds it to every rule.
 */
export interface AuditRuleContext {
  organizationId: string;
  siteId: string;
  window: TimeWindow;
  config: Phase2SiteConfig;
  events: CanonicalEvent[];
  rollup: RollupResult;
  /**
   * Where this pipeline is running. Defaults to `in-app`. When set to
   * `public-audit`, `runAuditRules` consults each rule's
   * `publicAuditBehavior` and either emits the finding as-is, rewrites it
   * via `structuralPublicAuditCopy`, or drops it entirely.
   */
  mode?: AuditMode;
  /** Indexed by `pathRef` for O(1) lookup inside rules. */
  pageSnapshotsByPath: Map<string, PageSnapshot>;
  /** All snapshots, in case a rule wants to iterate site-wide. */
  pageSnapshots: PageSnapshot[];
  /**
   * Headless captures indexed by pathRef → ordered array (multiple breakpoints).
   * Present only when `capture_v2_enabled` is on and recent captures exist.
   * Rules check this first; fall back to `pageSnapshotsByPath` when absent.
   */
  pageCapturesByPath?: Map<string, PageCapture[]>;
  /**
   * Layer 2 Learn — per-site rule-threshold calibration, keyed by `ruleId`.
   * Computed from past outcomes in `runInsightsPipeline`. Absent in most unit
   * tests; rules read it through `calibratedFloor`/`calibratedCap`, which
   * default to the base threshold when no entry exists.
   */
  calibration?: Map<string, RuleCalibration>;
  /**
   * Derived route-transition flow graph for the window (PRD Milestone 1).
   * Present when the insights pipeline derived one; flow-aware rules read it.
   * Page-level rules ignore it.
   */
  flowGraph?: FlowGraph;
  /**
   * Site-level niche classification — `'saas'`, `'devtools'`, `'ecommerce'`,
   * `'community'`, `'media'`, `'local'`, or `'unknown'`. Computed from all
   * page snapshots before the rule loop runs via `classifySiteFromSnapshots`.
   * Rules read this through `siteNicheModulation(ruleId, ctx.siteNiche)`.
   * Absent (undefined) and `'unknown'` are equivalent: rules apply base
   * thresholds with no modulation.
   */
  siteNiche?: import('@/lib/phase2/classification/siteClassifier').SiteNiche;
}

/**
 * Inputs a rule needs to turn one of its own findings into preview-ready
 * `VariantModification[]` options. Built per-finding by the preview route.
 */
export interface ProposeModificationsContext {
  snapshot: PageSnapshot;
  designTokens: DesignTokens | null;
}

/**
 * How a rule behaves when the pipeline runs in `public-audit` mode.
 *
 *   `'as-is'`            — Rule's findings ship to the prospect verbatim.
 *                          For purely structural rules (snapshot-only) that
 *                          do not depend on real visitor data.
 *   `'structural-only'`  — Rule fires, but its findings are rewritten by
 *                          `structuralPublicAuditCopy` before they reach the
 *                          prospect. For rules that combine structure with a
 *                          behavioral overlay where the structural half is
 *                          honest but the behavioral half would be fabricated.
 *   `'empty'`            — Rule emits nothing in public-audit mode. For
 *                          purely behavioral rules whose entire output is
 *                          synthetic on a public audit.
 *
 * Public-audit mode is fail-closed: when a rule has no declaration, the
 * orchestrator treats it as `'empty'`. New rules must explicitly declare
 * before they can emit on a prospect-facing surface — `runAuditRules`'s
 * registry test enforces a declaration on every rule in `ALL_AUDIT_RULES`.
 */
export type PublicAuditBehavior = 'as-is' | 'structural-only' | 'empty';

/**
 * Structural rewrite for a finding when the rule is declared
 * `'structural-only'`. Receives the original finding and the rule context
 * (so the rewrite can read snapshot data the same way the rule itself did),
 * and returns the four PM-facing fields the prospect surface needs.
 * `evidence` returns a structured row list so the email + persisted row
 * stay parallel.
 */
export interface StructuralPublicAuditRewrite {
  title: string;
  summary: string;
  whyItMatters: string;
  evidence: AuditFindingEvidence[];
}

export interface AuditRule {
  id: string;
  category: AuditFindingCategory;
  /** Human-readable rule name for diagnostics/logging. */
  name: string;
  evaluate(ctx: AuditRuleContext): AuditFinding[];
  /**
   * Declares how this rule's findings reach the public-audit surface. See
   * `PublicAuditBehavior`. Required for every rule in `ALL_AUDIT_RULES`;
   * the registry-level test fails CI if any rule is missing one.
   */
  publicAuditBehavior?: PublicAuditBehavior;
  /**
   * Required when `publicAuditBehavior === 'structural-only'`. Rewrites
   * one finding into structural-only copy for the prospect surface. Called
   * inside `runAuditRules` after `evaluate`; the resulting rewrite is
   * applied to the finding in-place so persisted rows and the email agree.
   */
  structuralPublicAuditCopy?(
    finding: AuditFinding,
    ctx: AuditRuleContext,
  ): StructuralPublicAuditRewrite | null;
  /**
   * Per-rule template that turns one finding into 1–3 preview-ready variant
   * options. Each outer array entry is one variant; each inner array is the
   * modifications applied for that variant. Return `[]` when the finding
   * lacks the data needed to build a credible preview.
   */
  proposeModifications?(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[][];
  /**
   * Diagnosis overlay for the finding-detail surface — outlines + labels
   * drawn on the customer's own page to make the rule violation visible.
   * Unlike `proposeModifications` (which proposes a fix), these mods are
   * non-destructive visual annotations. Return `[]` when the finding lacks
   * the data needed to anchor an overlay.
   */
  proposeAnnotations?(
    finding: AuditFinding,
    ctx: ProposeModificationsContext,
  ): VariantModification[];
}

/**
 * Helper signature: turn one finding's structured evidence into a
 * recommendation paragraph. Each rule provides its own template; this
 * type just keeps signatures consistent.
 */
export type RecommendationFormatter<T> = (input: T) => string[];

// ----- response shape (used by /api/phase2/insights/run) -----

export interface AuditFindingsReport {
  findings: AuditFinding[];
  /** Rule-level diagnostics for debugging why a rule did/didn't fire. */
  diagnostics: AuditRuleDiagnostic[];
  /** True if at least one snapshot was available for grounding. */
  groundedInSnapshots: boolean;
}

export interface AuditRuleDiagnostic {
  ruleId: string;
  /** How many findings the rule emitted. */
  emitted: number;
  /** Optional reason the rule produced nothing — e.g. INSUFFICIENT_SAMPLE, NO_SNAPSHOT, NO_DEVICE_DATA. */
  skippedReason?: string;
  /** How many candidate paths/cohorts/elements the rule considered. */
  candidatesEvaluated?: number;
  /**
   * Layer 2 calibration in effect for this rule on this site, when one applied.
   * Present only when the detection floor was loosened or tightened from base.
   */
  calibration?: {
    multiplier: number;
    direction: 'loosen' | 'tighten' | 'neutral';
    reason: string;
  };
}

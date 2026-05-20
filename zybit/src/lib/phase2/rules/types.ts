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
  | 'thrash';          // return-visit loops without progression

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
  /** Human-readable formatted string ready for display, e.g. '~$1,200/month'. */
  formatted: string;
  /** Napkin-math basis so the estimate is auditable. */
  basis: string;
}

/**
 * Opinionated brief that tells the operator exactly what to change and why —
 * more specific and action-oriented than the analytical `recommendation` field.
 */
export interface AuditFindingPrescription {
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
  /** 'page-structure' renders a wireframe with a fold line; 'form-funnel' renders a funnel. */
  type: 'page-structure' | 'form-funnel';
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
    ctaRef?: string;
    elementRef?: string;
    formRef?: string;
  };
  /**
   * Layer 1 Learn metadata. Present when the re-ranker matched past outcomes
   * for this finding. `priorityScore` already reflects the `delta`; this field
   * carries the explanation + audit trail.
   */
  learnAdjustment?: LearnAdjustment;
}

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
}

export interface AuditRule {
  id: string;
  category: AuditFindingCategory;
  /** Human-readable rule name for diagnostics/logging. */
  name: string;
  evaluate(ctx: AuditRuleContext): AuditFinding[];
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
}

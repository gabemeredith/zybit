/**
 * Lighthouse public types.
 *
 * Subsystem-internal types (Persona, EventSink, RNG) live next to the code
 * that owns them (personas/, sinks/, generators/). This file holds only the
 * cross-cutting interfaces the GUI and runner pass around.
 */

export type EventSinkMode = 'direct' | 'posthog';

export interface BusinessProfile {
  mrr: number | null;
  aov: number | null;
}

export interface SiteManifest {
  slug: string;
  bucket:
    | 'saas-landing-app'
    | 'ecom'
    | 'content'
    | 'marketing-static'
    | 'spa-edge'
    | 'degraded'
    | 'synthetic';
  displayName: string;
  stack: string;
  upstreamRepo?: string;
  upstreamCommit?: string;
  localPort?: number;
  localHostname?: string;
  runCommand?: string;
  /**
   * Fully-qualified base URL the runner drives sessions + snapshots
   * against. For local OSS sites: `http://${localHostname}:${localPort}`.
   * For tunneled access: the tunnel URL. For Lighthouse-served synthetic
   * sites: the path under Lighthouse's own port.
   */
  baseUrl: string;
  primaryFunnelPaths: string[];
  /**
   * Per-path outbound transition weights for directed funnel modeling (LIGHTHOUSE.md §13 #1).
   * When a session is at path P, the driver samples the next path from
   * transitionWeights[P] instead of drawing uniformly over primaryFunnelPaths.
   * Weights need not sum to 1 — the driver normalises them. Falls back to
   * uniform persona-weighted random when the current path has no entry.
   */
  transitionWeights?: Record<string, Array<{ path: string; weight: number }>>;
  /**
   * Per-path exit hazard: probability a session ends AFTER visiting this path
   * instead of continuing to the next page (LIGHTHOUSE.md §13 #2).
   * Applied on each page visit; 0 = never exit here early, 1 = always exit.
   * Only affects sessions that still have remaining planned pages.
   */
  exitHazard?: Record<string, number>;
  expectedConversionEvent?: string;
  primaryCtaSelector?: string;
  /**
   * Selector of a CTA that simulated users will "rage click" — they click,
   * nothing useful happens, they click again. Driver emits `rage_click`
   * events tagged with the snapshot CTA's text + element_tag so the
   * `rage-click-target` rule can fire. The selector must match a CTA the
   * snapshot parser picks up. Optional: omit and no rage_click events emit.
   */
  rageCtaSelector?: string;
  /** Per-pageview probability of emitting a rage_click on the rage target. */
  rageClickRate?: number;
  /**
   * Paths where simulated users dwell long enough to register as
   * "hesitating" — driver attaches `activeSeconds≥45` to `page_view`
   * events on these paths. Feeds the `hesitation-pattern` rule.
   */
  hesitationPaths?: string[];
  /**
   * Paths whose layout is so long that users scroll less than a persona's
   * baseline (LIGHTHOUSE.md §13 #5, light version). The driver multiplies
   * the sampled scroll-depth percent by 0.5 on these paths so editorial /
   * long-scroll pages can fire `above-fold-coverage` without requiring the
   * persona mix to be bouncy. Optional.
   */
  lowScrollPaths?: string[];
  /**
   * Declared narratives for the site — "from page A, the user is supposed
   * to progress to page B." Lets rules like `return-visit-thrash` defer
   * for sessions that followed the expected progression, so a scenario
   * can be engineered to fire ONE rule cleanly instead of surfacing every
   * rule that happens to overlap with "user got stuck on this page."
   */
  narratives?: Array<{
    id: string;
    label: string;
    sourcePathRef: string;
    expectedPathRefs: string[];
  }>;
  /**
   * Per-CTA click-weight multipliers — let scenarios model intent-driven
   * clicks that diverge from visual hierarchy (the precondition for
   * `hero-hierarchy-inversion` to fire). Driver multiplies the sampled
   * CTA's visualWeight by the matching multiplier before weighted sampling.
   * Default multiplier is 1.0 — only listed CTAs deviate.
   */
  ctaIntentBoosts?: Array<{
    pathRef: string;
    selector: string;
    multiplier: number;
  }>;
  requiresTunnel: boolean;
  isSpa: boolean;
  businessProfile: BusinessProfile;
  biasNotes?: string;
}

export interface ScenarioPersonaMix {
  personaId: string;
  weight: number;
}

export interface Scenario {
  id: string;
  name: string;
  siteManifest: SiteManifest;
  personaMix: ScenarioPersonaMix[];
  defaultSessions: number;
}

export interface GenerateRequest {
  scenarioId: string;
  sessions: number;
  mode: EventSinkMode;
}

export interface GenerateProgressEvent {
  step:
    | 'crawl'
    | 'provisioning'
    | 'tunnel'
    | 'sessions'
    | 'snapshots'
    | 'insights'
    | 'experiments'
    | 'done'
    | 'error';
  message: string;
  at: string;
}

export interface GenerateResult {
  runId: string;
  scenarioId: string;
  organizationId: string;
  siteId: string;
  counts: {
    sessions: number;
    events: number;
    snapshots: number;
    findings: number;
  };
  sample: {
    events: unknown[];
    snapshots: unknown[];
    findings: unknown[];
  };
  startedAt: string;
  finishedAt: string;
  /** Synthetic experiment outcome (Lighthouse Phase 2), when one was created. */
  experiment?: {
    experimentId: string | null;
    action: 'stopped' | 'updated' | 'skipped' | 'no-finding';
    result: string | null;
    liftPct: number | null;
    confidence: number | null;
    participants: number;
    conversionEvents: number;
  };
  snapshotErrors?: Array<{ path: string; code: string; message: string }>;
  /**
   * Flow-graph advisory summary (PRD Milestone 1). Present when the insights
   * pipeline derived a non-empty graph. Confirms derivation + persistence ran.
   */
  flowGraph?: {
    nodes: number;
    edges: number;
    sessionCount: number;
    /** True when flow-inter-step-dropoff fired and named a chokepoint route. */
    flowFindingFired: boolean;
    /** The chokepoint route named by the rule, when it fired. */
    chokepointRoute?: string | null;
  };
  /**
   * Layer 2 calibration exercise result. Present when the runner seeded
   * enough prior outcomes to trigger threshold calibration and re-ran the
   * pipeline a second time. Proves the calibration mechanism works end-to-end.
   */
  layer2?: {
    calibrated: boolean;
    calibratedRuleCount: number;
    calibrationSummary: Array<{ ruleId: string; direction: string; multiplier: number }>;
  };
  /**
   * Layer B (LLM finding prose) telemetry — present when the run exercised
   * the Layer B post-pass. Carries per-finding template-vs-LLM prose pairs,
   * outcomes, tokens/cost/latency, and run aggregates. The Lighthouse GUI
   * renders this as the AI-engineering panel (Step 1b).
   */
  layerB?: import('@/lib/phase2/layerB/orchestrator').LayerBRunTelemetry;
  /**
   * URL-audit crawl summary (URL-audit mode only). Present when the run was
   * driven by `runUrlAudit` rather than a hand-authored scenario.
   */
  crawl?: {
    requestedUrl: string;
    pagesDiscovered: number;
    pagesSnapshotted: number;
  };
  /**
   * Per-page parsed-structure inspector (URL-audit mode only). Surfaces what
   * Zybit's snapshot parser extracted from each real page so the operator can
   * eyeball whether the `Understand` step "sees" the site correctly.
   */
  inspector?: Array<{
    pathRef: string;
    url: string;
    title: string | null;
    cssSystem?: string;
    ctaCount: number;
    formCount: number;
    headingCount: number;
    topCtas: Array<{
      text: string;
      visualWeight: number;
      landmark: string;
      foldGuess: string;
    }>;
  }>;
}

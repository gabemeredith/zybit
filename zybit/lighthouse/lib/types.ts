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
}

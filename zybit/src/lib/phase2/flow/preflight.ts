/**
 * Flow-graph pre-flight check.
 *
 * PRD §5 says the flow graph is only as good as the customer's analytics — if
 * pageview/route events are not coming in at usable granularity, the graph is
 * thin and the advisory falls flat. This module answers the per-customer
 * question we have to answer BEFORE promising the graph: do we already have
 * enough signal in `phase1_events` to produce an informative flow graph?
 *
 * Pure + deterministic. Takes the same `CanonicalEvent[]` the audit pipeline
 * sees; returns a readiness verdict plus PM-readable diagnostics. The intent
 * is to be the source of truth for both the onboarding "you're connected"
 * verification UI and any later sales/ops pre-pilot checklist script.
 *
 * Thresholds intentionally mirror the gates the flow-inter-step-dropoff rule
 * actually uses (`flowInterStepDropoff.ts`): if a customer is below those
 * thresholds, the rule will not fire and the /app/flow view will be sparse.
 */

import { normalizeRoute } from './normalizeRoute';
import type { CanonicalEvent } from '@/lib/phase2/types';

/** Match `flowInterStepDropoff.MIN_GRAPH_SESSIONS`. */
export const PREFLIGHT_MIN_SESSIONS = 50;
/** A useful graph has at least this many distinct routes (else it's one node). */
export const PREFLIGHT_MIN_ROUTES = 3;
/** A flow needs at least one transition edge to be a flow at all. */
export const PREFLIGHT_MIN_TRANSITIONS = 1;

export type PreflightStatus = 'ready' | 'thin' | 'empty';

export interface PreflightSignals {
  /** Total raw events seen in the window. */
  totalEvents: number;
  /** Events whose `path` is non-empty after trim. */
  eventsWithPath: number;
  /** Events whose `sessionId` is non-empty. */
  eventsWithSession: number;
  /** Distinct sessions observed (any path). */
  distinctSessions: number;
  /** Sessions that touched at least 2 distinct normalized routes — the ones that produce edges. */
  sessionsWithTransitions: number;
  /** Distinct normalized routes (post `normalizeRoute`). */
  distinctRoutes: number;
  /** Total session-to-session transitions (edges before dedupe). */
  totalTransitions: number;
}

export interface PreflightDiagnostic {
  /** Stable machine-readable code for log/test assertions. */
  code:
    | 'no-events'
    | 'session-id-missing'
    | 'path-missing'
    | 'single-route'
    | 'few-routes'
    | 'low-sessions'
    | 'no-transitions'
    | 'ready';
  /** PM-readable, complete sentence. No engineer jargon. */
  message: string;
  /** Tone — drives the badge colour in UI. */
  severity: 'info' | 'warn' | 'block';
}

export interface PreflightReport {
  status: PreflightStatus;
  windowStart: string;
  windowEnd: string;
  signals: PreflightSignals;
  diagnostics: PreflightDiagnostic[];
}

export interface ComputeFlowPreflightArgs {
  events: CanonicalEvent[];
  windowStart: string;
  windowEnd: string;
}

export function computeFlowPreflight(args: ComputeFlowPreflightArgs): PreflightReport {
  const { events, windowStart, windowEnd } = args;

  const signals: PreflightSignals = {
    totalEvents: events.length,
    eventsWithPath: 0,
    eventsWithSession: 0,
    distinctSessions: 0,
    sessionsWithTransitions: 0,
    distinctRoutes: 0,
    totalTransitions: 0,
  };

  // Per-session ordered route arrivals (consecutive same-route collapsed,
  // mirroring deriveFlowGraph). Sessions without an id are ignored for graph
  // purposes — they cannot be reconstructed into a flow even if Path exists.
  const sessionRoutes = new Map<string, string[]>();
  const distinctRoutes = new Set<string>();

  for (const ev of events) {
    const hasPath = typeof ev.path === 'string' && ev.path.trim().length > 0;
    const hasSession = typeof ev.sessionId === 'string' && ev.sessionId.trim().length > 0;
    if (hasPath) signals.eventsWithPath += 1;
    if (hasSession) signals.eventsWithSession += 1;
    if (!hasPath || !hasSession) continue;

    const route = normalizeRoute(ev.path);
    distinctRoutes.add(route);
    let arrivals = sessionRoutes.get(ev.sessionId);
    if (!arrivals) {
      arrivals = [route];
      sessionRoutes.set(ev.sessionId, arrivals);
    } else if (arrivals[arrivals.length - 1] !== route) {
      arrivals.push(route);
    }
  }

  signals.distinctSessions = sessionRoutes.size;
  signals.distinctRoutes = distinctRoutes.size;
  for (const arrivals of sessionRoutes.values()) {
    if (arrivals.length >= 2) {
      signals.sessionsWithTransitions += 1;
      signals.totalTransitions += arrivals.length - 1;
    }
  }

  const diagnostics: PreflightDiagnostic[] = [];
  let status: PreflightStatus;

  if (signals.totalEvents === 0) {
    status = 'empty';
    diagnostics.push({
      code: 'no-events',
      message:
        'We have not received any events from this connector in the selected window. Confirm the integration is enabled and that page views are being captured.',
      severity: 'block',
    });
    return { status, windowStart, windowEnd, signals, diagnostics };
  }

  // Diagnostics fire in priority order so the PM sees the most actionable
  // problem first. They are NOT exclusive — a connector can simultaneously
  // miss session ids AND only emit one route.
  const sessionCoverage = signals.eventsWithSession / signals.totalEvents;
  if (sessionCoverage < 0.5) {
    diagnostics.push({
      code: 'session-id-missing',
      message:
        'Most events arrive without a session id. Without it we cannot reconstruct user journeys. Check that your analytics SDK is forwarding a stable session identifier on every page view.',
      severity: 'block',
    });
  }

  const pathCoverage = signals.eventsWithPath / signals.totalEvents;
  if (pathCoverage < 0.5) {
    diagnostics.push({
      code: 'path-missing',
      message:
        'Most events do not carry a URL path. Page views need a `path` (or `$current_url`) property to map onto the flow graph.',
      severity: 'block',
    });
  }

  if (signals.distinctRoutes <= 1) {
    diagnostics.push({
      code: 'single-route',
      message:
        'Events for only one page reached us. The flow graph needs at least three distinct routes to show how users move between pages.',
      severity: 'warn',
    });
  } else if (signals.distinctRoutes < PREFLIGHT_MIN_ROUTES) {
    diagnostics.push({
      code: 'few-routes',
      message: `Only ${signals.distinctRoutes} distinct pages reached us. The flow graph becomes informative once at least ${PREFLIGHT_MIN_ROUTES} routes are flowing through it.`,
      severity: 'warn',
    });
  }

  if (signals.totalTransitions < PREFLIGHT_MIN_TRANSITIONS) {
    diagnostics.push({
      code: 'no-transitions',
      message:
        'No session navigated between two pages in this window. Either the integration only fires on a single page, or sessions are not being stitched across page views.',
      severity: 'warn',
    });
  }

  if (signals.distinctSessions < PREFLIGHT_MIN_SESSIONS) {
    diagnostics.push({
      code: 'low-sessions',
      message: `Only ${signals.distinctSessions} sessions in this window. The flow-aware audit rule needs at least ${PREFLIGHT_MIN_SESSIONS} sessions before it will surface findings; you will see the graph but not the ranked drop-offs yet.`,
      severity: 'warn',
    });
  }

  const blockers = diagnostics.filter((d) => d.severity === 'block');
  const warnings = diagnostics.filter((d) => d.severity === 'warn');

  if (blockers.length > 0) {
    status = 'empty';
  } else if (
    warnings.length === 0 &&
    signals.distinctSessions >= PREFLIGHT_MIN_SESSIONS &&
    signals.distinctRoutes >= PREFLIGHT_MIN_ROUTES &&
    signals.totalTransitions >= PREFLIGHT_MIN_TRANSITIONS
  ) {
    status = 'ready';
    diagnostics.push({
      code: 'ready',
      message: `Connected — ${signals.distinctSessions} sessions across ${signals.distinctRoutes} routes in the last window. Your flow graph is ready.`,
      severity: 'info',
    });
  } else {
    status = 'thin';
  }

  return { status, windowStart, windowEnd, signals, diagnostics };
}

/**
 * PostHog-shaped event overlay for the /demo surface.
 *
 * `runUrlAudit` emits a snapshot-grounded synthetic layer
 * (`source='posthog'` via DirectEventSink) that's enough for the rule
 * engine to fire findings. That layer reads as "audit traffic" though:
 * exactly 80 sessions per page, deterministic timestamps clustered
 * inside a 200s spread. The cockpit's "this week" stats look wrong.
 *
 * This module overlays a second event layer that reads as 14 days of
 * real PostHog traffic — sessions distributed across the window, a
 * realistic event mix per session (pageview → scroll → click → maybe
 * convert), and `zybit_vid`-keyed sessions for the running experiment
 * so `BridgeHealth` joins green. Pure function over the audit's own
 * pages + a deterministic RNG seed.
 *
 * Designed to coexist with the audit's grounded layer: never re-emits
 * the audit's `sourceEventId`s, so the dedupe index does not collide.
 */

import { randomUUID } from 'node:crypto';
import type { CanonicalEventInput } from '@/lib/phase2/types';

export interface OverlayPage {
  pathRef: string;
  /** Display weight — homepage gets ~40% of traffic, pricing ~20%, deep pages thinner. */
  trafficShare: number;
}

export interface BuildOverlayOpts {
  siteId: string;
  pages: OverlayPage[];
  /** Anchor time; events spread back 14 days from here. */
  now: number;
  /**
   * Experiment id assigned to a fraction of sessions. When set, the
   * overlay emits paired `experiment_assignment` + conversion events
   * keyed by the same `sessionId` so `deriveBridgeHealth` registers as
   * healthy and the cockpit doesn't flag the bridge.
   */
  runningExperimentId?: string;
}

/** Bounded PRNG so the overlay is reproducible across re-runs. */
function rng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;
const TARGET_SESSIONS = 3_400;

const CONTENT_CLICK_TARGETS: Record<string, string[]> = {
  '/': ['hero-primary', 'hero-secondary', 'pricing-link', 'docs-link', 'signup-bottom'],
  '/pricing': ['plan-pro', 'plan-team', 'plan-free', 'contact-sales'],
  '/signup': ['oauth-github', 'oauth-google', 'email-submit'],
};

function clickTargetsFor(pathRef: string): string[] {
  return CONTENT_CLICK_TARGETS[pathRef] ?? ['primary-cta'];
}

/**
 * Build the overlay event stream. Returns `CanonicalEventInput[]` ready
 * to push through `DirectEventSink({ defaultSource: 'posthog' })`.
 */
export function buildPostHogOverlay(opts: BuildOverlayOpts): CanonicalEventInput[] {
  const { siteId, pages, now, runningExperimentId } = opts;
  if (pages.length === 0) return [];

  const totalShare = pages.reduce((acc, p) => acc + Math.max(p.trafficShare, 0), 0) || 1;
  const events: CanonicalEventInput[] = [];
  const r = rng(`overlay|${siteId}`);

  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const windowSpan = WINDOW_DAYS * DAY_MS;

  for (let i = 0; i < TARGET_SESSIONS; i++) {
    const sessionId = `vid_${randomUUID().slice(0, 12)}_${i.toString(36)}`;

    const pageRoll = r() * totalShare;
    let acc = 0;
    let page = pages[0];
    for (const candidate of pages) {
      acc += Math.max(candidate.trafficShare, 0);
      if (pageRoll <= acc) {
        page = candidate;
        break;
      }
    }
    const path = page.pathRef;
    const sessionStart = windowStart + Math.floor(r() * windowSpan);
    const stamp = (offsetMs: number): string =>
      new Date(sessionStart + offsetMs).toISOString();

    events.push({
      siteId,
      sessionId,
      type: 'pageview',
      path,
      occurredAt: stamp(0),
      source: 'posthog',
      sourceEventId: `overlay_pv_${sessionId}`,
      anonymousId: sessionId,
      properties: { utm_source: r() < 0.3 ? 'twitter' : r() < 0.5 ? 'google' : null },
    });

    const scrollDepth = Math.round(20 + r() * 80);
    events.push({
      siteId,
      sessionId,
      type: 'scroll',
      path,
      occurredAt: stamp(4_000 + Math.floor(r() * 12_000)),
      source: 'posthog',
      sourceEventId: `overlay_sc_${sessionId}`,
      metrics: { depth_pct: scrollDepth },
    });

    if (r() < 0.65) {
      const targets = clickTargetsFor(path);
      const target = targets[Math.floor(r() * targets.length)];
      events.push({
        siteId,
        sessionId,
        type: 'click',
        path,
        occurredAt: stamp(8_000 + Math.floor(r() * 30_000)),
        source: 'posthog',
        sourceEventId: `overlay_ck_${sessionId}`,
        properties: { target },
      });
    }

    if (r() < 0.06) {
      events.push({
        siteId,
        sessionId,
        type: 'rage_click',
        path,
        occurredAt: stamp(15_000 + Math.floor(r() * 25_000)),
        source: 'posthog',
        sourceEventId: `overlay_rg_${sessionId}`,
      });
    }

    const willConvert = r() < 0.044;
    if (willConvert) {
      events.push({
        siteId,
        sessionId,
        type: 'conversion',
        path: '/signup',
        occurredAt: stamp(40_000 + Math.floor(r() * 90_000)),
        source: 'posthog',
        sourceEventId: `overlay_cv_${sessionId}`,
        metrics: { conversion: 1 },
      });
    }

    if (runningExperimentId && (path === '/' || path === '/pricing')) {
      const bucket = r() < 0.5 ? 'control' : 'variant';
      events.push({
        siteId,
        sessionId,
        type: 'experiment_assignment',
        path,
        occurredAt: stamp(500),
        source: 'posthog',
        sourceEventId: `overlay_as_${sessionId}_${runningExperimentId}`,
        properties: { experimentId: runningExperimentId, bucket },
      });
      const variantLift = bucket === 'variant' ? 0.013 : 0;
      if (r() < 0.044 + variantLift && !willConvert) {
        events.push({
          siteId,
          sessionId,
          type: 'conversion',
          path: '/signup',
          occurredAt: stamp(45_000 + Math.floor(r() * 80_000)),
          source: 'posthog',
          sourceEventId: `overlay_cv2_${sessionId}_${runningExperimentId}`,
          metrics: { conversion: 1 },
        });
      }
    }
  }

  return events;
}

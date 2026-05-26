/**
 * Test fixtures for Phase 2 audit rule tests.
 * Factory functions that build valid mock objects with sensible defaults.
 */

import type { CanonicalEvent, GoalConfig, GoalType, Phase2SiteConfig, TimeWindow } from '@/lib/phase2/types';
import type { CtaCandidate, FormCandidate, FormInputItem, ImageItem, PageSnapshot, PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { AuditRuleContext } from '@/lib/phase2/rules/types';

let _counter = 0;
function uid(): string {
  _counter += 1;
  return `id-${_counter}`;
}

// -----------------------------------------------------------------------
// CanonicalEvent factories
// -----------------------------------------------------------------------

export function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    id: uid(),
    organizationId: 'org-test',
    siteId: 'site-test',
    sessionId: `session-${uid()}`,
    type: 'page_view',
    path: '/',
    occurredAt: '2026-01-15T12:00:00Z',
    createdAt: '2026-01-15T12:00:00Z',
    source: 'api',
    schemaVersion: 2,
    ...overrides,
  };
}

export function makePageView(
  path: string,
  sessionId: string,
  options: {
    scrollFraction?: number;
    referrer?: string;
    deviceType?: string;
    activeSeconds?: number;
    occurredAt?: string;
  } = {},
): CanonicalEvent {
  const metrics: Record<string, number> = {};
  if (options.scrollFraction !== undefined) {
    metrics.scrollPctNormalized = options.scrollFraction;
  }
  if (options.activeSeconds !== undefined) {
    metrics.activeSeconds = options.activeSeconds;
  }
  const properties: Record<string, string | number | boolean | null> = {};
  if (options.referrer !== undefined) properties.referrer = options.referrer;
  if (options.deviceType !== undefined) properties.device_type = options.deviceType;

  return makeEvent({
    type: 'page_view',
    path,
    sessionId,
    metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    occurredAt: options.occurredAt ?? '2026-01-15T12:00:00Z',
  });
}

export function makeRageClick(
  path: string,
  targetText: string,
  sessionId: string,
  options: { targetRef?: string; elementTag?: string; elementClasses?: string } = {},
): CanonicalEvent {
  return makeEvent({
    type: 'rage_click',
    path,
    sessionId,
    properties: {
      rage_target_text: targetText,
      ...(options.targetRef ? { rage_target_ref: options.targetRef } : {}),
      ...(options.elementTag ? { element_tag: options.elementTag } : {}),
      ...(options.elementClasses ? { element_classes: options.elementClasses } : {}),
    },
  });
}

export function makeErrorEvent(
  path: string,
  errorType: string,
  message: string,
  sessionId: string,
  options: { handled?: boolean; errorSource?: string } = {},
): CanonicalEvent {
  return makeEvent({
    type: 'error',
    path,
    sessionId,
    properties: {
      error_type: errorType,
      error_message: message,
      ...(options.handled !== undefined ? { error_handled: options.handled } : {}),
      ...(options.errorSource ? { error_source: options.errorSource } : {}),
    },
  });
}

export function makeCtaClick(
  path: string,
  ctaText: string,
  sessionId: string,
  options: { elementRole?: string; occurredAt?: string } = {},
): CanonicalEvent {
  return makeEvent({
    type: 'cta_click',
    path,
    sessionId,
    properties: {
      cta_text: ctaText,
      ...(options.elementRole ? { element_role: options.elementRole } : {}),
    },
    occurredAt: options.occurredAt,
  });
}

export function makeFormSubmit(path: string, sessionId: string): CanonicalEvent {
  return makeEvent({
    type: 'form_submit',
    path,
    sessionId,
  });
}

/** Build N events for the same session with consistent sessionId */
export function makeSession(
  path: string,
  eventCount: number,
  sessionId?: string,
): CanonicalEvent[] {
  const sid = sessionId ?? `session-${uid()}`;
  const events: CanonicalEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    events.push(makePageView(path, sid, { scrollFraction: 0.5 }));
  }
  return events;
}

// -----------------------------------------------------------------------
// Snapshot factories
// -----------------------------------------------------------------------

export function makeCta(
  text: string,
  visualWeight: number,
  foldGuess: 'above' | 'uncertain' | 'below',
  ref?: string,
): CtaCandidate {
  return {
    ref: ref ?? `cta-${uid()}`,
    cssSelector: null,
    tag: 'button',
    text,
    href: null,
    ariaLabel: null,
    landmark: 'main',
    visualWeight,
    visualWeightSignals: visualWeight > 0.7 ? ['btn-primary', 'bg-blue-600'] : ['btn-secondary'],
    foldGuess,
    domDepth: 3,
    documentIndex: 0,
    disabled: false,
  };
}

export function makeLink(
  text: string,
  href: string,
  foldGuess: 'above' | 'uncertain' | 'below' = 'above',
  ref?: string,
): CtaCandidate {
  return {
    ref: ref ?? `link-${uid()}`,
    cssSelector: null,
    tag: 'a',
    text,
    href,
    ariaLabel: null,
    landmark: 'main',
    visualWeight: 0.3,
    visualWeightSignals: [],
    foldGuess,
    domDepth: 3,
    documentIndex: 0,
    disabled: false,
  };
}

export function makeForm(
  ref: string,
  inputs: Array<{ name: string; required: boolean; labelText?: string; type?: string }>,
  landmark: 'main' | 'header' | 'nav' | 'aside' | 'footer' | 'dialog' | 'unknown' = 'main',
): FormCandidate {
  const formInputs: FormInputItem[] = inputs.map((inp) => ({
    type: inp.type ?? 'text',
    name: inp.name,
    required: inp.required,
    labelText: inp.labelText ?? inp.name,
  }));
  return {
    ref,
    cssSelector: null,
    landmark,
    fieldCount: inputs.length,
    inputs: formInputs,
    documentIndex: 0,
    hasSubmitButton: true,
  };
}

export function makeImage(
  src: string,
  options: { alt?: string | null; hasAlt?: boolean; isCtaChild?: boolean } = {},
): ImageItem {
  const hasAlt = options.hasAlt ?? options.alt !== undefined;
  return {
    src,
    alt: options.alt ?? null,
    hasAlt,
    width: null,
    height: null,
    isCtaChild: options.isCtaChild ?? false,
    documentIndex: 0,
  };
}

export function makeSnapshot(
  pathRef: string,
  ctas: CtaCandidate[],
  headings: Array<{ level: 1 | 2 | 3; text: string }> = [],
  forms: FormCandidate[] = [],
  images: ImageItem[] = [],
  metaOverrides: Partial<PageSnapshotData['meta']> = {},
): PageSnapshot {
  const data: PageSnapshotData = {
    schemaVersion: 1,
    meta: {
      title: `Page: ${pathRef}`,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      description: null,
      canonical: null,
      lang: 'en',
      charset: 'utf-8',
      themeColor: null,
      viewport: 'width=device-width',
      robotsMeta: null,
      ...metaOverrides,
    },
    headings: headings.map((h, i) => ({ level: h.level, text: h.text, documentIndex: i, cssSelector: null })),
    ctas,
    forms,
    images,
    contentHash: `hash-${uid()}`,
    rawByteSize: 50_000,
    parsedAt: '2026-01-15T12:00:00Z',
  };
  return {
    id: `snapshot-${uid()}`,
    organizationId: 'org-test',
    siteId: 'site-test',
    pathRef,
    url: `https://example.com${pathRef}`,
    data,
    fetchedAt: new Date('2026-01-15T12:00:00Z'),
    createdAt: new Date('2026-01-15T12:00:00Z'),
  };
}

// -----------------------------------------------------------------------
// Config factories
// -----------------------------------------------------------------------

export const DEFAULT_WINDOW: TimeWindow = {
  start: '2026-01-01T00:00:00Z',
  end: '2026-01-31T00:00:00Z',
};

export function makeGoalConfig(
  goalType: GoalType,
  overrides: GoalConfig = {},
): Phase2SiteConfig {
  const goalConfigMap: Record<GoalType, GoalConfig> = {
    revenue: { arpu: 47, currencyCode: 'USD', baselineConversionRate: 0.03, ...overrides },
    ecommerce: { aov: 120, currencyCode: 'USD', baselineConversionRate: 0.03, ...overrides },
    growth: { conversionLabel: 'signups', baselineConversionRate: 0.05, ...overrides },
    engagement: { ...overrides },
    custom: {
      customMetricLabel: 'donations',
      customMetricValue: 10,
      baselineConversionRate: 0.02,
      ...overrides,
    },
  };
  return makeConfig({ goalType, goalConfig: goalConfigMap[goalType] });
}

export function makeConfig(overrides: Partial<Phase2SiteConfig> = {}): Phase2SiteConfig {
  return {
    siteId: 'site-test',
    organizationId: 'org-test',
    cohortDimensions: [],
    onboardingSteps: [],
    ctas: [],
    narratives: [],
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// AuditRuleContext factory
// -----------------------------------------------------------------------

export function makeContext(
  events: CanonicalEvent[],
  snapshots: PageSnapshot[] = [],
  config?: Phase2SiteConfig,
): AuditRuleContext {
  const snapshotMap = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    snapshotMap.set(s.pathRef, s);
  }
  return {
    organizationId: 'org-test',
    siteId: 'site-test',
    window: DEFAULT_WINDOW,
    config: config ?? makeConfig(),
    events,
    rollup: {
      insightInput: {
        siteId: 'site-test',
        totals: { sessions: events.length, events: events.length, windows: 1 } as never,
        cohorts: [],
        ctas: [],
        narratives: [],
        onboarding: [],
        deadEnds: [],
      },
      diagnostics: {
        windowDurationMs: 30 * 24 * 60 * 60 * 1000,
        totalEvents: events.length,
        uniqueSessions: new Set(events.map((e) => e.sessionId)).size,
        perCategory: {
          cohorts: { assignments: 0, cohortCount: 0 },
          narratives: { matched: 0, configured: 0 },
          onboarding: { matched: 0, configured: 0 },
          ctas: { clicks: 0, configured: 0 },
          deadEnds: { pages: 0 },
        },
        sources: ['api'],
        sourceCounts: [{ source: 'api', events: events.length }],
      },
    },
    pageSnapshotsByPath: snapshotMap,
    pageSnapshots: snapshots,
  };
}

// -----------------------------------------------------------------------
// Batch helpers
// -----------------------------------------------------------------------

/**
 * Build a set of high-scroll page_view events above the MIN threshold for aboveFoldCoverage.
 * scrollFraction=0.9 so none of them trigger the "low scroll" condition.
 */
export function makeHighScrollViews(path: string, count: number): CanonicalEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makePageView(path, `session-hs-${i}`, { scrollFraction: 0.9 }),
  );
}

/**
 * Build a set of low-scroll page_view events: scrollFraction < 0.4
 */
export function makeLowScrollViews(path: string, count: number): CanonicalEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makePageView(path, `session-ls-${i}`, { scrollFraction: 0.2 }),
  );
}

import { describe, expect, it } from 'vitest';
import type { CtaCandidate, PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { generateGroundedEvents, type GroundedPage } from './groundedEvents';

function makeCta(overrides: Partial<CtaCandidate> = {}): CtaCandidate {
  return {
    ref: `ref-${overrides.text ?? 'cta'}-${overrides.documentIndex ?? 0}`,
    cssSelector: null,
    tag: 'a',
    text: 'Buy now',
    href: '/x',
    ariaLabel: null,
    landmark: 'main',
    visualWeight: 0.5,
    visualWeightSignals: [],
    foldGuess: 'above',
    domDepth: 3,
    documentIndex: 0,
    disabled: false,
    ...overrides,
  };
}

function makeSnapshot(ctas: CtaCandidate[]): PageSnapshotData {
  return {
    schemaVersion: 1,
    meta: {
      title: 'Test page',
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      description: null,
      canonical: null,
      lang: null,
      charset: null,
      themeColor: null,
      viewport: null,
      robotsMeta: null,
    },
    headings: [],
    ctas,
    forms: [],
    contentHash: 'hash',
    rawByteSize: 1000,
    parsedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  };
}

const pages: GroundedPage[] = [
  {
    pathRef: '/pricing',
    data: makeSnapshot([
      makeCta({ text: 'Start free trial', documentIndex: 0, visualWeight: 0.3 }),
      makeCta({ text: 'Contact sales', documentIndex: 1, visualWeight: 0.9 }),
      makeCta({ text: 'Home', landmark: 'header', documentIndex: 2 }),
      makeCta({ text: 'Pricing', landmark: 'header', documentIndex: 3 }),
    ]),
  },
];

describe('generateGroundedEvents', () => {
  it('emits one page_view per synthetic session, each carrying a scroll metric', () => {
    const events = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    const pageViews = events.filter((e) => e.type === 'page_view');
    expect(pageViews.length).toBe(80);
    expect(
      pageViews.every((e) => typeof e.metrics?.scrollPctNormalized === 'number'),
    ).toBe(true);
  });

  it('lands a majority of pageviews below the 40% fold line', () => {
    const events = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    const pageViews = events.filter((e) => e.type === 'page_view');
    const belowFold = pageViews.filter(
      (e) => Number(e.metrics?.scrollPctNormalized) < 0.4,
    ).length;
    expect(belowFold / pageViews.length).toBeGreaterThan(0.5);
  });

  it('grounds cta_click events in the real extracted CTA text', () => {
    const events = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    const clicks = events.filter((e) => e.type === 'cta_click');
    expect(clicks.length).toBeGreaterThanOrEqual(30);
    const known = new Set(['Start free trial', 'Contact sales', 'Home', 'Pricing']);
    expect(clicks.every((e) => known.has(String(e.properties?.cta_text)))).toBe(true);
  });

  it('tags nav-landmark clicks with element_role=nav', () => {
    const events = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    const navClicks = events.filter((e) => e.properties?.element_role === 'nav');
    expect(navClicks.length).toBeGreaterThan(0);
    expect(
      navClicks.every((e) => ['Home', 'Pricing'].includes(String(e.properties?.cta_text))),
    ).toBe(true);
  });

  it('emits zero rage_click events — rage is PostHog-grounded signal, not synthesizable', () => {
    // Pre-fix the generator fired ~8%/session, producing ~6+ rage events per
    // page that fed `rage-click-target` and surfaced as fabricated finding
    // counts. The public audit blocklisted the rule downstream; this kills
    // the leak at the source so no surface can ever see synthetic rage data.
    const events = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    expect(events.filter((e) => e.type === 'rage_click').length).toBe(0);
  });

  it('is deterministic across runs with identical input', () => {
    const a = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    const b = generateGroundedEvents({ siteId: 's', pages, baseTime: 1_000 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('emits pageviews but no clicks for a page with no CTAs', () => {
    const empty: GroundedPage[] = [{ pathRef: '/bare', data: makeSnapshot([]) }];
    const events = generateGroundedEvents({ siteId: 's', pages: empty, baseTime: 1_000 });
    expect(events.filter((e) => e.type === 'page_view').length).toBe(80);
    expect(events.filter((e) => e.type === 'cta_click').length).toBe(0);
    expect(events.filter((e) => e.type === 'rage_click').length).toBe(0);
  });
});

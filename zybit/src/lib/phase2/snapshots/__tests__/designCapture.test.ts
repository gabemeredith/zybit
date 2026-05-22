import { describe, expect, it } from 'vitest';
import type { PageCapture } from '@/lib/phase2/capture/types';
import {
  buildFullDesignSnapshot,
  buildStructuralDesignSnapshot,
  ctaStylesKey,
  designSnapshotId,
  headingStylesKey,
  PAGE_STYLES_KEY,
  shouldUpsertStructural,
} from '../designCapture';

const FIXED_CAPTURE_TIME = '2026-05-21T00:00:00.000Z';
const SITE = 'site_abc';
const ORG = 'org_acme';
const PATH = '/pricing';

function makeCapture(overrides: Partial<PageCapture> = {}): PageCapture {
  const base: PageCapture = {
    schemaVersion: 1,
    siteId: SITE,
    pathRef: PATH,
    finalUrl: `https://woven.example.com${PATH}`,
    capturedAt: FIXED_CAPTURE_TIME,
    breakpoint: 'desktop',
    cohort: 'logged_out',
    contentHash: 'sha_hash_value',
    renderedHtml: '<html></html>',
    meta: {
      title: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      description: null,
      canonical: null,
      lang: null,
      viewport: null,
    },
    headings: [
      {
        level: 1,
        text: 'Hero',
        documentIndex: 0,
        bbox: { x: 0, y: 0, width: 800, height: 60 },
        fontSizePx: 48,
        colorHex: '#111827',
      },
    ],
    ctas: [
      {
        ref: 'cta_hero_primary',
        cssSelector: 'button.cta-primary',
        tag: 'button',
        text: 'Get started',
        href: null,
        ariaLabel: null,
        landmark: 'header',
        visualWeight: 0.9,
        visualWeightSignals: ['primary', 'large'],
        foldGuess: 'above',
        domDepth: 4,
        documentIndex: 0,
        disabled: false,
        bbox: { x: 100, y: 200, width: 200, height: 48 },
        bgColorHex: '#1a56db',
        fgColorHex: '#ffffff',
      },
    ],
    forms: [],
    fold: { viewportPx: { w: 1440, h: 900 }, foldY: 720 },
    metrics: { lcpMs: null, inpMs: null, cls: null, ttfbMs: null },
    network: { totalRequests: 0, totalBytes: 0, p95LatencyMs: 0, thirdPartyDomains: [] },
    errors: [],
    consoleMessages: [],
    assets: { screenshotBlobUrl: 'https://blob.vercel/captures/site_abc/_pricing/desktop/run.png', harBlobUrl: null },
    costUsd: 0.005,
  };
  return { ...base, ...overrides };
}

describe('designSnapshotId', () => {
  it('produces the same id for the same (siteId, pathRef)', () => {
    expect(designSnapshotId(SITE, PATH)).toBe(designSnapshotId(SITE, PATH));
  });
  it('produces different ids for different inputs', () => {
    expect(designSnapshotId(SITE, '/')).not.toBe(designSnapshotId(SITE, '/pricing'));
    expect(designSnapshotId(SITE, '/')).not.toBe(designSnapshotId('other_site', '/'));
  });
  it('starts with the dsn_ prefix', () => {
    expect(designSnapshotId(SITE, PATH).startsWith('dsn_')).toBe(true);
  });
});

describe('buildFullDesignSnapshot', () => {
  it('produces a full-mode row with screenshot and computed styles', () => {
    const row = buildFullDesignSnapshot({
      organizationId: ORG,
      capture: makeCapture(),
      cssSystem: 'tailwind',
    });

    expect(row.captureMethod).toBe('full');
    expect(row.organizationId).toBe(ORG);
    expect(row.siteId).toBe(SITE);
    expect(row.pathRef).toBe(PATH);
    expect(row.screenshotUrl).toBe('https://blob.vercel/captures/site_abc/_pricing/desktop/run.png');
    expect(row.cssSystem).toBe('tailwind');
    expect(row.designTokens).toBeNull();
    expect(row.capturedAt.toISOString()).toBe(FIXED_CAPTURE_TIME);
  });

  it('keys CTA styles by ref under the cta:<ref> key', () => {
    const row = buildFullDesignSnapshot({
      organizationId: ORG,
      capture: makeCapture(),
      cssSystem: null,
    });
    const styles = row.computedStyles as Record<string, Record<string, unknown>>;
    const ctaEntry = styles[ctaStylesKey('cta_hero_primary')];
    expect(ctaEntry).toMatchObject({
      selector: 'button.cta-primary',
      backgroundColor: '#1a56db',
      color: '#ffffff',
      boundingBox: { x: 100, y: 200, width: 200, height: 48 },
    });
  });

  it('keys heading styles by level + documentIndex', () => {
    const row = buildFullDesignSnapshot({
      organizationId: ORG,
      capture: makeCapture(),
      cssSystem: null,
    });
    const styles = row.computedStyles as Record<string, Record<string, unknown>>;
    const headingEntry = styles[headingStylesKey(1, 0)];
    expect(headingEntry).toMatchObject({
      color: '#111827',
      fontSize: '48px',
      boundingBox: { x: 0, y: 0, width: 800, height: 60 },
    });
  });

  it('writes page-level styles under _page when context is provided', () => {
    const row = buildFullDesignSnapshot({
      organizationId: ORG,
      capture: makeCapture(),
      cssSystem: null,
      pageDesignContext: { backgroundColor: '#fafafa', color: '#1f2937' },
    });
    const styles = row.computedStyles as Record<string, Record<string, unknown>>;
    expect(styles[PAGE_STYLES_KEY]).toEqual({ backgroundColor: '#fafafa', color: '#1f2937' });
  });

  it('skips CTAs with no ref', () => {
    const capture = makeCapture({
      ctas: [{ ...makeCapture().ctas[0], ref: '' }],
    });
    const row = buildFullDesignSnapshot({ organizationId: ORG, capture, cssSystem: null });
    expect(row.computedStyles).not.toHaveProperty(ctaStylesKey(''));
  });
});

describe('buildStructuralDesignSnapshot', () => {
  it('produces a structural-mode row with null screenshot and styles', () => {
    const row = buildStructuralDesignSnapshot({
      organizationId: ORG,
      siteId: SITE,
      pathRef: PATH,
      cssSystem: 'styled-components',
    });
    expect(row.captureMethod).toBe('structural');
    expect(row.screenshotUrl).toBeNull();
    expect(row.computedStyles).toBeNull();
    expect(row.designTokens).toBeNull();
    expect(row.cssSystem).toBe('styled-components');
  });

  it('uses the supplied capturedAt when given', () => {
    const at = new Date('2026-01-01T12:00:00Z');
    const row = buildStructuralDesignSnapshot({
      organizationId: ORG,
      siteId: SITE,
      pathRef: PATH,
      cssSystem: null,
      capturedAt: at,
    });
    expect(row.capturedAt).toBe(at);
  });

  it('shares the same id as a full snapshot for the same (siteId, pathRef)', () => {
    const structural = buildStructuralDesignSnapshot({
      organizationId: ORG,
      siteId: SITE,
      pathRef: PATH,
      cssSystem: null,
    });
    const full = buildFullDesignSnapshot({
      organizationId: ORG,
      capture: makeCapture(),
      cssSystem: null,
    });
    expect(structural.id).toBe(full.id);
  });
});

describe('shouldUpsertStructural — no-downgrade gate', () => {
  const now = new Date('2026-05-21T12:00:00Z');

  it('upserts when no row exists', () => {
    expect(shouldUpsertStructural(null, now)).toBe(true);
  });

  it('refuses to downgrade a fresh `full` row', () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    expect(shouldUpsertStructural({ captureMethod: 'full', capturedAt: oneHourAgo }, now)).toBe(false);
  });

  it('refuses to downgrade an ancient `full` row', () => {
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    expect(shouldUpsertStructural({ captureMethod: 'full', capturedAt: yearAgo }, now)).toBe(false);
  });

  it('upserts when prior structural row is older than 24h', () => {
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(
      shouldUpsertStructural({ captureMethod: 'structural', capturedAt: twentyFiveHoursAgo }, now),
    ).toBe(true);
  });

  it('does not upsert when prior structural row is younger than 24h', () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    expect(
      shouldUpsertStructural({ captureMethod: 'structural', capturedAt: oneHourAgo }, now),
    ).toBe(false);
  });
});

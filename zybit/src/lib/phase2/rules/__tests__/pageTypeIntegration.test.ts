/**
 * Integration tests: every rule that consumes `visualSignals.pageType`
 * must honor the modulation table (see `pageTypeModulation.ts`).
 *
 * This test is the contract: if a new pageType-consumer rule is added,
 * add a case here so a regression in the rule's modulation wiring is
 * caught in CI. The cases below mirror the cardinal entries from the
 * modulation table — one suppression and one threshold-modulation case
 * per rule.
 */

import { describe, it, expect } from 'vitest';
import { aboveFoldCoverage } from '@/lib/phase2/rules/aboveFoldCoverage';
import { navDispersion } from '@/lib/phase2/rules/navDispersion';
import { linkTextGeneric } from '@/lib/phase2/rules/linkTextGeneric';
import { headingHierarchyJump } from '@/lib/phase2/rules/headingHierarchyJump';
import { missingMetaDescription } from '@/lib/phase2/rules/missingMetaDescription';
import { missingCanonicalUrl } from '@/lib/phase2/rules/missingCanonicalUrl';
import type { PageType, VisualSignals } from '@/lib/phase2/snapshots/types';
import {
  makeContext,
  makeCta,
  makeCtaClick,
  makeLink,
  makeLowScrollViews,
  makeSnapshot,
} from './fixtures';

function makeVisionSignals(pageType: PageType): VisualSignals {
  return {
    visualPrimaryCta: null,
    visualSecondaryCta: null,
    pageType,
    heroBlock: null,
    capturedAt: '2026-05-26T12:00:00Z',
    modelVersion: 'gemini-3.5-flash',
  };
}

describe('above-fold-coverage × pageType', () => {
  const PATH = '/privacy';

  function makeBelowFoldSnapshot(pathRef = PATH) {
    // Heavy CTA below the fold + meta sized to reflect a typical legal page.
    const heavy = makeCta('Buy now', 0.9, 'below', 'cta-primary');
    const decoy = makeCta('Help', 0.2, 'above', 'cta-decoy');
    return makeSnapshot(pathRef, [heavy, decoy]);
  }

  it('does NOT fire on a legal page (suppress=true)', () => {
    const snap = makeBelowFoldSnapshot('/privacy');
    snap.data.visualSignals = makeVisionSignals('legal');
    const ctx = makeContext(makeLowScrollViews('/privacy', 50), [snap]);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  it('does NOT fire on a blog page (suppress=true)', () => {
    const snap = makeBelowFoldSnapshot('/blog/launch');
    snap.data.visualSignals = makeVisionSignals('blog');
    const ctx = makeContext(makeLowScrollViews('/blog/launch', 50), [snap]);
    expect(aboveFoldCoverage.evaluate(ctx)).toEqual([]);
  });

  it('does fire on a pricing page (tighten — floorMultiplier 0.7)', () => {
    const snap = makeBelowFoldSnapshot('/pricing');
    snap.data.visualSignals = makeVisionSignals('pricing');
    const ctx = makeContext(makeLowScrollViews('/pricing', 50), [snap]);
    const findings = aboveFoldCoverage.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].pathRef).toBe('/pricing');
  });

  it('does fire on a home page (no modulation entry — neutral)', () => {
    const snap = makeBelowFoldSnapshot('/');
    snap.data.visualSignals = makeVisionSignals('home');
    const ctx = makeContext(makeLowScrollViews('/', 50), [snap]);
    expect(aboveFoldCoverage.evaluate(ctx).length).toBe(1);
  });

  it('does fire when vision pass did not run (visualSignals undefined)', () => {
    // Neutral fallback — rule applies base thresholds.
    const snap = makeBelowFoldSnapshot('/');
    // No visualSignals attached.
    const ctx = makeContext(makeLowScrollViews('/', 50), [snap]);
    expect(aboveFoldCoverage.evaluate(ctx).length).toBe(1);
  });
});

describe('nav-dispersion × pageType', () => {
  function makeNavEvents(distinctDests: number, perDest: number) {
    // Build perDest clicks per destination, distinctDests destinations.
    // Names are stable so the gini computation is deterministic.
    const events = [];
    for (let d = 0; d < distinctDests; d++) {
      for (let i = 0; i < perDest; i++) {
        events.push(
          makeCtaClick('/', `Dest-${d}`, `s-${d}-${i}`, { elementRole: 'nav' }),
        );
      }
    }
    return events;
  }

  it('does NOT fire when the homepage is classified as docs (suppress=true)', () => {
    // 8 destinations × 10 clicks = 80 clicks (well above MIN_NAV_CLICKS).
    // Uniform — would normally fire.
    const events = makeNavEvents(8, 10);
    const homeSnap = makeSnapshot('/', []);
    homeSnap.data.visualSignals = makeVisionSignals('docs');
    const ctx = makeContext(events, [homeSnap]);
    expect(navDispersion.evaluate(ctx)).toEqual([]);
  });

  it('does fire on a homepage classified as home (no entry — neutral)', () => {
    const events = makeNavEvents(8, 10);
    const homeSnap = makeSnapshot('/', []);
    homeSnap.data.visualSignals = makeVisionSignals('home');
    const ctx = makeContext(events, [homeSnap]);
    expect(navDispersion.evaluate(ctx).length).toBe(1);
  });
});

describe('link-text-generic × pageType', () => {
  it('does NOT fire on a legal page (suppress=true)', () => {
    const links = [
      makeLink('Read more', '/a', 'above'),
      makeLink('Click here', '/b', 'above'),
      makeLink('Learn more', '/c', 'above'),
    ];
    const snap = makeSnapshot('/privacy', links);
    snap.data.visualSignals = makeVisionSignals('legal');
    const ctx = makeContext([], [snap]);
    expect(linkTextGeneric.evaluate(ctx)).toEqual([]);
  });

  it('does fire on a home page (no modulation)', () => {
    const links = [
      makeLink('Read more', '/a', 'above'),
      makeLink('Click here', '/b', 'above'),
      makeLink('Learn more', '/c', 'above'),
    ];
    const snap = makeSnapshot('/', links);
    snap.data.visualSignals = makeVisionSignals('home');
    const ctx = makeContext([], [snap]);
    expect(linkTextGeneric.evaluate(ctx).length).toBe(1);
  });
});

describe('heading-hierarchy-jump × pageType', () => {
  it('docs page suppresses a single H1→H3 jump (Math.ceil(1 × 1.4) = 2)', () => {
    // With floorMultiplier 1.4 + ceil rounding, minJumpsToFire = 2 on docs,
    // so a single H1→H3 jump no longer fires. The H1 is present and unique,
    // so missing-H1 / multiple-H1 paths don't kick in either — the rule
    // emits nothing.
    const snap = makeSnapshot('/docs/api', [], [
      { level: 1, text: 'API' },
      { level: 3, text: 'Authentication' },
    ]);
    snap.data.visualSignals = makeVisionSignals('docs');
    const ctx = makeContext([], [snap]);
    expect(headingHierarchyJump.evaluate(ctx)).toEqual([]);
  });

  it('docs page still fires when two or more jumps are present', () => {
    // Two H1→H3 jumps clears the docs floor (2 ≥ ceil(1 × 1.4) = 2).
    const snap = makeSnapshot('/docs/api', [], [
      { level: 1, text: 'API' },
      { level: 3, text: 'Authentication' },
      { level: 1, text: 'Endpoints' },
      { level: 3, text: 'GET /users' },
    ]);
    snap.data.visualSignals = makeVisionSignals('docs');
    const ctx = makeContext([], [snap]);
    expect(headingHierarchyJump.evaluate(ctx).length).toBe(1);
  });

  it('docs page still fires on missing-H1 regardless of floorMultiplier', () => {
    // Missing-H1 is an unambiguous semantic error — modulation doesn't
    // gate it.
    const snap = makeSnapshot('/docs/api', [], [
      { level: 2, text: 'Authentication' },
      { level: 3, text: 'Bearer tokens' },
    ]);
    snap.data.visualSignals = makeVisionSignals('docs');
    const ctx = makeContext([], [snap]);
    expect(headingHierarchyJump.evaluate(ctx).length).toBe(1);
  });

  it('legal page suppresses the rule entirely', () => {
    // Legal pages have notoriously messy heading structure (one H1 per section,
    // no subnesting); the prescription is not credibility-building in a
    // prospect email. Modulation suppresses outright.
    const snap = makeSnapshot('/privacy', [], [
      { level: 2, text: 'Privacy Policy' },
      { level: 2, text: 'Data we collect' },
    ]);
    snap.data.visualSignals = makeVisionSignals('legal');
    const ctx = makeContext([], [snap]);
    expect(headingHierarchyJump.evaluate(ctx).length).toBe(0);
  });
});

describe('missing-meta-description × pageType', () => {
  it('suppresses the rule entirely on legal pages', () => {
    // /privacy doesn't compete for ranking; a missing meta description there
    // is not a prospect-credibility finding. Modulation suppresses outright.
    const snap = makeSnapshot('/privacy', [], [], [], [], { description: null });
    snap.data.visualSignals = makeVisionSignals('legal');
    const ctx = makeContext([], [snap]);
    expect(missingMetaDescription.evaluate(ctx).length).toBe(0);
  });

  it('keeps warn severity on home pages (no modulation)', () => {
    const snap = makeSnapshot('/', [], [], [], [], { description: null });
    snap.data.visualSignals = makeVisionSignals('home');
    const ctx = makeContext([], [snap]);
    const findings = missingMetaDescription.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warn');
  });
});

describe('missing-canonical-url × pageType', () => {
  it('suppresses the rule entirely on legal pages', () => {
    const snap = makeSnapshot('/privacy', [], [], [], [], { canonical: null });
    snap.data.visualSignals = makeVisionSignals('legal');
    const ctx = makeContext([], [snap]);
    expect(missingCanonicalUrl.evaluate(ctx).length).toBe(0);
  });

  it('keeps base priority on a landing page', () => {
    const snap = makeSnapshot('/', [], [], [], [], { canonical: null });
    snap.data.visualSignals = makeVisionSignals('landing');
    const ctx = makeContext([], [snap]);
    const findings = missingCanonicalUrl.evaluate(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].priorityScore).toBeCloseTo(0.25, 2);
  });
});

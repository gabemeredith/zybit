import { describe, it, expect } from 'vitest';
import { heroHierarchyInversion } from '@/lib/phase2/rules/heroHierarchyInversion';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import type { CtaCandidate, PageSnapshot, VisualSignals } from '@/lib/phase2/snapshots/types';
import { makeContext, makeCtaClick, makeGoalConfig, makeSnapshot, makeCta } from './fixtures';

const PATH = '/pricing';

/**
 * Build a context where:
 * - The snapshot has two CTAs: heavy (high visual weight) and secondary (clicked more)
 * - Most clicks go to 'secondary' but heavy CTA has more visual weight → inversion
 */
function makeInversionContext(clickCount = 40, withSnapshot = true) {
  // Most clicks go to "Secondary action" text
  const events = [
    ...Array.from({ length: Math.floor(clickCount * 0.7) }, (_, i) =>
      makeCtaClick(PATH, 'Secondary action', `s-${i}`),
    ),
    ...Array.from({ length: Math.floor(clickCount * 0.3) }, (_, i) =>
      makeCtaClick(PATH, 'Primary action', `s2-${i}`),
    ),
  ];

  // Heavy CTA = "Primary action" but users click "Secondary action" more
  const heavyCta = makeCta('Primary action', 0.9, 'above', 'cta-primary');
  const secondaryCta = makeCta('Secondary action', 0.3, 'above', 'cta-secondary');
  const snapshot = makeSnapshot(PATH, [heavyCta, secondaryCta]);

  return makeContext(events, withSnapshot ? [snapshot] : []);
}

describe('heroHierarchyInversion rule', () => {
  it('fewer than 30 CTA clicks → returns []', () => {
    const ctx = makeInversionContext(10);
    expect(heroHierarchyInversion.evaluate(ctx)).toEqual([]);
  });

  it('no snapshot → returns []', () => {
    const ctx = makeInversionContext(40, false);
    expect(heroHierarchyInversion.evaluate(ctx)).toEqual([]);
  });

  it('clicked CTA === heaviest CTA → returns []', () => {
    // All clicks go to the heavy CTA → no inversion
    const events = Array.from({ length: 40 }, (_, i) =>
      makeCtaClick(PATH, 'Primary action', `s-${i}`),
    );
    const cta = makeCta('Primary action', 0.9, 'above');
    const snapshot = makeSnapshot(PATH, [cta]);
    const ctx = makeContext(events, [snapshot]);
    expect(heroHierarchyInversion.evaluate(ctx)).toEqual([]);
  });

  it('click inversion → returns finding', () => {
    const ctx = makeInversionContext(40);
    const findings = heroHierarchyInversion.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeInversionContext(40);
    const [f] = heroHierarchyInversion.evaluate(ctx);
    expect(f.ruleId).toBe('hero-hierarchy-inversion');
    expect(f.category).toBe('hierarchy');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeInversionContext(40);
    const [f] = heroHierarchyInversion.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('impactEstimate present with goalConfig', () => {
    const events = [
      ...Array.from({ length: 28 }, (_, i) => makeCtaClick(PATH, 'Secondary action', `s-${i}`)),
      ...Array.from({ length: 12 }, (_, i) => makeCtaClick(PATH, 'Primary action', `s2-${i}`)),
    ];
    const heavyCta = makeCta('Primary action', 0.9, 'above', 'cta-p');
    const secondaryCta = makeCta('Secondary action', 0.3, 'above', 'cta-s');
    const snapshot = makeSnapshot(PATH, [heavyCta, secondaryCta]);
    const config = makeGoalConfig('revenue');
    const ctx = makeContext(events, [snapshot], config);
    const [f] = heroHierarchyInversion.evaluate(ctx);
    expect(f.impactEstimate).toBeDefined();
    expect(f.impactEstimate!.unit).toBe('conversions');
  });

  it('finding id includes ruleId', () => {
    const ctx = makeInversionContext(40);
    const [f] = heroHierarchyInversion.evaluate(ctx);
    expect(f.id).toContain('hero-hierarchy-inversion');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeInversionContext(40);
    const [f] = heroHierarchyInversion.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('severity is valid', () => {
    const ctx = makeInversionContext(40);
    const [f] = heroHierarchyInversion.evaluate(ctx);
    expect(['critical', 'warn', 'info']).toContain(f.severity);
  });

  describe('proposeModifications', () => {
    function makeFinding(ctaRef: string | undefined): AuditFinding {
      return {
        id: 'hero-hierarchy-inversion:/pricing',
        ruleId: 'hero-hierarchy-inversion',
        category: 'hierarchy',
        severity: 'warn',
        confidence: 0.6,
        priorityScore: 0.6,
        pathRef: '/pricing',
        title: 't',
        summary: 's',
        recommendation: [],
        evidence: [],
        refs: ctaRef ? { ctaRef } : undefined,
      };
    }

    function snapshotWith(ctas: CtaCandidate[]): PageSnapshot {
      return makeSnapshot(PATH, ctas);
    }

    it('returns [] when finding has no ctaRef', () => {
      const snapshot = snapshotWith([makeCta('Primary', 0.9, 'above', 'r1')]);
      const out = heroHierarchyInversion.proposeModifications!(
        makeFinding(undefined),
        { snapshot, designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns [] when the referenced CTA has no cssSelector', () => {
      const heavy = makeCta('Primary', 0.9, 'above', 'cta-x');
      expect(heavy.cssSelector).toBeNull();
      const out = heroHierarchyInversion.proposeModifications!(
        makeFinding('cta-x'),
        { snapshot: snapshotWith([heavy]), designTokens: null },
      );
      expect(out).toEqual([]);
    });

    it('returns one variant with the heavy CTAs selector when present', () => {
      const heavy = { ...makeCta('Primary', 0.9, 'above', 'cta-x'), cssSelector: 'button.cta-primary' };
      const out = heroHierarchyInversion.proposeModifications!(
        makeFinding('cta-x'),
        { snapshot: snapshotWith([heavy]), designTokens: { secondaryColor: 'rgb(50, 50, 50)' } },
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toHaveLength(1);
      const mod = out[0][0];
      expect(mod.type).toBe('css-inject');
      expect(mod).toMatchObject({ type: 'css-inject', selector: 'button.cta-primary' });
      if (mod.type === 'css-inject') {
        expect(mod.css).toContain('rgb(50, 50, 50)');
      }
    });

    it('falls back to literal color when design tokens are missing', () => {
      const heavy = { ...makeCta('Primary', 0.9, 'above', 'cta-x'), cssSelector: 'button.cta-primary' };
      const out = heroHierarchyInversion.proposeModifications!(
        makeFinding('cta-x'),
        { snapshot: snapshotWith([heavy]), designTokens: null },
      );
      expect(out).toHaveLength(1);
      const mod = out[0][0];
      if (mod.type === 'css-inject') {
        expect(mod.css).toContain('#666');
      }
    });
  });

  describe('proposeAnnotations', () => {
    function makeFinding(refs: { ctaRef?: string; clickedCtaRef?: string }): AuditFinding {
      return {
        id: 'hero-hierarchy-inversion:/pricing',
        ruleId: 'hero-hierarchy-inversion',
        category: 'hierarchy',
        severity: 'warn',
        confidence: 0.6,
        priorityScore: 0.6,
        pathRef: '/pricing',
        title: 't',
        summary: 's',
        recommendation: [],
        evidence: [],
        refs,
      };
    }

    function snapshotWith(ctas: CtaCandidate[]): PageSnapshot {
      return makeSnapshot(PATH, ctas);
    }

    it('outlines heavy (red) + clicked (green) with a caption next to each', () => {
      const heavy = { ...makeCta('Primary', 0.9, 'above', 'h'), cssSelector: 'button.h' };
      const clicked = { ...makeCta('Secondary', 0.3, 'above', 'c'), cssSelector: 'a.c' };
      const out = heroHierarchyInversion.proposeAnnotations!(
        makeFinding({ ctaRef: 'h', clickedCtaRef: 'c' }),
        { snapshot: snapshotWith([heavy, clicked]), designTokens: null },
      );
      // 1: outline heavy (red); 2-3: heavy caption insert + css;
      // 4: outline clicked (green); 5-6: clicked caption insert + css.
      expect(out).toHaveLength(6);
      expect(out[0]).toMatchObject({ type: 'css-inject', selector: 'button.h' });
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
      expect(out[3]).toMatchObject({ type: 'css-inject', selector: 'a.c' });
      if (out[3].type === 'css-inject') expect(out[3].css).toContain('#22c55e');
    });

    it('returns only the heavy outline + caption (3 mods) when clickedCtaRef is absent', () => {
      const heavy = { ...makeCta('Primary', 0.9, 'above', 'h'), cssSelector: 'button.h' };
      const out = heroHierarchyInversion.proposeAnnotations!(
        makeFinding({ ctaRef: 'h' }),
        { snapshot: snapshotWith([heavy]), designTokens: null },
      );
      expect(out).toHaveLength(3);
      if (out[0].type === 'css-inject') expect(out[0].css).toContain('#ef4444');
    });

    it('returns [] when neither CTA has a cssSelector', () => {
      const heavy = makeCta('Primary', 0.9, 'above', 'h');
      const clicked = makeCta('Secondary', 0.3, 'above', 'c');
      expect(heavy.cssSelector).toBeNull();
      expect(clicked.cssSelector).toBeNull();
      const out = heroHierarchyInversion.proposeAnnotations!(
        makeFinding({ ctaRef: 'h', clickedCtaRef: 'c' }),
        { snapshot: snapshotWith([heavy, clicked]), designTokens: null },
      );
      expect(out).toEqual([]);
    });
  });

  describe('refs.clickedCtaRef persistence', () => {
    it('finding from the snapshot path carries clickedCtaRef when the clicked CTA matched', () => {
      const ctx = makeInversionContext(40);
      const [f] = heroHierarchyInversion.evaluate(ctx);
      expect(f.refs?.ctaRef).toBe('cta-primary');
      expect(f.refs?.clickedCtaRef).toBe('cta-secondary');
    });
  });

  describe('vision-pass label fallback', () => {
    // Closes handover §12.A's "unnamed-CTA root cause":
    // an icon-only "Get started" hero ships as `<button><svg/></button>`.
    // The parser sees `text: ""`. Pre-vision, the rule bailed (no text on
    // both sides). With `visualSignals.visualPrimaryCta` filled in, the
    // rule should still fire and use the vision-derived label.
    function makeVisionSignals(overrides: Partial<VisualSignals> = {}): VisualSignals {
      return {
        visualPrimaryCta: {
          text: 'Get started',
          bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
          confidence: 0.9,
        },
        visualSecondaryCta: {
          text: 'Learn more',
          bbox: { x: 0.5, y: 0.2, width: 0.2, height: 0.1 },
          confidence: 0.8,
        },
        pageType: 'home',
        heroBlock: null,
        capturedAt: '2026-05-26T12:00:00Z',
        modelVersion: 'gemini-2.0-flash',
        ...overrides,
      };
    }

    it('uses visualPrimaryCta.text as heavy label when parser CTA text is empty', () => {
      // Vision pass identified the icon-only hero as "Get started".
      // The heavy CTA in the snapshot has no text — pre-vision bail.
      const heavyCta = makeCta('', 0.9, 'above', 'cta-primary');
      const secondaryCta = makeCta('Learn more', 0.3, 'above', 'cta-secondary');
      const snapshot = makeSnapshot(PATH, [heavyCta, secondaryCta]);
      snapshot.data.visualSignals = makeVisionSignals();

      const events = [
        ...Array.from({ length: 28 }, (_, i) =>
          makeCtaClick(PATH, 'Learn more', `s-${i}`),
        ),
        ...Array.from({ length: 12 }, (_, i) =>
          makeCtaClick(PATH, '', `s2-${i}`),
        ),
      ];
      const ctx = makeContext(events, [snapshot]);
      const findings = heroHierarchyInversion.evaluate(ctx);
      expect(findings.length).toBe(1);

      // Evidence should carry the vision-derived label, not '(unnamed button)'.
      const heavyEvidence = findings[0].evidence.find(
        (e) => e.label === 'What your design emphasizes',
      );
      expect(heavyEvidence?.value).toBe('Get started');
      const findingText = JSON.stringify(findings[0].evidence);
      expect(findingText).not.toContain('(unnamed button)');
      expect(findingText).not.toContain('(unnamed CTA)');
    });

    it('still bails when no text comes from parser AND no vision signals exist', () => {
      // No vision pass — icon-only CTA stays unactionable.
      const heavyCta = makeCta('', 0.9, 'above', 'cta-primary');
      const secondaryCta = makeCta('Learn more', 0.3, 'above', 'cta-secondary');
      const snapshot = makeSnapshot(PATH, [heavyCta, secondaryCta]);
      // No visualSignals attached.

      const events = [
        ...Array.from({ length: 40 }, (_, i) =>
          makeCtaClick(PATH, 'Learn more', `s-${i}`),
        ),
      ];
      const ctx = makeContext(events, [snapshot]);
      expect(heroHierarchyInversion.evaluate(ctx)).toEqual([]);
    });
  });
});

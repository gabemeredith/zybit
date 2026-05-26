/**
 * Tests for the page-type modulation table — the single source of truth
 * for per-(rule, pageType) threshold adjustments (handover §12.D).
 *
 * The contract this test suite enforces:
 *   1. Pure function — no I/O, deterministic. Same (ruleId, pageType)
 *      always returns the same shape.
 *   2. Fail-open — unknown rule, unknown pageType, undefined pageType all
 *      return the neutral { suppress:false, floorMultiplier:1, capMultiplier:1 }.
 *   3. Bounded multipliers — table edits that exceed [0.5, 1.5] are
 *      clamped, so a misedit can't turn a rule into something it isn't.
 *   4. Cardinal cases hold — the entries this PR ships (above-fold blog
 *      suppress, nav-dispersion pricing tighten, etc.) must actually
 *      return what the table author intended.
 */

import { describe, it, expect } from 'vitest';
import { pageTypeFromSnapshot, pageTypeModulation } from '../pageTypeModulation';
import type { VisualSignals } from '@/lib/phase2/snapshots/types';

describe('pageTypeModulation', () => {
  describe('neutral fallback', () => {
    it('returns neutral when pageType is undefined (vision pass did not run)', () => {
      const out = pageTypeModulation('above-fold-coverage', undefined);
      expect(out).toEqual({ suppress: false, floorMultiplier: 1, capMultiplier: 1 });
    });

    it('returns neutral when pageType is unknown (vision pass ran but did not classify)', () => {
      const out = pageTypeModulation('above-fold-coverage', 'unknown');
      expect(out).toEqual({ suppress: false, floorMultiplier: 1, capMultiplier: 1 });
    });

    it('returns neutral for a rule with no modulation table entry', () => {
      const out = pageTypeModulation('rule-id-that-never-existed', 'pricing');
      expect(out).toEqual({ suppress: false, floorMultiplier: 1, capMultiplier: 1 });
    });

    it('returns neutral for a (rule, pageType) cell not in the table', () => {
      // above-fold-coverage has no entry for 'home' — it should not modulate
      // (the rule already has the right behavior on a homepage).
      const out = pageTypeModulation('above-fold-coverage', 'home');
      expect(out).toEqual({ suppress: false, floorMultiplier: 1, capMultiplier: 1 });
    });
  });

  describe('above-fold-coverage suppression cases', () => {
    it.each(['blog', 'legal', 'docs', 'about', 'support'] as const)(
      'suppresses entirely on %s pages',
      (pageType) => {
        const out = pageTypeModulation('above-fold-coverage', pageType);
        expect(out.suppress).toBe(true);
      },
    );

    it.each(['pricing', 'signup', 'checkout'] as const)(
      'tightens floor on %s pages without suppressing',
      (pageType) => {
        const out = pageTypeModulation('above-fold-coverage', pageType);
        expect(out.suppress).toBe(false);
        expect(out.floorMultiplier).toBeLessThan(1);
      },
    );
  });

  describe('nav-dispersion modulation cases', () => {
    it('suppresses on docs pages (the nav IS the IA)', () => {
      const out = pageTypeModulation('nav-dispersion', 'docs');
      expect(out.suppress).toBe(true);
    });

    it('loosens the gini cap on a blog (a content site can sustain a wider nav)', () => {
      const out = pageTypeModulation('nav-dispersion', 'blog');
      expect(out.suppress).toBe(false);
      expect(out.capMultiplier).toBeGreaterThan(1);
    });

    it.each(['pricing', 'signup', 'checkout'] as const)(
      'tightens floor on %s (every nav item is an exit ramp)',
      (pageType) => {
        const out = pageTypeModulation('nav-dispersion', pageType);
        expect(out.suppress).toBe(false);
        expect(out.floorMultiplier).toBeLessThanOrEqual(1);
        expect(out.capMultiplier).toBeGreaterThan(1);
      },
    );
  });

  describe('link-text-generic modulation', () => {
    it('suppresses on legal (footer ToS lists are universally generic)', () => {
      expect(pageTypeModulation('link-text-generic', 'legal').suppress).toBe(true);
    });

    it('raises threshold on docs (deep see-also linking is part of the IA)', () => {
      const out = pageTypeModulation('link-text-generic', 'docs');
      expect(out.suppress).toBe(false);
      expect(out.floorMultiplier).toBeGreaterThan(1);
    });
  });

  describe('SEO rules downgrade severity on low-priority pages', () => {
    it.each([
      ['heading-hierarchy-jump', 'legal'],
      ['heading-hierarchy-jump', 'about'],
      ['missing-meta-description', 'legal'],
      ['missing-meta-description', 'about'],
      ['missing-canonical-url', 'legal'],
      ['missing-canonical-url', 'about'],
    ] as const)('%s downgrades severity on %s', (ruleId, pageType) => {
      const out = pageTypeModulation(ruleId, pageType);
      expect(out.severityDowngrade).toBe(true);
    });

    it('does not downgrade severity for high-priority page types', () => {
      const out = pageTypeModulation('missing-meta-description', 'home');
      expect(out.severityDowngrade).toBeUndefined();
    });
  });

  describe('multiplier bounds', () => {
    it('never returns a floor multiplier outside [0.5, 1.5]', () => {
      const allRules = [
        'above-fold-coverage',
        'nav-dispersion',
        'link-text-generic',
        'heading-hierarchy-jump',
        'missing-meta-description',
        'missing-canonical-url',
      ];
      const allPageTypes = [
        'home',
        'landing',
        'pricing',
        'signup',
        'checkout',
        'docs',
        'about',
        'blog',
        'support',
        'legal',
      ] as const;
      for (const rule of allRules) {
        for (const pageType of allPageTypes) {
          const out = pageTypeModulation(rule, pageType);
          expect(out.floorMultiplier).toBeGreaterThanOrEqual(0.5);
          expect(out.floorMultiplier).toBeLessThanOrEqual(1.5);
          expect(out.capMultiplier).toBeGreaterThanOrEqual(0.5);
          expect(out.capMultiplier).toBeLessThanOrEqual(1.5);
        }
      }
    });
  });
});

describe('pageTypeFromSnapshot', () => {
  it('returns undefined when visualSignals is missing', () => {
    expect(pageTypeFromSnapshot(undefined)).toBeUndefined();
    expect(pageTypeFromSnapshot(null)).toBeUndefined();
  });

  it('returns the pageType when present', () => {
    const signals: Pick<VisualSignals, 'pageType'> = { pageType: 'pricing' };
    expect(pageTypeFromSnapshot(signals)).toBe('pricing');
  });

  it('returns unknown when the model could not classify', () => {
    const signals: Pick<VisualSignals, 'pageType'> = { pageType: 'unknown' };
    expect(pageTypeFromSnapshot(signals)).toBe('unknown');
  });
});

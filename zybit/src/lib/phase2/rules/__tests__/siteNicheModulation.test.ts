import { describe, it, expect } from 'vitest';
import { siteNicheModulation } from '../siteNicheModulation';

describe('siteNicheModulation', () => {
  it('returns NEUTRAL (no suppress) for unknown niche', () => {
    const m = siteNicheModulation('vague-claim-detected', 'unknown');
    expect(m.suppress).toBe(false);
  });

  it('returns NEUTRAL for undefined niche', () => {
    const m = siteNicheModulation('above-fold-coverage', undefined);
    expect(m.suppress).toBe(false);
  });

  it('returns NEUTRAL for a rule not in the table', () => {
    const m = siteNicheModulation('heading-hierarchy-jump', 'community');
    expect(m.suppress).toBe(false);
  });

  describe('above-fold-coverage', () => {
    it('suppresses on community', () => {
      expect(siteNicheModulation('above-fold-coverage', 'community').suppress).toBe(true);
    });

    it('suppresses on education', () => {
      expect(siteNicheModulation('above-fold-coverage', 'education').suppress).toBe(true);
    });

    it('suppresses on media', () => {
      expect(siteNicheModulation('above-fold-coverage', 'media').suppress).toBe(true);
    });

    it('does not suppress on saas', () => {
      expect(siteNicheModulation('above-fold-coverage', 'saas').suppress).toBe(false);
    });

    it('does not suppress on ecommerce', () => {
      expect(siteNicheModulation('above-fold-coverage', 'ecommerce').suppress).toBe(false);
    });
  });

  describe('vague-claim-detected', () => {
    it('suppresses on community', () => {
      expect(siteNicheModulation('vague-claim-detected', 'community').suppress).toBe(true);
    });

    it('suppresses on education', () => {
      expect(siteNicheModulation('vague-claim-detected', 'education').suppress).toBe(true);
    });

    it('suppresses on media', () => {
      expect(siteNicheModulation('vague-claim-detected', 'media').suppress).toBe(true);
    });

    it('downgrades severity on devtools (not suppress)', () => {
      const m = siteNicheModulation('vague-claim-detected', 'devtools');
      expect(m.suppress).toBe(false);
      expect(m.severityDowngrade).toBe(true);
    });

    it('does not suppress on saas', () => {
      expect(siteNicheModulation('vague-claim-detected', 'saas').suppress).toBe(false);
    });
  });

  describe('proof-missing', () => {
    it('suppresses on community', () => {
      expect(siteNicheModulation('proof-missing', 'community').suppress).toBe(true);
    });

    it('suppresses on education', () => {
      expect(siteNicheModulation('proof-missing', 'education').suppress).toBe(true);
    });

    it('suppresses on local', () => {
      expect(siteNicheModulation('proof-missing', 'local').suppress).toBe(true);
    });

    it('suppresses on media', () => {
      expect(siteNicheModulation('proof-missing', 'media').suppress).toBe(true);
    });

    it('does not suppress on saas', () => {
      expect(siteNicheModulation('proof-missing', 'saas').suppress).toBe(false);
    });
  });

  describe('cta-verb-mismatch', () => {
    it('suppresses on community', () => {
      expect(siteNicheModulation('cta-verb-mismatch', 'community').suppress).toBe(true);
    });

    it('suppresses on education', () => {
      expect(siteNicheModulation('cta-verb-mismatch', 'education').suppress).toBe(true);
    });

    it('suppresses on media', () => {
      expect(siteNicheModulation('cta-verb-mismatch', 'media').suppress).toBe(true);
    });

    it('does not suppress on ecommerce', () => {
      expect(siteNicheModulation('cta-verb-mismatch', 'ecommerce').suppress).toBe(false);
    });
  });

  describe('hero-hierarchy-inversion', () => {
    it('downgrades severity on community (not suppress)', () => {
      const m = siteNicheModulation('hero-hierarchy-inversion', 'community');
      expect(m.suppress).toBe(false);
      expect(m.severityDowngrade).toBe(true);
    });

    it('downgrades severity on education (not suppress)', () => {
      const m = siteNicheModulation('hero-hierarchy-inversion', 'education');
      expect(m.suppress).toBe(false);
      expect(m.severityDowngrade).toBe(true);
    });

    it('downgrades severity on devtools (not suppress)', () => {
      const m = siteNicheModulation('hero-hierarchy-inversion', 'devtools');
      expect(m.suppress).toBe(false);
      expect(m.severityDowngrade).toBe(true);
    });

    it('does not modulate on saas', () => {
      const m = siteNicheModulation('hero-hierarchy-inversion', 'saas');
      expect(m.suppress).toBe(false);
      expect(m.severityDowngrade).toBeUndefined();
    });
  });
});

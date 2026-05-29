import { describe, expect, it } from 'vitest';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';
import { deriveBrandProfile } from '../brandProfile';

function snap(data: unknown): PageSnapshot {
  return { id: 's', pathRef: '/x', data } as unknown as PageSnapshot;
}

describe('deriveBrandProfile', () => {
  it('collects CTA vocabulary from ctas + the visual primary CTA, deduped', () => {
    const profile = deriveBrandProfile([
      snap({
        ctas: [{ text: 'Open an account' }, { text: 'Apply now' }, { text: 'Open an account' }],
        visualSignals: { visualPrimaryCta: { text: 'Get started today' } },
        headings: [],
      }),
    ]);
    expect(profile?.ctaVocabulary).toEqual(['Open an account', 'Apply now', 'Get started today']);
  });

  it('collects voice samples from hero copy and h1/h2 but not deeper headings', () => {
    const profile = deriveBrandProfile([
      snap({
        ctas: [],
        visualSignals: { heroBlock: { headline: 'Banking that works for you', subheadline: 'Switch in minutes' } },
        headings: [
          { level: 1, text: 'Checking accounts' },
          { level: 3, text: 'Legal footer text' },
        ],
      }),
    ]);
    expect(profile?.voiceSamples).toContain('Banking that works for you');
    expect(profile?.voiceSamples).toContain('Switch in minutes');
    expect(profile?.voiceSamples).toContain('Checking accounts');
    expect(profile?.voiceSamples).not.toContain('Legal footer text');
  });

  it('skips empty/whitespace values and is site-wide across snapshots', () => {
    const profile = deriveBrandProfile([
      snap({ ctas: [{ text: '  ' }, { text: 'Compare plans' }], headings: [] }),
      snap({ ctas: [{ text: 'Talk to sales' }], headings: [] }),
    ]);
    expect(profile?.ctaVocabulary).toEqual(['Compare plans', 'Talk to sales']);
  });

  it('pulls voice from meta title/description even when CTAs+headings are thin', () => {
    // The JS-shell case (e.g. Stripe): no parseable CTAs/headings, but meta is
    // always present in the HTML, so brand voice still survives.
    const profile = deriveBrandProfile([
      snap({
        ctas: [],
        headings: [],
        meta: {
          title: 'Stripe | Payment Processing Platform',
          ogDescription: 'Millions of businesses use Stripe to accept payments.',
        },
      }),
    ]);
    expect(profile?.voiceSamples).toContain('Stripe | Payment Processing Platform');
    expect(profile?.voiceSamples).toContain('Millions of businesses use Stripe to accept payments.');
  });

  it('returns null when there is no brand signal', () => {
    expect(deriveBrandProfile([])).toBeNull();
    expect(deriveBrandProfile([snap({ ctas: [], headings: [] })])).toBeNull();
  });
});

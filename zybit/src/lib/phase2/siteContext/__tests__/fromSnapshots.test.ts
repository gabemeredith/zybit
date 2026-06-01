import { describe, it, expect } from 'vitest';
import type { PageSnapshot, PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { siteSignalsFromData, siteSignalsFromSnapshots } from '../fromSnapshots';

function data(partial: Partial<PageSnapshotData>): PageSnapshotData {
  return partial as PageSnapshotData;
}

describe('siteSignalsFromData', () => {
  it('pulls title/description, level<=2 headings, hero, and CTA vocabulary', () => {
    const sig = siteSignalsFromData(
      data({
        meta: { title: 'Acme CRM', description: 'CRM for teams' } as never,
        headings: [
          { level: 1, text: 'Close more deals' },
          { level: 2, text: 'Trusted by 500 teams' },
          { level: 3, text: 'deep heading ignored' },
        ] as never,
        ctas: [{ text: 'Start free trial' }, { text: '' }, { text: 'Book a demo' }] as never,
        visualSignals: { heroBlock: { headline: 'Close more deals', subheadline: 'Less busywork' } } as never,
      }),
    );
    expect(sig.title).toBe('Acme CRM');
    expect(sig.headings).toEqual(['Close more deals', 'Trusted by 500 teams']);
    expect(sig.ctaVocabulary).toEqual(['Start free trial', 'Book a demo']);
    expect(sig.heroHeadline).toBe('Close more deals');
    expect(sig.heroSubheadline).toBe('Less busywork');
  });

  it('tolerates missing fields', () => {
    const sig = siteSignalsFromData(data({}));
    expect(sig).toEqual({
      title: null,
      description: null,
      headings: [],
      heroHeadline: null,
      heroSubheadline: null,
      ctaVocabulary: [],
    });
  });
});

describe('siteSignalsFromSnapshots', () => {
  const snap = (pathRef: string, url: string, title: string): PageSnapshot =>
    ({ pathRef, url, data: data({ meta: { title } as never }) } as PageSnapshot);

  it('prefers the homepage snapshot', () => {
    const out = siteSignalsFromSnapshots([
      snap('/pricing', 'https://acme.com/pricing', 'Pricing'),
      snap('/', 'https://acme.com/', 'Home'),
    ]);
    expect(out.url).toBe('https://acme.com/');
    expect(out.signals.title).toBe('Home');
  });

  it('falls back to the first snapshot when no homepage', () => {
    const out = siteSignalsFromSnapshots([snap('/features', 'https://acme.com/features', 'Features')]);
    expect(out.signals.title).toBe('Features');
  });

  it('returns empty signals for no snapshots', () => {
    expect(siteSignalsFromSnapshots([])).toEqual({ url: null, signals: {} });
  });
});

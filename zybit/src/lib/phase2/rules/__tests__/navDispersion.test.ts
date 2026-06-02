import { describe, it, expect } from 'vitest';
import { navDispersion } from '@/lib/phase2/rules/navDispersion';
import { makeContext, makeCtaClick } from './fixtures';

/**
 * navDispersion needs:
 * - ≥50 nav CTA clicks (element_role='nav')
 * - ≥6 distinct destinations
 * - Gini < 0.3 (uniform distribution)
 */
function makeNavDispersionContext(
  destinations: string[],
  clicksPerDest: number,
): ReturnType<typeof makeContext> {
  const events: ReturnType<typeof makeCtaClick>[] = [];
  destinations.forEach((dest, di) => {
    for (let i = 0; i < clicksPerDest; i++) {
      events.push(
        makeCtaClick('/', dest, `nav-s-${di}-${i}`, { elementRole: 'nav' }),
      );
    }
  });
  return makeContext(events);
}

describe('navDispersion rule', () => {
  it('fewer than 50 nav clicks → returns []', () => {
    const ctx = makeNavDispersionContext(['A', 'B', 'C', 'D', 'E', 'F'], 5); // 30 total
    expect(navDispersion.evaluate(ctx)).toEqual([]);
  });

  it('fewer than 6 distinct destinations → returns []', () => {
    const ctx = makeNavDispersionContext(['Home', 'Pricing', 'About', 'Blog', 'Contact'], 15); // 75 clicks, 5 dests
    expect(navDispersion.evaluate(ctx)).toEqual([]);
  });

  it('concentrated nav (high gini) → returns []', () => {
    // 'Pricing' gets 100 clicks, others get 2 each
    const events: ReturnType<typeof makeCtaClick>[] = [
      ...Array.from({ length: 100 }, (_, i) => makeCtaClick('/', 'Pricing', `s-${i}`, { elementRole: 'nav' })),
      ...['Home', 'About', 'Blog', 'Contact', 'Docs'].flatMap((d, di) =>
        Array.from({ length: 2 }, (_, i) => makeCtaClick('/', d, `s-${di * 100 + i + 200}`, { elementRole: 'nav' })),
      ),
    ];
    const ctx = makeContext(events);
    expect(navDispersion.evaluate(ctx)).toEqual([]);
  });

  it('uniform nav distribution → returns finding', () => {
    // 8 destinations, 10 clicks each = uniform (Gini ≈ 0) → finding
    const ctx = makeNavDispersionContext(
      ['Home', 'Pricing', 'About', 'Blog', 'Contact', 'Docs', 'API', 'Status'],
      10,
    );
    const findings = navDispersion.evaluate(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has correct ruleId and category', () => {
    const ctx = makeNavDispersionContext(
      ['Home', 'Pricing', 'About', 'Blog', 'Contact', 'Docs', 'API', 'Status'],
      10,
    );
    const [f] = navDispersion.evaluate(ctx);
    expect(f.ruleId).toBe('nav-dispersion');
    expect(f.category).toBe('nav');
  });

  it('prescription is present with all three fields non-empty', () => {
    const ctx = makeNavDispersionContext(
      ['Home', 'Pricing', 'About', 'Blog', 'Contact', 'Docs', 'API', 'Status'],
      10,
    );
    const [f] = navDispersion.evaluate(ctx);
    expect(f.prescription).toBeDefined();
    expect(f.prescription!.whatToChange.length).toBeGreaterThan(0);
    expect(f.prescription!.whyItWorks.length).toBeGreaterThan(0);
    expect(f.prescription!.experimentVariantDescription.length).toBeGreaterThan(0);
  });

  it('non-nav CTA clicks are ignored', () => {
    // ≥50 non-nav CTA clicks but 0 nav → returns []
    const events = Array.from({ length: 60 }, (_, i) =>
      makeCtaClick('/pricing', 'Buy now', `s-${i}`),
    );
    expect(navDispersion.evaluate(makeContext(events))).toEqual([]);
  });

  it('finding id is stable', () => {
    const ctx = makeNavDispersionContext(
      ['Home', 'Pricing', 'About', 'Blog', 'Contact', 'Docs', 'API', 'Status'],
      10,
    );
    const [f] = navDispersion.evaluate(ctx);
    expect(f.id).toBe('nav-dispersion');
  });

  it('evidence array is non-empty', () => {
    const ctx = makeNavDispersionContext(
      ['Home', 'Pricing', 'About', 'Blog', 'Contact', 'Docs', 'API', 'Status'],
      10,
    );
    const [f] = navDispersion.evaluate(ctx);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it('pathRef is always / (site-wide finding anchored to the symbolic root)', () => {
    // Nav is site-wide; anchor to `/` unconditionally so the cascade's
    // submitted-page boost applies and evidence framing ("your homepage")
    // lines up. Not whichever page was first in the crawl — that
    // misleads the PM into thinking nav is wrong only on a specific
    // subpage.
    const ctx = makeNavDispersionContext(
      ['Home', 'Pricing', 'About', 'Blog', 'Contact', 'Docs', 'API', 'Status'],
      10,
    );
    const [f] = navDispersion.evaluate(ctx);
    expect(f.pathRef).toBe('/');
  });
});

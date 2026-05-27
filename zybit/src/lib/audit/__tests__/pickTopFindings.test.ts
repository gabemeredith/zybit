import { describe, expect, it } from 'vitest';
import { isOffConversionPath, pickTopFindings } from '../pickTopFindings';

function f(
  id: string,
  ruleId: string,
  pathRef: string | null,
  priorityScore: number,
) {
  return { id, ruleId, pathRef, priorityScore };
}

describe('isOffConversionPath', () => {
  it.each([
    '/legal',
    '/legal/privacy',
    '/privacy',
    '/terms',
    '/cookie-settings',
    '/cookies',
    '/impressum',
    '/datenschutz',
    '/aviso-legal',
    '/cgu',
    '/mentions-legales',
    '/baa',
    '/dpa',
    '/gdpr',
    '/hipaa',
    '/compliance',
    '/security',
    '/trust',
    '/sla',
    '/dmca',
    '/accessibility',
    '/do-not-sell',
    '/Legal',
    '/LEGAL/whatever',
  ])('flags %s as off-conversion', (path) => {
    expect(isOffConversionPath(path, '/')).toBe(true);
  });

  it.each([
    '/',
    '/pricing',
    '/enterprise',
    '/guides',
    '/blog/some-post',
    '/contact',
    '/about',
    '/legalese-but-not-legal',
  ])('does not flag %s', (path) => {
    expect(isOffConversionPath(path, '/')).toBe(false);
  });

  it('respects the submitted path — never filters what the prospect asked for', () => {
    expect(isOffConversionPath('/legal', '/legal')).toBe(false);
    expect(isOffConversionPath('/impressum', '/impressum')).toBe(false);
  });

  it('returns false for null/undefined paths', () => {
    expect(isOffConversionPath(null, '/')).toBe(false);
    expect(isOffConversionPath(undefined, '/')).toBe(false);
  });
});

describe('pickTopFindings', () => {
  it('returns 4 unique (path, rule) findings when available', () => {
    const findings = [
      f('a', 'rule-1', '/', 0.5),
      f('b', 'rule-2', '/pricing', 0.4),
      f('c', 'rule-3', '/about-us', 0.3),
      f('d', 'rule-4', '/blog', 0.2),
      f('e', 'rule-1', '/extra', 0.1),
    ];
    const { top } = pickTopFindings(findings, '/');
    expect(top.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('boosts findings on the submitted path by 1.5×', () => {
    const findings = [
      f('a', 'rule-1', '/', 0.3),
      f('b', 'rule-2', '/pricing', 0.4),
    ];
    const { top } = pickTopFindings(findings, '/');
    // 0.3 × 1.5 = 0.45 beats 0.4
    expect(top[0]?.id).toBe('a');
  });

  it('filters out legal/utility paths from the top-4', () => {
    const findings = [
      f('homepage', 'rule-1', '/', 0.35),
      f('impressum', 'rule-2', '/impressum', 0.45),
      f('legal', 'rule-3', '/legal', 0.45),
      f('pricing', 'rule-4', '/pricing', 0.30),
    ];
    const { top } = pickTopFindings(findings, '/');
    expect(top.map((x) => x.pathRef)).toEqual(['/', '/pricing']);
  });

  it('does NOT filter the submitted path even if it matches a legal pattern', () => {
    const findings = [
      f('legal-self', 'rule-1', '/legal', 0.5),
      f('other-legal', 'rule-2', '/legal/privacy', 0.4),
      f('homepage', 'rule-3', '/', 0.3),
    ];
    const { top } = pickTopFindings(findings, '/legal');
    expect(top.map((x) => x.id)).toContain('legal-self');
  });

  it('falls back to rule-repeat when no other pages have findings', () => {
    const findings = [
      f('a', 'rule-1', '/', 0.5),
      f('b', 'rule-1', '/pricing', 0.4),
      f('c', 'rule-1', '/about-us', 0.3),
      f('d', 'rule-1', '/blog', 0.2),
    ];
    const { top } = pickTopFindings(findings, '/');
    expect(top).toHaveLength(4);
  });

  it('returns fewer than limit rather than padding with off-conversion findings', () => {
    const findings = [
      f('a', 'rule-1', '/', 0.5),
      f('legal-1', 'rule-2', '/legal', 0.4),
      f('legal-2', 'rule-3', '/privacy', 0.3),
    ];
    const { top } = pickTopFindings(findings, '/');
    expect(top.map((x) => x.id)).toEqual(['a']);
  });

  it('treats pathRef:null as / for pathOf comparisons', () => {
    const findings = [
      f('a', 'rule-1', null, 0.5),
      f('b', 'rule-2', '/', 0.4),
    ];
    const { top } = pickTopFindings(findings, '/');
    // both map to '/' so pass 1 picks `a` (higher score) and `b` is
    // page-blocked. Pass 2 still page-blocked. Pass 3 picks `b` (rule-unique).
    expect(top).toHaveLength(2);
  });

  it('returns ranked findings sorted by effective score', () => {
    const findings = [
      f('a', 'rule-1', '/other', 0.5),
      f('b', 'rule-2', '/', 0.4),
    ];
    const { ranked } = pickTopFindings(findings, '/');
    // 0.4 × 1.5 = 0.6 beats 0.5
    expect(ranked[0]?.id).toBe('b');
  });
});

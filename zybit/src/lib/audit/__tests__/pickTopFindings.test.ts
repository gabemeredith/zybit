import { describe, expect, it } from 'vitest';
import {
  collapseDuplicateFindings,
  isOffConversionPath,
  localeNormalizedPath,
  pickTopFindings,
} from '../pickTopFindings';

function f(
  id: string,
  ruleId: string,
  pathRef: string | null,
  priorityScore: number,
) {
  return { id, ruleId, pathRef, priorityScore };
}

// Helper for collapse tests — adds evidence shape.
function fe(
  id: string,
  ruleId: string,
  pathRef: string | null,
  priorityScore: number,
  evidence: Array<{ label: string; value: string | number; context?: string }>,
) {
  return { id, ruleId, pathRef, priorityScore, evidence };
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

  it('treats locale variants as the same logical page', () => {
    // Stripe ships the same homepage at /, /gb, /es, /fr-ca, /en-at — the
    // cascade should pick at most one of these for any given (rule) slot.
    const findings = [
      f('home', 'rule-1', '/', 0.5),
      f('gb', 'rule-1', '/gb', 0.5),
      f('frca', 'rule-1', '/fr-ca', 0.5),
      f('enat', 'rule-1', '/en-at', 0.5),
      f('global', 'rule-1', '/global', 0.5),
      f('pricing', 'rule-2', '/pricing', 0.4),
      f('about', 'rule-3', '/about', 0.3),
      f('blog', 'rule-4', '/blog', 0.2),
    ];
    const { top } = pickTopFindings(findings, '/');
    // Only one homepage-locale finding should win the first slot; the
    // remaining 3 should come from genuinely different pages.
    const homepagePicks = top.filter((x) =>
      ['/', '/gb', '/fr-ca', '/en-at', '/global'].includes(x.pathRef ?? ''),
    );
    expect(homepagePicks).toHaveLength(1);
    expect(top.map((x) => x.pathRef)).toEqual(['/', '/pricing', '/about', '/blog']);
  });

  it('still picks a locale variant when no canonical homepage finding exists', () => {
    // If only /gb has a finding (no / finding), /gb still wins position 1.
    const findings = [
      f('gb', 'rule-1', '/gb', 0.5),
      f('pricing', 'rule-2', '/pricing', 0.4),
    ];
    const { top } = pickTopFindings(findings, '/');
    expect(top.map((x) => x.id)).toEqual(['gb', 'pricing']);
  });
});

describe('collapseDuplicateFindings', () => {
  it('collapses ≥3 identical findings into one with an "Also affects" row', () => {
    // Linear case: 8 pages × "no H1" finding under one rule.
    const linearLikeEvidence = [{ label: 'H1 headings', value: 0 }];
    const findings = [
      fe('a', 'heading-hierarchy-jump', '/billing', 0.5, linearLikeEvidence),
      fe('b', 'heading-hierarchy-jump', '/agent', 0.5, linearLikeEvidence),
      fe('c', 'heading-hierarchy-jump', '/about-us', 0.5, linearLikeEvidence),
      fe('d', 'heading-hierarchy-jump', '/case-studies', 0.5, linearLikeEvidence),
    ];
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(1);
    const ev = out[0].evidence as Array<{ label: string; value: string }>;
    const alsoAffects = ev.find((r) => r.label === 'Also affects');
    expect(alsoAffects).toBeDefined();
    // Representative is whichever was picked; the other 3 paths land in "Also affects"
    expect(alsoAffects!.value.split(',').map((s) => s.trim()).length).toBe(3);
  });

  it('prefers the submitted path as the representative', () => {
    const ev = [{ label: 'Meta description', value: 'absent' }];
    const findings = [
      fe('billing', 'missing-meta', '/billing', 0.5, ev),
      fe('agent', 'missing-meta', '/agent', 0.5, ev),
      fe('home', 'missing-meta', '/', 0.5, ev),
    ];
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(1);
    expect(out[0].pathRef).toBe('/');
  });

  it('leaves groups of <3 unchanged', () => {
    const ev = [{ label: 'H1 headings', value: 0 }];
    const findings = [
      fe('a', 'heading-hierarchy-jump', '/billing', 0.5, ev),
      fe('b', 'heading-hierarchy-jump', '/agent', 0.5, ev),
    ];
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(2);
  });

  it('groups by ruleId AND evidence — different rules with same evidence do not collapse', () => {
    const ev = [{ label: 'H1 headings', value: 0 }];
    const findings = [
      fe('a', 'rule-1', '/x', 0.5, ev),
      fe('b', 'rule-1', '/y', 0.5, ev),
      fe('c', 'rule-1', '/z', 0.5, ev),
      fe('d', 'rule-2', '/x', 0.5, ev),
      fe('e', 'rule-2', '/y', 0.5, ev),
      fe('g', 'rule-2', '/z', 0.5, ev),
    ];
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(2); // one rep per ruleId
  });

  it('different evidence values under same ruleId do NOT collapse', () => {
    // Stripe's link-text-generic on /fr-ca says "Démarrer maintenant",
    // on /es says "Empieza ahora" — different evidence values, shouldn't dedup.
    const findings = [
      fe('frca', 'link-text-generic', '/fr-ca', 0.35, [
        { label: 'Repeated link text "Démarrer maintenant"', value: 4 },
      ]),
      fe('es', 'link-text-generic', '/es', 0.35, [
        { label: 'Repeated link text "Empieza ahora"', value: 4 },
      ]),
      fe('home', 'link-text-generic', '/', 0.35, [
        { label: 'Repeated link text "Get started"', value: 4 },
      ]),
    ];
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(3);
  });

  it('truncates "Also affects" listing past 5 paths with a "+ N more" tail', () => {
    const ev = [{ label: 'H1 headings', value: 0 }];
    const findings = Array.from({ length: 10 }, (_, i) =>
      fe(`f${i}`, 'rule-1', `/page-${i}`, 0.5, ev),
    );
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(1);
    const alsoAffects = (out[0].evidence as Array<{ label: string; value: string }>)
      .find((r) => r.label === 'Also affects')!;
    expect(alsoAffects.value).toMatch(/\+ ?4 more/);
  });

  it('collapses findings where rule embeds pathRef in evidence (missing-canonical-url shape)', () => {
    // `missing-canonical-url` emits `{ label: 'Page path', value: pathRef }`
    // so naive (label, value) signatures would think every page is unique.
    // Filter the pathRef out of the signature before grouping.
    const findings = [
      fe('a', 'missing-canonical-url', '/compare', 0.25, [
        { label: 'Canonical tag', value: 'absent' },
        { label: 'Page path', value: '/compare' },
      ]),
      fe('b', 'missing-canonical-url', '/company', 0.25, [
        { label: 'Canonical tag', value: 'absent' },
        { label: 'Page path', value: '/company' },
      ]),
      fe('c', 'missing-canonical-url', '/champions', 0.25, [
        { label: 'Canonical tag', value: 'absent' },
        { label: 'Page path', value: '/champions' },
      ]),
    ];
    const out = collapseDuplicateFindings(findings, '/');
    expect(out).toHaveLength(1);
  });

  it('end-to-end: collapse → cascade → top-4 has 4 distinct rules', () => {
    // Simulates Linear's pre-fix shape: 8 pages × 3 rules. Expect after
    // collapse + cascade: 3 distinct rules in top-4 (or 4 if a 4th rule exists).
    const evH1 = [{ label: 'H1 headings', value: 0 }];
    const evMeta = [{ label: 'Meta description', value: 'absent' }];
    const evCanonical = [{ label: 'Canonical tag', value: 'absent' }];
    const paths = ['/billing', '/agent', '/about-us', '/compliance', '/compare', '/company', '/champions', '/case-studies'];
    const findings = [
      ...paths.map((p, i) => fe(`h${i}`, 'heading-hierarchy-jump', p, 0.5, evH1)),
      ...paths.map((p, i) => fe(`m${i}`, 'missing-meta-description', p, 0.45, evMeta)),
      ...paths.map((p, i) => fe(`c${i}`, 'missing-canonical-url', p, 0.25, evCanonical)),
    ];
    const deduped = collapseDuplicateFindings(findings, '/');
    expect(deduped).toHaveLength(3); // 3 rules → 3 representatives
    const { top } = pickTopFindings(deduped, '/');
    expect(top).toHaveLength(3);
    const ruleIds = new Set(top.map((x) => x.ruleId));
    expect(ruleIds.size).toBe(3);
  });
});

describe('localeNormalizedPath', () => {
  it.each([
    ['/', '/'],
    ['/en-us', '/'],
    ['/gb', '/'],
    ['/fr-ca', '/'],
    ['/en-at', '/'],
    ['/global', '/'],
    ['/intl', '/'],
    ['/world', '/'],
    ['/zh-cn', '/'],
    ['/pt-br', '/'],
    ['/en-us/pricing', '/pricing'],
    ['/fr-ca/about', '/about'],
    ['/global/products', '/products'],
  ])('%s → %s', (input, expected) => {
    expect(localeNormalizedPath(input)).toBe(expected);
  });

  it.each([
    '/pricing',
    '/about',
    '/blog',
    '/blog/some-post',
    '/contact',
    '/products/payments',
  ])('non-locale path %s stays unchanged', (path) => {
    expect(localeNormalizedPath(path)).toBe(path);
  });

  it('null/undefined → /', () => {
    expect(localeNormalizedPath(null)).toBe('/');
    expect(localeNormalizedPath(undefined)).toBe('/');
  });
});

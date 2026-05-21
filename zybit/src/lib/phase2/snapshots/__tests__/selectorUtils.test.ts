import { describe, it, expect } from 'vitest';
import { buildMinimalHtml, countSelectorMatches, selectorStability } from '../selectorUtils';
import { findStaleSelectors } from '@/lib/experiments/selectorStaleness';
import type { PageSnapshotData } from '../types';
import type { VariantModification } from '@/lib/experiments/types';

function snapshot(): PageSnapshotData {
  return {
    headings: [{ level: 1, text: 'Welcome', documentIndex: 0 }],
    ctas: [
      {
        ref: 'cta-1',
        tag: 'button',
        text: 'Open a checking account',
        href: null,
        ariaLabel: null,
        landmark: 'main',
        visualWeight: 0.25,
        visualWeightSignals: [],
        foldGuess: 'above',
        domDepth: 3,
        documentIndex: 0,
        disabled: false,
      },
    ],
    forms: [
      { ref: 'form-1', landmark: 'main', fieldCount: 2, inputs: [], documentIndex: 0, hasSubmitButton: true },
    ],
  } as unknown as PageSnapshotData;
}

describe('buildMinimalHtml + countSelectorMatches', () => {
  it('renders ctas with data-zybit-ref so ref selectors match', () => {
    const html = buildMinimalHtml(snapshot());
    expect(html).toContain('data-zybit-ref="cta-1"');
    expect(countSelectorMatches(snapshot(), '[data-zybit-ref="cta-1"]')).toEqual({ count: 1, status: 'ok' });
  });

  it('matches by tag (cta button + form submit button)', () => {
    expect(countSelectorMatches(snapshot(), 'button').count).toBe(2);
    expect(countSelectorMatches(snapshot(), 'form').count).toBe(1);
  });

  it('reports zero matches for a selector that is no longer present', () => {
    expect(countSelectorMatches(snapshot(), '.hero-cta-v2')).toEqual({ count: 0, status: 'ok' });
  });

  it('flags empty and invalid selectors distinctly', () => {
    expect(countSelectorMatches(snapshot(), '   ').status).toBe('empty');
    expect(countSelectorMatches(snapshot(), '>>>broken').status).toBe('invalid_selector');
  });
});

describe('selectorStability', () => {
  it('rates id and data-zybit-ref selectors as stable', () => {
    expect(selectorStability('button[data-zybit-ref="cta-1"]')).toBe('stable');
    expect(selectorStability('#hero-cta')).toBe('stable');
  });

  it('rates positional selectors as fragile', () => {
    expect(selectorStability('h1:nth-of-type(2)')).toBe('fragile');
    expect(selectorStability('div > :nth-child(3)')).toBe('fragile');
  });

  it('rates tag/class selectors as medium', () => {
    expect(selectorStability('button.primary')).toBe('medium');
    expect(selectorStability('a[href="/pricing"]')).toBe('medium');
  });
});

describe('findStaleSelectors', () => {
  const mods = (selectors: string[]): VariantModification[] =>
    selectors.map((selector) => ({ type: 'element-hide', selector }));

  it('returns nothing when every selector still matches', () => {
    expect(findStaleSelectors(mods(['button', '[data-zybit-ref="cta-1"]']), snapshot())).toEqual([]);
  });

  it('flags selectors that no longer match as no_match', () => {
    const stale = findStaleSelectors(mods(['.gone-after-redesign']), snapshot());
    expect(stale).toEqual([{ selector: '.gone-after-redesign', reason: 'no_match' }]);
  });

  it('flags invalid selectors', () => {
    const stale = findStaleSelectors(mods(['>>>oops']), snapshot());
    expect(stale).toEqual([{ selector: '>>>oops', reason: 'invalid_selector' }]);
  });

  it('dedupes repeated selectors across modifications', () => {
    const stale = findStaleSelectors(mods(['.gone', '.gone']), snapshot());
    expect(stale).toHaveLength(1);
  });
});

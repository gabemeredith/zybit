import { describe, it, expect } from 'vitest';
import { buildMinimalHtml, countSelectorMatches, selectorStability } from '../selectorUtils';
import { findStaleSelectors } from '@/lib/experiments/selectorStaleness';
import type { PageSnapshotData } from '../types';
import type { VariantModification } from '@/lib/experiments/types';

function snapshot(): PageSnapshotData {
  return {
    headings: [{ level: 1, text: 'Welcome', documentIndex: 0, cssSelector: null }],
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

function snapshotWithFormSelector(cssSelector: string): PageSnapshotData {
  return {
    headings: [],
    ctas: [],
    forms: [
      {
        ref: 'form-1',
        landmark: 'main',
        fieldCount: 2,
        inputs: [],
        documentIndex: 0,
        hasSubmitButton: true,
        cssSelector,
      },
    ],
  } as unknown as PageSnapshotData;
}

function snapshotWithCtaSelector(cssSelector: string, ariaLabel: string | null = null): PageSnapshotData {
  return {
    headings: [],
    ctas: [
      {
        ref: 'cta-1',
        tag: 'button',
        text: 'Sign up',
        href: null,
        ariaLabel,
        landmark: 'main',
        visualWeight: 0.5,
        visualWeightSignals: [],
        foldGuess: 'above',
        domDepth: 3,
        documentIndex: 0,
        disabled: false,
        cssSelector,
      },
    ],
    forms: [],
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

describe('buildMinimalHtml — attrsFromCssSelector re-emission', () => {
  // Each case asserts both (a) the right attribute is on the synthesised
  // element, and (b) the parser-emitted cssSelector matches that element in
  // the validator — which is the bug this helper exists to close.

  it('re-emits id="…" from a bare `#id` cssSelector', () => {
    const data = snapshotWithCtaSelector('#signup-btn');
    const html = buildMinimalHtml(data);
    expect(html).toContain('id="signup-btn"');
    expect(countSelectorMatches(data, '#signup-btn')).toEqual({ count: 1, status: 'ok' });
  });

  it('re-emits data-testid="…" from a [data-testid="…"] cssSelector', () => {
    const data = snapshotWithCtaSelector('[data-testid="signup-cta"]');
    const html = buildMinimalHtml(data);
    expect(html).toContain('data-testid="signup-cta"');
    expect(countSelectorMatches(data, '[data-testid="signup-cta"]')).toEqual({
      count: 1,
      status: 'ok',
    });
  });

  it('re-emits name="…" from a `tag[name="…"]` cssSelector', () => {
    const data = snapshotWithCtaSelector('button[name="newsletter"]');
    const html = buildMinimalHtml(data);
    expect(html).toContain('name="newsletter"');
    expect(countSelectorMatches(data, 'button[name="newsletter"]')).toEqual({
      count: 1,
      status: 'ok',
    });
  });

  // Form-side parity: pickSelectorForFinding now resolves formRef against
  // form.cssSelector for form-abandonment findings, so the synthesised
  // <form> element must also re-emit the parser-emitted attribute. Without
  // this, the validator badge stays red for the one finding shape this PR
  // added form support for.
  it('re-emits data-testid="…" on <form> from form.cssSelector', () => {
    const data = snapshotWithFormSelector('[data-testid="signup-form"]');
    const html = buildMinimalHtml(data);
    expect(html).toContain('data-testid="signup-form"');
    expect(countSelectorMatches(data, '[data-testid="signup-form"]')).toEqual({
      count: 1,
      status: 'ok',
    });
  });

  it('re-emits id="…" on <form> from a bare `#id` cssSelector', () => {
    const data = snapshotWithFormSelector('#signup');
    const html = buildMinimalHtml(data);
    expect(html).toContain('id="signup"');
    expect(countSelectorMatches(data, '#signup')).toEqual({ count: 1, status: 'ok' });
  });

  it('re-emits role="…" but does not duplicate aria-label (already emitted from cta.ariaLabel)', () => {
    const data = snapshotWithCtaSelector('[role="button"][aria-label="Close"]', 'Close');
    const html = buildMinimalHtml(data);
    expect(html).toContain('role="button"');
    // aria-label appears exactly once — emitted from `cta.ariaLabel`, not
    // duplicated by attrsFromCssSelector. The skip is what keeps the
    // synthesised element valid HTML and the selector match unambiguous.
    expect(html.match(/aria-label="Close"/g)).toHaveLength(1);
    expect(
      countSelectorMatches(data, '[role="button"][aria-label="Close"]'),
    ).toEqual({ count: 1, status: 'ok' });
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

  it('does not rate anchor hrefs as stable (regex must not match # inside attribute values)', () => {
    expect(selectorStability('a[href="#pricing"]')).toBe('medium');
    expect(selectorStability('a[href="/checkout#tier-pro"]')).toBe('medium');
  });

  it('still recognises real IDs after a combinator or comma', () => {
    expect(selectorStability('nav a, #cta')).toBe('stable');
    expect(selectorStability('main > #hero')).toBe('stable');
    expect(selectorStability('button + #checkout-cta')).toBe('stable');
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

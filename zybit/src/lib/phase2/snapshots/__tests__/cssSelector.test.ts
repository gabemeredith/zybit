import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import { computeCssSelector } from '../cssSelector';

function el(html: string, tag: string = 'button') {
  const root = parse(html);
  const found = root.querySelector(tag);
  if (!found) throw new Error(`no ${tag} in ${html}`);
  return found;
}

describe('computeCssSelector — testid family (most stable)', () => {
  it('prefers data-testid over anything else', () => {
    const e = el('<button data-testid="signup-cta" id="real-id" name="cta">Go</button>');
    expect(computeCssSelector(e, 'button')).toBe('[data-testid="signup-cta"]');
  });

  it('accepts data-test, data-qa, data-cy in that order', () => {
    expect(computeCssSelector(el('<button data-test="x">Go</button>'), 'button'))
      .toBe('[data-test="x"]');
    expect(computeCssSelector(el('<button data-qa="x">Go</button>'), 'button'))
      .toBe('[data-qa="x"]');
    expect(computeCssSelector(el('<button data-cy="x">Go</button>'), 'button'))
      .toBe('[data-cy="x"]');
  });

  it('rejects unsafe testid values', () => {
    // Spaces, quotes, etc. — bail rather than try to escape.
    expect(computeCssSelector(el('<button data-testid="has space">Go</button>'), 'button'))
      .toBeNull();
    expect(computeCssSelector(el('<button data-testid=\'has"quote\'>Go</button>'), 'button'))
      .toBeNull();
  });

  it('higher-priority testid attr wins over lower-priority one', () => {
    const e = el('<button data-testid="A" data-qa="B">Go</button>');
    expect(computeCssSelector(e, 'button')).toBe('[data-testid="A"]');
  });
});

describe('computeCssSelector — id (second rung)', () => {
  it('accepts a human-authored id', () => {
    expect(computeCssSelector(el('<button id="primary-cta">Go</button>'), 'button'))
      .toBe('#primary-cta');
  });

  it('rejects React useId-style auto-generated ids', () => {
    expect(computeCssSelector(el('<button id=":r0:">Go</button>'), 'button')).toBeNull();
    expect(computeCssSelector(el('<button id=":r3a:">Go</button>'), 'button')).toBeNull();
  });

  it('rejects ids that look like hashed framework output', () => {
    // Long uninterrupted hex run with little human-readable content.
    expect(computeCssSelector(el('<button id="a1b2c3d4e5f6">Go</button>'), 'button'))
      .toBeNull();
  });

  it('accepts a hyphenated kebab-case id that contains some hex', () => {
    // "data-grid-1a" is human-authored even though it has hex chars.
    expect(computeCssSelector(el('<button id="data-grid-1a">Go</button>'), 'button'))
      .toBe('#data-grid-1a');
  });

  it('falls through to id when testid is absent', () => {
    expect(computeCssSelector(el('<button id="signup">Go</button>'), 'button'))
      .toBe('#signup');
  });
});

describe('computeCssSelector — name (third rung)', () => {
  it('emits `tag[name=...]` for a named element', () => {
    expect(computeCssSelector(el('<button name="submit-form">Go</button>'), 'button'))
      .toBe('button[name="submit-form"]');
  });

  it('uses the tag the caller passed in', () => {
    expect(computeCssSelector(el('<input name="email" />', 'input'), 'input'))
      .toBe('input[name="email"]');
  });

  it('rejects unsafe name values', () => {
    expect(computeCssSelector(el('<button name="weird name">Go</button>'), 'button'))
      .toBeNull();
  });
});

describe('computeCssSelector — role + aria-label (fourth rung)', () => {
  it('emits `[role][aria-label]` when both are present', () => {
    const e = el('<button role="button" aria-label="Open menu">Go</button>');
    expect(computeCssSelector(e, 'button')).toBe('[role="button"][aria-label="Open menu"]');
  });

  it('requires both role and aria-label', () => {
    expect(computeCssSelector(el('<button role="button">Go</button>'), 'button')).toBeNull();
    expect(computeCssSelector(el('<button aria-label="Go now">Go</button>'), 'button')).toBeNull();
  });

  it('bails when aria-label has unsafe characters', () => {
    const e = el('<button role="button" aria-label=\'has "quote\'>Go</button>');
    expect(computeCssSelector(e, 'button')).toBeNull();
  });
});

describe('computeCssSelector — bail', () => {
  it('returns null when only classes are present', () => {
    expect(computeCssSelector(el('<button class="btn btn-primary">Go</button>'), 'button'))
      .toBeNull();
  });

  it('returns null for a bare element with no attributes', () => {
    expect(computeCssSelector(el('<button>Go</button>'), 'button')).toBeNull();
  });
});

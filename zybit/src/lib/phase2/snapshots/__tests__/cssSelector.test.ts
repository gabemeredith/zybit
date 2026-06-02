import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import { computeCssSelector, stableSelector } from '../cssSelector';
import { selectorStability } from '../selectorUtils';

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

  it('rejects unsafe testid values (stable ladder bails to null)', () => {
    // Spaces, quotes, etc. — bail rather than try to escape.
    expect(stableSelector(el('<button data-testid="has space">Go</button>'), 'button'))
      .toBeNull();
    expect(stableSelector(el('<button data-testid=\'has"quote\'>Go</button>'), 'button'))
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
    expect(stableSelector(el('<button id=":r0:">Go</button>'), 'button')).toBeNull();
    expect(stableSelector(el('<button id=":r3a:">Go</button>'), 'button')).toBeNull();
  });

  it('rejects ids that look like hashed framework output', () => {
    // Long uninterrupted hex run with little human-readable content.
    expect(stableSelector(el('<button id="a1b2c3d4e5f6">Go</button>'), 'button'))
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
    expect(stableSelector(el('<button name="weird name">Go</button>'), 'button'))
      .toBeNull();
  });
});

describe('computeCssSelector — role + aria-label (fourth rung)', () => {
  it('emits `[role][aria-label]` when both are present', () => {
    const e = el('<button role="button" aria-label="Open menu">Go</button>');
    expect(computeCssSelector(e, 'button')).toBe('[role="button"][aria-label="Open menu"]');
  });

  it('requires both role and aria-label', () => {
    expect(stableSelector(el('<button role="button">Go</button>'), 'button')).toBeNull();
    expect(stableSelector(el('<button aria-label="Go now">Go</button>'), 'button')).toBeNull();
  });

  it('bails when aria-label has unsafe characters', () => {
    const e = el('<button role="button" aria-label=\'has "quote\'>Go</button>');
    expect(stableSelector(e, 'button')).toBeNull();
  });
});

describe('computeCssSelector — positional fallback (rung 5)', () => {
  it('returns a positional nth-of-type selector for a class-only element', () => {
    const sel = computeCssSelector(el('<button class="btn btn-primary">Go</button>'), 'button');
    expect(sel).toBe('button:nth-of-type(1)');
    expect(selectorStability(sel)).toBe('fragile');
  });

  it('returns a positional selector for a bare element (never null)', () => {
    expect(computeCssSelector(el('<button>Go</button>'), 'button')).toBe('button:nth-of-type(1)');
  });

  it('anchors the path on the nearest stable-selector ancestor', () => {
    const root = parse('<div id="main"><section><a class="x">A</a><a class="y">B</a></section></div>');
    const a = root.querySelectorAll('a')[1];
    const sel = computeCssSelector(a, 'a');
    expect(sel).toBe('#main > section:nth-of-type(1) > a:nth-of-type(2)');
    // The #id anchor lifts the whole path to 'stable' under selectorStability's
    // first-match rule — an id-anchored path is more robust than a bare one.
    expect(selectorStability(sel)).toBe('stable');
  });

  it('roots the path at body when no stable ancestor exists', () => {
    const root = parse('<body><div><button class="c">Go</button></div></body>');
    const b = root.querySelector('button');
    expect(computeCssSelector(b!, 'button')).toBe(
      'body > div:nth-of-type(1) > button:nth-of-type(1)',
    );
  });
});

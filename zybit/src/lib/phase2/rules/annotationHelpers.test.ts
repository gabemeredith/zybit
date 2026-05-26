import { describe, expect, it } from 'vitest';
import { firstHeadingSelector, nthOfTypeIndex } from './annotationHelpers';
import type { HeadingItem } from '@/lib/phase2/snapshots/types';

function h(level: 1 | 2 | 3 | 4 | 5 | 6, documentIndex: number, text = `h${level}-${documentIndex}`): HeadingItem {
  return { level, documentIndex, text };
}

describe('nthOfTypeIndex', () => {
  it('returns 1 for a single same-level heading at the top of the document', () => {
    const headings = [h(1, 0)];
    expect(nthOfTypeIndex(headings, headings[0])).toBe(1);
  });

  it('ignores headings of other levels — `:nth-of-type` is per-tag', () => {
    // [h2 idx=0, h1 idx=1] — the h1 is the SECOND heading in document order
    // but the FIRST h1, so its :nth-of-type index is 1, not 2 (which would
    // match nothing).
    const headings = [h(2, 0), h(1, 1)];
    expect(nthOfTypeIndex(headings, headings[1])).toBe(1);
    // The h2 is also the first h2 → 1.
    expect(nthOfTypeIndex(headings, headings[0])).toBe(1);
  });

  it('counts only earlier same-level headings', () => {
    // [h2 idx=0, h1 idx=1, h2 idx=2, h2 idx=3]
    const headings = [h(2, 0), h(1, 1), h(2, 2), h(2, 3)];
    expect(nthOfTypeIndex(headings, headings[0])).toBe(1); // first h2
    expect(nthOfTypeIndex(headings, headings[1])).toBe(1); // first (only) h1
    expect(nthOfTypeIndex(headings, headings[2])).toBe(2); // second h2
    expect(nthOfTypeIndex(headings, headings[3])).toBe(3); // third h2
  });

  it('works when target is not the same object reference as the heading in the array', () => {
    // Regression: Next.js server components serialize/deserialize the
    // snapshot across the RSC boundary, so callers commonly pass back a
    // cloned heading. Reference-equality short-circuiting would fail and
    // double-count the target itself.
    const headings = [h(2, 0), h(1, 1), h(1, 2)];
    const cloned = { ...headings[1] }; // different object, same documentIndex
    expect(nthOfTypeIndex(headings, cloned)).toBe(1);
    const clonedSecond = { ...headings[2] };
    expect(nthOfTypeIndex(headings, clonedSecond)).toBe(2);
  });
});

describe('firstHeadingSelector', () => {
  it('returns null when the snapshot has no headings', () => {
    expect(firstHeadingSelector([])).toBe(null);
  });

  it('prefers the first h1 and emits per-tag nth-of-type, not documentIndex+1', () => {
    // Regression: previously emitted `h1:nth-of-type(2)` because the h1
    // had documentIndex=1, which matches nothing in the rendered DOM.
    expect(firstHeadingSelector([h(2, 0), h(1, 1)])).toBe('h1:nth-of-type(1)');
  });

  it('falls back to the earliest heading when there is no h1', () => {
    expect(firstHeadingSelector([h(2, 0), h(3, 1)])).toBe('h2:nth-of-type(1)');
  });

  it('emits :nth-of-type(1) for the only h1', () => {
    expect(firstHeadingSelector([h(1, 0), h(2, 1)])).toBe('h1:nth-of-type(1)');
  });
});

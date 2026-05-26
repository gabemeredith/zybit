import { describe, expect, it } from 'vitest';
import { validateModifications } from './types';

describe('validateModifications — top level', () => {
  it('rejects non-array input', () => {
    expect(validateModifications(null)).toContain('array');
    expect(validateModifications({})).toContain('array');
  });

  it('rejects an element that is not an object', () => {
    expect(validateModifications(['nope'])).toMatch(/must be an object/);
  });

  it('rejects an unknown type', () => {
    expect(validateModifications([{ type: 'mystery' }])).toMatch(/unknown/i);
  });

  it('accepts a valid mixed array', () => {
    expect(
      validateModifications([
        { type: 'css-inject', selector: '.x', css: 'color:red' },
        { type: 'text-replace', selector: 'h1', text: 'hi' },
        { type: 'element-hide', selector: '.x' },
        { type: 'element-show', selector: '.x' },
        { type: 'attribute-set', selector: '.x', attr: 'aria-label', value: 'hi' },
        { type: 'element-reorder', parentSelector: '.x', childOrder: [0, 1, 2] },
        { type: 'element-insert', selector: 'h1', position: 'before', html: '<p>x</p>' },
      ]),
    ).toBe(null);
  });
});

describe('validateModifications — element-insert', () => {
  it('rejects element-insert with a bad position', () => {
    const err = validateModifications([
      { type: 'element-insert', selector: 'h1', position: 'sideways', html: '<p>x</p>' },
    ]);
    expect(err).toMatch(/position/);
    expect(err).toMatch(/before|after|prepend|append/);
  });

  it('rejects element-insert with missing html', () => {
    const err = validateModifications([
      { type: 'element-insert', selector: 'h1', position: 'before' },
    ]);
    expect(err).toMatch(/html/);
  });

  it('rejects element-insert with non-string selector', () => {
    const err = validateModifications([
      { type: 'element-insert', selector: 123, position: 'before', html: '<p>x</p>' },
    ]);
    expect(err).toMatch(/selector/);
  });

  it('rejects element-insert with empty-string selector', () => {
    const err = validateModifications([
      { type: 'element-insert', selector: '', position: 'before', html: '<p>x</p>' },
    ]);
    expect(err).toMatch(/selector/);
  });

  it('rejects element-insert with empty html (proxy-time no-op → control-identical variant)', () => {
    const err = validateModifications([
      { type: 'element-insert', selector: 'h1', position: 'before', html: '' },
    ]);
    expect(err).toMatch(/html/);
    expect(err).toMatch(/non-empty/);
  });

  it('rejects whitespace-only selectors (would throw DOMException at proxy time)', () => {
    // `querySelector("   ")` throws SyntaxError; the validator must catch it
    // here so the experiment doesn't crash mid-run.
    expect(
      validateModifications([{ type: 'css-inject', selector: '   ', css: 'color:red' }]),
    ).toMatch(/selector/);
    expect(
      validateModifications([{ type: 'element-insert', selector: '\t\n', position: 'before', html: '<p>x</p>' }]),
    ).toMatch(/selector/);
  });
});

describe('validateModifications — per-type field checks', () => {
  it('rejects attribute-set missing attr', () => {
    expect(validateModifications([{ type: 'attribute-set', selector: '.x', value: 'hi' }])).toMatch(/attr/);
  });

  it('rejects element-reorder with non-integer childOrder', () => {
    expect(
      validateModifications([{ type: 'element-reorder', parentSelector: '.x', childOrder: [0, 1.5] }]),
    ).toMatch(/childOrder/);
  });

  it('rejects element-reorder with negative childOrder index', () => {
    expect(
      validateModifications([{ type: 'element-reorder', parentSelector: '.x', childOrder: [0, -1] }]),
    ).toMatch(/childOrder/);
  });

  it('rejects css-inject without css string', () => {
    expect(validateModifications([{ type: 'css-inject', selector: '.x' }])).toMatch(/css/);
  });
});

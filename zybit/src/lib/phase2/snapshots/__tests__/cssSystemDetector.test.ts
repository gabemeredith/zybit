import { describe, it, expect } from 'vitest';
import { detectCssSystem, extractClassTokens } from '../cssSystemDetector';

describe('extractClassTokens', () => {
  it('extracts tokens from class attributes', () => {
    const html = '<div class="bg-blue-600 text-white px-4"></div>';
    expect(extractClassTokens(html)).toEqual(
      expect.arrayContaining(['bg-blue-600', 'text-white', 'px-4'])
    );
  });

  it('extracts tokens from className attributes', () => {
    const html = '<div className="flex items-center gap-2"></div>';
    expect(extractClassTokens(html)).toEqual(
      expect.arrayContaining(['flex', 'items-center', 'gap-2'])
    );
  });

  it('deduplicates tokens across elements', () => {
    const html = '<div class="flex"><span class="flex text-sm"></span></div>';
    const tokens = extractClassTokens(html);
    expect(tokens.filter((t) => t === 'flex')).toHaveLength(1);
  });
});

describe('detectCssSystem', () => {
  it('detects tailwind from utility classes', () => {
    const tokens = [
      'bg-blue-600', 'text-white', 'px-4', 'py-2', 'rounded-lg',
      'flex', 'items-center', 'gap-2', 'font-bold', 'text-sm',
    ];
    expect(detectCssSystem(tokens)).toBe('tailwind');
  });

  it('detects styled-components from sc- prefixes', () => {
    const tokens = ['sc-bdVTJa', 'sc-hKMtZM', 'sc-gsTCUz', 'bGkMhC', 'eAfhiz'];
    expect(detectCssSystem(tokens)).toBe('styled-components');
  });

  it('detects emotion from css- prefixes', () => {
    const tokens = ['css-1234abc', 'css-5678def', 'css-9012ghi'];
    expect(detectCssSystem(tokens)).toBe('emotion');
  });

  it('detects bootstrap from known utility classes', () => {
    const tokens = ['container', 'row', 'col', 'btn', 'btn-primary', 'navbar', 'd-flex'];
    expect(detectCssSystem(tokens)).toBe('bootstrap');
  });

  it('returns unknown for unrecognized classes', () => {
    const tokens = ['my-button', 'hero-section', 'page-wrapper'];
    expect(detectCssSystem(tokens)).toBe('unknown');
  });

  it('returns unknown for empty token list', () => {
    expect(detectCssSystem([])).toBe('unknown');
  });
});

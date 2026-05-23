import { describe, expect, it } from 'vitest';
import { extractDesignTokens } from '../tokenExtractor';

describe('extractDesignTokens', () => {
  it('returns null for missing or empty input', () => {
    expect(extractDesignTokens(null)).toBeNull();
    expect(extractDesignTokens(undefined)).toBeNull();
    expect(extractDesignTokens({})).toBeNull();
  });

  it('picks primaryColor as the most-frequent CTA backgroundColor', () => {
    const tokens = extractDesignTokens({
      'cta:a': { backgroundColor: '#1a56db' },
      'cta:b': { backgroundColor: '#1a56db' },
      'cta:c': { backgroundColor: '#eee' },
    });
    expect(tokens?.primaryColor).toBe('#1a56db');
  });

  it('picks secondaryColor as the most-frequent heading color', () => {
    const tokens = extractDesignTokens({
      'heading:h1-0': { color: '#111827' },
      'heading:h2-1': { color: '#111827' },
      'heading:h2-2': { color: '#374151' },
    });
    expect(tokens?.secondaryColor).toBe('#111827');
  });

  it('builds typeScale as sorted unique heading font sizes (px)', () => {
    const tokens = extractDesignTokens({
      'heading:h1-0': { fontSize: '48px' },
      'heading:h2-1': { fontSize: '24px' },
      'heading:h2-2': { fontSize: '24px' },
      'heading:h3-3': { fontSize: '18px' },
    });
    expect(tokens?.typeScale).toEqual([18, 24, 48]);
  });

  it('breaks mode ties by first occurrence', () => {
    const tokens = extractDesignTokens({
      'cta:a': { backgroundColor: '#first' },
      'cta:b': { backgroundColor: '#second' },
    });
    expect(tokens?.primaryColor).toBe('#first');
  });

  it('omits tokens whose source signal is absent', () => {
    const tokens = extractDesignTokens({
      'cta:a': { backgroundColor: '#1a56db' },
    });
    expect(tokens).toEqual({ primaryColor: '#1a56db' });
    expect(tokens).not.toHaveProperty('secondaryColor');
    expect(tokens).not.toHaveProperty('typeScale');
  });

  it('ignores non-px font sizes and malformed values', () => {
    const tokens = extractDesignTokens({
      'heading:h1-0': { fontSize: '1.5rem' },
      'heading:h2-1': { fontSize: '24px' },
      'heading:h3-2': { fontSize: 'inherit' },
      'heading:h4-3': { fontSize: '0px' },
    });
    expect(tokens?.typeScale).toEqual([24]);
  });

  it('accepts fractional px values', () => {
    const tokens = extractDesignTokens({
      'heading:h1-0': { fontSize: '18.5px' },
      'heading:h2-1': { fontSize: '14px' },
    });
    expect(tokens?.typeScale).toEqual([14, 18.5]);
  });

  it('ignores non-cta/non-heading keys (e.g. _page)', () => {
    const tokens = extractDesignTokens({
      _page: { backgroundColor: '#fafafa', color: '#1f2937' },
      'cta:a': { backgroundColor: '#1a56db' },
    });
    expect(tokens).toEqual({ primaryColor: '#1a56db' });
  });

  it('tolerates missing fields and weird shapes', () => {
    const tokens = extractDesignTokens({
      'cta:a': null,
      'cta:b': { selector: 'button' },
      'cta:c': { backgroundColor: '#1a56db' },
      'heading:h1-0': 'not-an-object' as unknown as Record<string, unknown>,
      'heading:h2-1': { color: '#111827', fontSize: '24px' },
    });
    expect(tokens).toEqual({
      primaryColor: '#1a56db',
      secondaryColor: '#111827',
      typeScale: [24],
    });
  });
});

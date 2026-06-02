import { describe, it, expect } from 'vitest';
import {
  deriveSlugFromDomain,
  isValidSlug,
  suggestAlternativeSlug,
  RESERVED_SLUGS,
} from '../slug';

describe('deriveSlugFromDomain', () => {
  it('takes the first label and lowercases', () => {
    expect(deriveSlugFromDomain('Acme.com')).toBe('acme');
    expect(deriveSlugFromDomain('Foo.Bar.Co')).toBe('foo');
  });

  it('strips protocol and trailing path', () => {
    expect(deriveSlugFromDomain('https://acme.com/pricing')).toBe('acme');
    expect(deriveSlugFromDomain('http://www.example.org')).toBe('www');
  });

  it('replaces non-slug characters with hyphens and trims them', () => {
    expect(deriveSlugFromDomain('hello_world.com')).toBe('hello-world');
    expect(deriveSlugFromDomain('-acme-.com')).toBe('acme');
  });
});

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('acme')).toEqual({ ok: true });
    expect(isValidSlug('acme-test')).toEqual({ ok: true });
    expect(isValidSlug('a1b2c3')).toEqual({ ok: true });
  });

  it('rejects too-short, too-long, or bad-format slugs', () => {
    expect(isValidSlug('').ok).toBe(false);
    expect(isValidSlug('ab').ok).toBe(false);
    expect(isValidSlug('a'.repeat(33)).ok).toBe(false);
    expect(isValidSlug('-acme').ok).toBe(false);
    expect(isValidSlug('acme-').ok).toBe(false);
    expect(isValidSlug('ACME').ok).toBe(false);
    expect(isValidSlug('acme.test').ok).toBe(false);
  });

  it('rejects reserved slugs', () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(isValidSlug(reserved).ok).toBe(false);
    }
  });
});

describe('suggestAlternativeSlug', () => {
  it('appends -2 when base is taken', () => {
    expect(suggestAlternativeSlug('acme', new Set(['acme']))).toBe('acme-2');
  });

  it('skips taken alternatives', () => {
    expect(
      suggestAlternativeSlug('acme', new Set(['acme', 'acme-2', 'acme-3'])),
    ).toBe('acme-4');
  });

  it('returns a deterministic suggestion when nothing in range is free', () => {
    const taken = new Set<string>(['acme']);
    for (let i = 2; i < 100; i += 1) taken.add(`acme-${i}`);
    const result = suggestAlternativeSlug('acme', taken);
    expect(result.startsWith('acme-')).toBe(true);
    expect(taken.has(result)).toBe(false);
  });
});

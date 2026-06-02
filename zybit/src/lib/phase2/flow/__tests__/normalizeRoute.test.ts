import { describe, expect, it } from 'vitest';
import { normalizeRoute } from '../normalizeRoute';

describe('normalizeRoute', () => {
  it('returns root for empty / slash / blank input', () => {
    expect(normalizeRoute('')).toBe('/');
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('   ')).toBe('/');
  });

  it('strips query string and hash fragment', () => {
    expect(normalizeRoute('/pricing?utm=x')).toBe('/pricing');
    expect(normalizeRoute('/pricing#plans')).toBe('/pricing');
    expect(normalizeRoute('/pricing?a=1#b')).toBe('/pricing');
  });

  it('trims a trailing slash but keeps root', () => {
    expect(normalizeRoute('/pricing/')).toBe('/pricing');
    expect(normalizeRoute('/')).toBe('/');
  });

  it('adds a leading slash when missing', () => {
    expect(normalizeRoute('pricing')).toBe('/pricing');
  });

  it('collapses all-digit id segments to :id', () => {
    expect(normalizeRoute('/orders/8841')).toBe('/orders/:id');
    expect(normalizeRoute('/orders/8841/items/2')).toBe('/orders/:id/items/:id');
  });

  it('collapses UUID and long-hex segments to :id', () => {
    expect(normalizeRoute('/u/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('/u/:id');
    expect(normalizeRoute('/t/0123456789abcdef0123')).toBe('/t/:id');
  });

  it('keeps short slug segments unchanged', () => {
    expect(normalizeRoute('/blog/why-zybit')).toBe('/blog/why-zybit');
    expect(normalizeRoute('/orders/new')).toBe('/orders/new');
  });
});

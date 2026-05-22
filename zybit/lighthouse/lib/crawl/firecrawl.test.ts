import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapSite } from './firecrawl';

const ORIGINAL_KEY = process.env.FIRECRAWL_API_KEY;

function mockFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }) as unknown as typeof fetch;
}

describe('mapSite', () => {
  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = ORIGINAL_KEY;
    vi.restoreAllMocks();
  });

  it('throws when the API key is missing', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(mapSite('https://example.com', 10)).rejects.toThrow(/FIRECRAWL_API_KEY/);
  });

  it('dedupes by path, drops cross-origin + non-HTML, and caps shallowest-first', async () => {
    globalThis.fetch = mockFetch({
      success: true,
      links: [
        'https://example.com/',
        'https://example.com/pricing',
        'https://example.com/pricing/', // trailing-slash dup of /pricing
        'https://example.com/about',
        'https://example.com/blog/post-1',
        'https://other.com/elsewhere', // cross-origin — dropped
        'https://example.com/logo.png', // non-HTML asset — dropped
      ],
    });
    const r = await mapSite('https://example.com/', 3);
    expect(r.discovered).toBe(4); // /, /pricing, /about, /blog/post-1
    expect(r.pages.length).toBe(3); // capped
    expect(r.pages[0].pathRef).toBe('/'); // shallowest first
    expect(r.pages.every((p) => p.url.startsWith('https://example.com'))).toBe(true);
    expect(r.pages.some((p) => p.pathRef.includes('logo'))).toBe(false);
  });

  it('always includes the requested url even when /map omits it', async () => {
    globalThis.fetch = mockFetch({ success: true, links: ['https://example.com/other'] });
    const r = await mapSite('https://example.com/landing', 10);
    expect(r.pages.some((p) => p.pathRef === '/landing')).toBe(true);
  });

  it('accepts object-shaped link entries', async () => {
    globalThis.fetch = mockFetch({
      success: true,
      links: [{ url: 'https://example.com/features' }],
    });
    const r = await mapSite('https://example.com/', 10);
    expect(r.pages.some((p) => p.pathRef === '/features')).toBe(true);
  });

  it('throws when Firecrawl reports success:false', async () => {
    globalThis.fetch = mockFetch({ success: false, error: 'rate limited' });
    await expect(mapSite('https://example.com', 5)).rejects.toThrow(/rate limited/);
  });

  it('throws on a non-200 response', async () => {
    globalThis.fetch = mockFetch({}, false, 500);
    await expect(mapSite('https://example.com', 5)).rejects.toThrow(/HTTP 500/);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSsrfGuard, isPrivateIp, isSafePreviewHost } from '../preview';

describe('isPrivateIp', () => {
  it('flags IPv4 loopback', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.255.255.255')).toBe(true);
  });

  it('flags RFC1918 ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
  });

  it('does NOT flag near-RFC1918 ranges', () => {
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('192.167.1.1')).toBe(false);
    expect(isPrivateIp('11.0.0.1')).toBe(false);
  });

  it('flags link-local + cloud metadata (169.254.169.254)', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('169.254.0.1')).toBe(true);
  });

  it('flags CGNAT (100.64.0.0/10)', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('100.127.255.255')).toBe(true);
    expect(isPrivateIp('100.63.255.255')).toBe(false);
    expect(isPrivateIp('100.128.0.1')).toBe(false);
  });

  it('flags 0.0.0.0/8', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isPrivateIp('0.1.2.3')).toBe(true);
  });

  it('flags IPv6 loopback + link-local + ULA', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12:3456:789a::1')).toBe(true);
  });

  it('flags IPv4-mapped IPv6 (::ffff:127.0.0.1)', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('does NOT flag public addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('isSafePreviewHost', () => {
  it('rejects literal localhost', async () => {
    const r = await isSafePreviewHost('localhost');
    expect(r.ok).toBe(false);
  });

  it('rejects subdomains of localhost', async () => {
    const r = await isSafePreviewHost('foo.localhost');
    expect(r.ok).toBe(false);
  });

  it('rejects private IP literals as hostnames', async () => {
    expect((await isSafePreviewHost('127.0.0.1')).ok).toBe(false);
    expect((await isSafePreviewHost('169.254.169.254')).ok).toBe(false);
    expect((await isSafePreviewHost('10.0.0.1')).ok).toBe(false);
  });
});

// Mock-fetch helper that returns a queued sequence of responses.
// Each call to fetch consumes the next queued entry.
function mockFetchQueue(responses: Array<{ status: number; location?: string; body?: string }>) {
  const fn = vi.fn().mockImplementation(async () => {
    const next = responses.shift();
    if (!next) throw new Error('mockFetchQueue exhausted');
    return new Response(next.body ?? '', {
      status: next.status,
      headers: next.location ? { location: next.location } : {},
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchWithSsrfGuard — redirect handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows a same-host 200 (no redirect)', async () => {
    mockFetchQueue([{ status: 200, body: '<html>hi</html>' }]);
    const r = await fetchWithSsrfGuard('https://example.com/', true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe('<html>hi</html>');
  });

  it('rejects when a public URL redirects to a loopback host', async () => {
    // The pre-fetch check passes for example.com (public), but the 302
    // points to 127.0.0.1 — the per-hop guard must catch it before issuing
    // the second fetch.
    mockFetchQueue([
      { status: 302, location: 'http://127.0.0.1/admin' },
      // No second response queued — if the SSRF check fails to fire, the
      // exhausted queue throws and the test fails loudly.
    ]);
    const r = await fetchWithSsrfGuard('https://example.com/', true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toMatch(/127\.0\.0\.1/);
    }
  });

  it('rejects when redirect resolves to a private RFC1918 host', async () => {
    mockFetchQueue([{ status: 301, location: 'http://10.0.0.5/' }]);
    const r = await fetchWithSsrfGuard('https://example.com/', true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/10\.0\.0\.5/);
  });

  it('rejects when redirect resolves to cloud metadata IP', async () => {
    mockFetchQueue([{ status: 307, location: 'http://169.254.169.254/' }]);
    const r = await fetchWithSsrfGuard('https://example.com/', true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/169\.254\.169\.254/);
  });

  it('allows a redirect to another public host', async () => {
    // 1.1.1.1 is a public IP — isPrivateIp returns false, and as an IP
    // literal it never hits DNS lookup, keeping the test hermetic.
    mockFetchQueue([
      { status: 302, location: 'https://1.1.1.1/page' },
      { status: 200, body: '<html>final</html>' },
    ]);
    const r = await fetchWithSsrfGuard('https://8.8.8.8/', true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe('<html>final</html>');
  });

  it('caps redirect chains at MAX_REDIRECT_HOPS', async () => {
    // 7 hops all to public IP literals (no DNS, no private-IP rejection).
    mockFetchQueue(
      Array.from({ length: 7 }, () => ({ status: 302, location: 'https://1.1.1.1/' })),
    );
    const r = await fetchWithSsrfGuard('https://8.8.8.8/', true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Too many redirects/);
  });

  it('errors when 3xx is returned with no Location header', async () => {
    mockFetchQueue([{ status: 302 }]);
    const r = await fetchWithSsrfGuard('https://example.com/', true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no Location header/);
  });

  it('skips SSRF check when enforceSsrfGuard=false (lighthouse path)', async () => {
    // Lighthouse-slug requests legitimately hit localhost.
    mockFetchQueue([{ status: 200, body: '<html>lh</html>' }]);
    const r = await fetchWithSsrfGuard('http://localhost:3001/fake-sites/x/y', false);
    expect(r.ok).toBe(true);
  });

  it('still caps redirects when enforceSsrfGuard=false', async () => {
    mockFetchQueue(
      Array.from({ length: 7 }, () => ({
        status: 302,
        location: 'http://localhost:3001/loop',
      })),
    );
    const r = await fetchWithSsrfGuard('http://localhost:3001/', false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Too many redirects/);
  });
});

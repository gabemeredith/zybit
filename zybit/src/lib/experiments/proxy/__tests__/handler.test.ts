import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ProxyConfig, ProxyExperiment } from '../config';

vi.mock('../config', () => ({
  loadProxyConfig: vi.fn(),
}));

vi.mock('../assignmentLog', () => ({
  logAssignment: vi.fn(),
}));

import { handleProxyRequest } from '../handler';
import { loadProxyConfig } from '../config';
import { logAssignment } from '../assignmentLog';
import { bucketCookieName, VISITOR_COOKIE } from '../../bucketing';

function makeExperiment(overrides: Partial<ProxyExperiment> = {}): ProxyExperiment {
  return {
    id: 'exp-1',
    targetPath: null,
    modifications: [
      { type: 'element-hide', selector: '.banner' },
      { type: 'text-replace', selector: '.title', text: 'Variant Title' },
    ],
    controlPct: 50,
    durationDays: 14,
    status: 'running',
    ...overrides,
  };
}

function makeConfig(experiments: ProxyExperiment[]): ProxyConfig {
  return {
    site: { id: 'site-1', domain: 'acme.com' },
    experiments,
  };
}

const HTML_BODY = `<!DOCTYPE html><html><head></head><body><h1 class="title">Original</h1><div class="banner">B</div></body></html>`;

function htmlResponse(body: string = HTML_BODY): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function makeRequest(url: string, cookieHeader?: string): NextRequest {
  const headers = new Headers({ 'user-agent': 'test-agent' });
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return new NextRequest(url, { headers });
}

function makeEvent() {
  return { waitUntil: vi.fn() } as unknown as import('next/server').NextFetchEvent;
}

describe('handleProxyRequest', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns 404 when hostname has no slug', async () => {
    const req = makeRequest('https://zybit.run/');
    const res = await handleProxyRequest(req, makeEvent());
    expect(res.status).toBe(404);
  });

  it('returns 404 when no proxy config exists for slug', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(null);
    const res = await handleProxyRequest(makeRequest('https://acme.zybit.run/'), makeEvent());
    expect(res.status).toBe(404);
  });

  it('passes through unmodified when no experiment matches the path', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      makeConfig([makeExperiment({ targetPath: '/checkout' })]),
    );
    fetchSpy.mockResolvedValueOnce(htmlResponse());

    const res = await handleProxyRequest(makeRequest('https://acme.zybit.run/home'), makeEvent());
    const body = await res.text();
    expect(body).toBe(HTML_BODY);
    expect(logAssignment).not.toHaveBeenCalled();
  });

  it('control bucket passes the origin response through unmodified', async () => {
    // Force control via 100% control split
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      makeConfig([makeExperiment({ controlPct: 100 })]),
    );
    fetchSpy.mockResolvedValueOnce(htmlResponse());

    const event = makeEvent();
    const res = await handleProxyRequest(makeRequest('https://acme.zybit.run/home'), event);
    const body = await res.text();
    // Control sees original content (no variant modifications)…
    expect(body).toContain('<h1 class="title">Original</h1>');
    expect(body).not.toContain('Variant Title');
    expect(body).not.toContain('display: none !important');
    // …but still carries the PostHog bridge so control conversions attribute.
    expect(body).toContain('data-zybit-bridge');
    expect(body).toContain('zybit_vid');
    // Cookie set for stickiness on the experiment + visitor
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.includes(VISITOR_COOKIE))).toBe(true);
    expect(setCookie.some((c) => c.includes(bucketCookieName('exp-1')))).toBe(true);
    expect(event.waitUntil).toHaveBeenCalledOnce();
    expect(logAssignment).toHaveBeenCalledOnce();
  });

  it('variant bucket applies modifications to HTML response', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      makeConfig([makeExperiment({ controlPct: 0 })]),
    );
    fetchSpy.mockResolvedValueOnce(htmlResponse());

    const res = await handleProxyRequest(makeRequest('https://acme.zybit.run/home'), makeEvent());
    const body = await res.text();
    expect(body).toContain('Variant Title');
    expect(body).toContain('.banner { display: none !important; }');
    expect(logAssignment).toHaveBeenCalledOnce();
    expect(vi.mocked(logAssignment).mock.calls[0][1]).toMatchObject({
      experimentId: 'exp-1',
      bucket: 'variant',
      siteId: 'site-1',
      path: '/home',
    });
  });

  it('preserves origin Set-Cookie and security headers on modified response', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      makeConfig([makeExperiment({ controlPct: 0 })]),
    );
    const originHeaders = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'content-security-policy': "default-src 'self'",
      'content-encoding': 'gzip',
      'content-length': '999',
    });
    originHeaders.append('set-cookie', 'session=abc; Path=/');
    fetchSpy.mockResolvedValueOnce(new Response(HTML_BODY, { status: 200, headers: originHeaders }));

    const res = await handleProxyRequest(makeRequest('https://acme.zybit.run/home'), makeEvent());
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.getSetCookie().some((c) => c.startsWith('session=abc'))).toBe(true);
  });

  it('selects the most specific matching experiment when several apply', async () => {
    const wildcard = makeExperiment({ id: 'wildcard', targetPath: null, controlPct: 100 });
    const specific = makeExperiment({ id: 'specific', targetPath: '/home', controlPct: 0 });
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(makeConfig([wildcard, specific]));
    fetchSpy.mockResolvedValueOnce(htmlResponse());

    await handleProxyRequest(makeRequest('https://acme.zybit.run/home'), makeEvent());
    expect(vi.mocked(logAssignment).mock.calls[0][1]).toMatchObject({
      experimentId: 'specific',
    });
  });

  it('non-HTML origin response is passed through even for variant bucket', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      makeConfig([makeExperiment({ controlPct: 0 })]),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response('{"x":1}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await handleProxyRequest(makeRequest('https://acme.zybit.run/api/data'), makeEvent());
    const body = await res.text();
    expect(body).toBe('{"x":1}');
  });

  it('existing bucket cookie is sticky — same value used, no new cookie set', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      // controlPct=0 would normally yield variant; pin existing cookie to 'control'
      makeConfig([makeExperiment({ controlPct: 0 })]),
    );
    fetchSpy.mockResolvedValueOnce(htmlResponse());

    const cookies = `${VISITOR_COOKIE}=visitor-existing; ${bucketCookieName('exp-1')}=control`;
    const res = await handleProxyRequest(
      makeRequest('https://acme.zybit.run/home', cookies),
      makeEvent(),
    );
    const body = await res.text();

    // Sticky control → unmodified content, but bridge still injected with
    // the existing visitor ID so the conversion join can match.
    expect(body).toContain('<h1 class="title">Original</h1>');
    expect(body).not.toContain('Variant Title');
    expect(body).toContain('data-zybit-bridge');
    expect(body).toContain('visitor-existing');
    const setCookie = res.headers.getSetCookie();
    expect(setCookie.some((c) => c.includes(VISITOR_COOKIE))).toBe(false);
    expect(setCookie.some((c) => c.includes(bucketCookieName('exp-1')))).toBe(false);
    expect(vi.mocked(logAssignment).mock.calls[0][1]).toMatchObject({
      visitorId: 'visitor-existing',
      bucket: 'control',
    });
  });

  it('logs assignment via event.waitUntil with the resolved bucket and visitor', async () => {
    vi.mocked(loadProxyConfig).mockResolvedValueOnce(
      makeConfig([makeExperiment({ controlPct: 0 })]),
    );
    fetchSpy.mockResolvedValueOnce(htmlResponse());

    const event = makeEvent();
    await handleProxyRequest(makeRequest('https://acme.zybit.run/path?x=1'), event);
    expect(event.waitUntil).toHaveBeenCalledOnce();
    expect(logAssignment).toHaveBeenCalledOnce();
    const [, payload] = vi.mocked(logAssignment).mock.calls[0];
    expect(payload).toMatchObject({
      experimentId: 'exp-1',
      bucket: 'variant',
      path: '/path',
      siteId: 'site-1',
    });
    expect(payload.visitorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof payload.timestamp).toBe('string');
  });
});

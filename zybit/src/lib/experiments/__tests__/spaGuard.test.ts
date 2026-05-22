import { afterEach, describe, expect, it, vi } from 'vitest';
import { targetPageIsSpaShell } from '../spaGuard';

const SPA_HTML =
  '<html><head></head><body><div id="root"></div><script src="/app.js"></script></body></html>';

const SSR_HTML =
  '<html><head></head><body><h1>Welcome to AcmeBank</h1><p>' +
  'Open a checking account today and start saving. '.repeat(10) +
  '</p></body></html>';

function htmlResponse(
  body: string,
  contentType = 'text/html; charset=utf-8',
  status = 200,
): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('targetPageIsSpaShell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns true for a client-side SPA shell', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(SPA_HTML)));
    expect(await targetPageIsSpaShell('https://example.test/')).toBe(true);
  });

  it('returns false for a server-rendered page with real content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(SSR_HTML)));
    expect(await targetPageIsSpaShell('https://example.test/')).toBe(false);
  });

  it('fails open (false) for a non-HTML response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('{}', 'application/json')));
    expect(await targetPageIsSpaShell('https://example.test/')).toBe(false);
  });

  it('fails open (false) when the fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await targetPageIsSpaShell('https://example.test/')).toBe(false);
  });

  it('fails open (false) for a non-2xx response, even if the body looks like a SPA shell', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(SPA_HTML, 'text/html', 503)));
    expect(await targetPageIsSpaShell('https://example.test/')).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProxyConfig, type ProxyConfig } from '../config';

vi.mock('@vercel/edge-config', () => ({
  get: vi.fn(),
}));

const SAMPLE: ProxyConfig = {
  site: { id: 'site-1', domain: 'acme.com' },
  experiments: [
    {
      id: 'exp-1',
      targetPath: null,
      modifications: [{ type: 'element-hide', selector: '.banner' }],
      controlPct: 50,
      durationDays: 14,
      status: 'running',
    },
  ],
};

describe('loadProxyConfig', () => {
  const originalEnv = process.env.EDGE_CONFIG;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (originalEnv === undefined) delete process.env.EDGE_CONFIG;
    else process.env.EDGE_CONFIG = originalEnv;
  });

  it('returns the config from Edge Config when present', async () => {
    process.env.EDGE_CONFIG = 'edge-config-token';
    const { get } = await import('@vercel/edge-config');
    vi.mocked(get).mockResolvedValueOnce({ acme: SAMPLE });

    const result = await loadProxyConfig('acme', 'https://api.zybit.run/');
    expect(result).toEqual(SAMPLE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to API when Edge Config is empty', async () => {
    process.env.EDGE_CONFIG = 'edge-config-token';
    const { get } = await import('@vercel/edge-config');
    vi.mocked(get).mockResolvedValueOnce({});

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: SAMPLE }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await loadProxyConfig('acme', 'https://api.zybit.run/');
    expect(result).toEqual(SAMPLE);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/api/proxy/config?slug=acme');
  });

  it('falls back to API when Edge Config throws', async () => {
    process.env.EDGE_CONFIG = 'edge-config-token';
    const { get } = await import('@vercel/edge-config');
    vi.mocked(get).mockRejectedValueOnce(new Error('edge-config network error'));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: SAMPLE }), { status: 200 }),
    );

    const result = await loadProxyConfig('acme', 'https://api.zybit.run/');
    expect(result).toEqual(SAMPLE);
  });

  it('skips Edge Config entirely when EDGE_CONFIG env is unset', async () => {
    delete process.env.EDGE_CONFIG;
    const { get } = await import('@vercel/edge-config');

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: SAMPLE }), { status: 200 }),
    );

    const result = await loadProxyConfig('acme', 'https://api.zybit.run/');
    expect(result).toEqual(SAMPLE);
    expect(get).not.toHaveBeenCalled();
  });

  it('returns null when API responds non-OK', async () => {
    delete process.env.EDGE_CONFIG;
    fetchSpy.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    expect(await loadProxyConfig('missing', 'https://api.zybit.run/')).toBeNull();
  });

  it('returns null when API responds success=false', async () => {
    delete process.env.EDGE_CONFIG;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    expect(await loadProxyConfig('missing', 'https://api.zybit.run/')).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    delete process.env.EDGE_CONFIG;
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    expect(await loadProxyConfig('acme', 'https://api.zybit.run/')).toBeNull();
  });
});

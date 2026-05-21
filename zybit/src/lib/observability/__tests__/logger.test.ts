import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('logger Axiom drain', () => {
  it('does not call fetch when Axiom env is unset', () => {
    vi.stubEnv('AXIOM_TOKEN', '');
    vi.stubEnv('AXIOM_DATASET', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('hello', { service: 'cron-sync' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the entry to the Axiom ingest endpoint when configured', () => {
    vi.stubEnv('AXIOM_TOKEN', 'tok_123');
    vi.stubEnv('AXIOM_DATASET', 'zybit-logs');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('synced', { service: 'cron-sync', siteId: 'site_1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.axiom.co/v1/datasets/zybit-logs/ingest');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok_123');
    const body = JSON.parse(init.body);
    expect(body[0]).toMatchObject({ level: 'info', message: 'synced', service: 'cron-sync', siteId: 'site_1' });
  });

  it('never throws even if the drain request rejects', () => {
    vi.stubEnv('AXIOM_TOKEN', 'tok_123');
    vi.stubEnv('AXIOM_DATASET', 'zybit-logs');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => logger.error('boom', { service: 'proxy' })).not.toThrow();
  });
});

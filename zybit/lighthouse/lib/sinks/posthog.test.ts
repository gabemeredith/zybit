import { describe, expect, it } from 'vitest';
import type { CanonicalEventInput } from '@/lib/phase2/types';
import { PostHogEventSink } from './posthog';

function fakeOk(): Response {
  return new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('PostHogEventSink', () => {
  it('throws when no API key is configured', () => {
    const originalEnv = process.env.LIGHTHOUSE_POSTHOG_API_KEY;
    delete process.env.LIGHTHOUSE_POSTHOG_API_KEY;
    try {
      expect(() => new PostHogEventSink()).toThrow();
    } finally {
      if (originalEnv !== undefined) process.env.LIGHTHOUSE_POSTHOG_API_KEY = originalEnv;
    }
  });

  it('posts to /batch/ in batches of size batchSize', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const sink = new PostHogEventSink({
      apiKey: 'phc_test',
      host: 'https://example-posthog.test',
      batchSize: 3,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
        return fakeOk();
      },
    });
    const e: CanonicalEventInput = {
      siteId: 's1',
      sessionId: 'sess1',
      type: 'pageview',
      path: '/',
      anonymousId: 'visitor_1',
    };
    for (let i = 0; i < 7; i++) {
      await sink.emit({ ...e, sourceEventId: `e${i}` });
    }
    const { written } = await sink.flush();
    expect(written).toBe(7);
    // 3 + 3 + 1 = 7 events over 3 batches
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.url).toBe('https://example-posthog.test/batch/');
      const b = c.body as { api_key: string; batch: Array<Record<string, unknown>> };
      expect(b.api_key).toBe('phc_test');
      expect(Array.isArray(b.batch)).toBe(true);
      const item = b.batch[0];
      expect(item.event).toBe('pageview');
      expect(item.distinct_id).toBe('visitor_1');
      expect(typeof item.timestamp).toBe('string');
      const props = item.properties as Record<string, unknown>;
      expect(props.$current_url).toBe('/');
      expect(props.siteId).toBe('s1');
      expect(props.sessionId).toBe('sess1');
    }
    expect((calls[0].body as { batch: unknown[] }).batch).toHaveLength(3);
    expect((calls[1].body as { batch: unknown[] }).batch).toHaveLength(3);
    expect((calls[2].body as { batch: unknown[] }).batch).toHaveLength(1);
  });

  it('rejects on non-2xx response', async () => {
    const sink = new PostHogEventSink({
      apiKey: 'phc_test',
      fetchImpl: async () => new Response('rate limited', { status: 429 }),
    });
    await sink.emit({
      siteId: 's1',
      sessionId: 'sess1',
      type: 'pageview',
      path: '/',
    });
    await expect(sink.flush()).rejects.toThrow(/429/);
  });

  it('strips trailing slash from host', async () => {
    let seen = '';
    const sink = new PostHogEventSink({
      apiKey: 'phc_test',
      host: 'https://posthog.example/',
      fetchImpl: async (url) => {
        seen = String(url);
        return fakeOk();
      },
    });
    await sink.emit({
      siteId: 's1',
      sessionId: 'sess1',
      type: 'pageview',
      path: '/',
    });
    await sink.flush();
    expect(seen).toBe('https://posthog.example/batch/');
  });
});

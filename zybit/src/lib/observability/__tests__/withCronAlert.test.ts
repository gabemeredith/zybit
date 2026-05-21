import { describe, it, expect, vi } from 'vitest';
import { withCronAlert } from '@/lib/observability/withCronAlert';

describe('withCronAlert', () => {
  it('passes a successful response through untouched', async () => {
    const handler = vi.fn(async () => new Response('ok', { status: 200 }));
    const res = await withCronAlert('test-cron', handler)(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('returns a 5xx response unchanged (alert is best-effort, never blocks)', async () => {
    const handler = vi.fn(async () => new Response('err', { status: 500 }));
    const res = await withCronAlert('test-cron', handler)(new Request('http://x'));
    expect(res.status).toBe(500);
  });

  it('rethrows an unhandled error so the platform still records the failure', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      withCronAlert('test-cron', handler)(new Request('http://x')),
    ).rejects.toThrow('boom');
  });
});

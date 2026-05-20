/**
 * PostHog opt-in event sink.
 *
 * Posts batches to `${POSTHOG_HOST}/batch/` using the PostHog capture
 * API format:
 *
 *   POST /batch/
 *   {
 *     api_key: "<project key>",
 *     batch: [
 *       { event: "<type>", distinct_id, properties, timestamp, ... },
 *       ...
 *     ]
 *   }
 *
 * (https://posthog.com/docs/api/capture)
 *
 * Used when --mode posthog is selected in the GUI. The real PostHog
 * pull-sync cron in Zybit (/api/phase2/cron/sync-posthog) is then
 * responsible for ingesting these events into phase1_events. Lighthouse
 * does not run that cron itself — that's Zybit code, deliberately
 * untouched.
 *
 * Env:
 *   LIGHTHOUSE_POSTHOG_API_KEY     required
 *   LIGHTHOUSE_POSTHOG_HOST        default https://us.i.posthog.com
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';
import type { EventSink } from './types';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_HOST = 'https://us.i.posthog.com';

export interface PostHogSinkOptions {
  /** Override the env-derived API key. Mostly useful for tests. */
  apiKey?: string;
  /** Override the env-derived host. */
  host?: string;
  batchSize?: number;
  /** Hook for tests — substitute the real fetch. */
  fetchImpl?: typeof fetch;
}

interface CaptureBatchItem {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

function inputToBatchItem(input: CanonicalEventInput): CaptureBatchItem {
  const props: Record<string, unknown> = {
    $current_url: input.path,
    siteId: input.siteId,
    sessionId: input.sessionId,
    ...(input.properties ?? {}),
    ...(input.metrics ?? {}),
    ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
  };
  return {
    event: input.type,
    distinct_id: input.anonymousId ?? `lh_anon_${input.sessionId}`,
    timestamp: input.occurredAt ?? new Date().toISOString(),
    properties: props,
  };
}

export class PostHogEventSink implements EventSink {
  private buffer: CaptureBatchItem[] = [];
  private readonly apiKey: string;
  private readonly host: string;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private writtenTotal = 0;

  constructor(opts: PostHogSinkOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.LIGHTHOUSE_POSTHOG_API_KEY;
    if (!apiKey) {
      throw new Error(
        'LIGHTHOUSE_POSTHOG_API_KEY is required for --mode posthog. Set it in lighthouse/.env.',
      );
    }
    this.apiKey = apiKey;
    this.host = (opts.host ?? process.env.LIGHTHOUSE_POSTHOG_HOST ?? DEFAULT_HOST).replace(/\/$/, '');
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async emit(input: CanonicalEventInput): Promise<void> {
    this.buffer.push(inputToBatchItem(input));
    if (this.buffer.length >= this.batchSize) {
      await this.drain();
    }
  }

  async flush(): Promise<{ written: number }> {
    await this.drain();
    return { written: this.writtenTotal };
  }

  private async drain(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    const res = await this.fetchImpl(`${this.host}/batch/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey, batch }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`posthog /batch/ failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    this.writtenTotal += batch.length;
  }
}

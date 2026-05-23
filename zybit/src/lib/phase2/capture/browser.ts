/**
 * Browserless connection management.
 *
 * Uses playwright-core to connect to a remote Chromium instance via CDP.
 * The `BROWSERLESS_URL` env var should be the full WebSocket endpoint
 * (e.g. `wss://production-sfo.browserless.io`) — the token is appended
 * automatically. Retries on transient 429/5xx with exponential backoff.
 */

import { chromium, type Browser } from 'playwright-core';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const CONNECT_TIMEOUT_MS = 30_000;

function buildWsEndpoint(): string {
  const url = process.env.BROWSERLESS_URL;
  const token = process.env.BROWSERLESS_KEY;
  if (!url || !token) {
    throw new Error('BROWSERLESS_URL and BROWSERLESS_KEY must be set for headless capture');
  }
  return url.includes('?') ? `${url}&token=${token}` : `${url}?token=${token}`;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('connection refused') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout')
  );
}

function jitter(base: number): number {
  return base + Math.random() * (base * 0.3);
}

export async function connectBrowserless(): Promise<Browser> {
  const wsEndpoint = buildWsEndpoint();
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, jitter(RETRY_BASE_MS * 2 ** (attempt - 1))));
    }
    try {
      return await chromium.connectOverCDP(wsEndpoint, { timeout: CONNECT_TIMEOUT_MS });
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) break;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Browserless connection failed after ${MAX_RETRIES} attempts: ${msg}`, {
    cause: lastErr,
  });
}

/**
 * Async semaphore for per-process browser concurrency control.
 *
 * In Vercel, each function invocation is isolated, so this only controls
 * concurrency within a single invocation — not across the deployment.
 * The global limit of 16 concurrent sessions (per the plan) is enforced
 * by Browserless's own quotas; this semaphore provides a local back-pressure
 * layer that prevents a single invocation from saturating the quota.
 */
export class Semaphore {
  private tokens: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.tokens = limit;
  }

  async acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.tokens++;
    }
  }
}

export const globalBrowserSemaphore = new Semaphore(16);

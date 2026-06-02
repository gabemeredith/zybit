import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessScreenshotQuality,
  parseVerdict,
} from '../screenshotQualityGate';

function geminiResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(json) } }],
    }),
  } as unknown as Response;
}

afterEach(() => {
  delete process.env.AUDIT_SCREENSHOT_GATE_DISABLED;
  vi.restoreAllMocks();
});

describe('parseVerdict', () => {
  it('parses a usable verdict', () => {
    expect(parseVerdict('{"usable":true,"issue":"ok"}')).toEqual({ render: true, issue: 'ok' });
  });

  it('parses an unusable verdict with a known issue', () => {
    expect(parseVerdict('{"usable":false,"issue":"login_gated"}')).toEqual({
      render: false,
      issue: 'login_gated',
    });
  });

  it('coerces an unknown issue based on usability', () => {
    expect(parseVerdict('{"usable":false,"issue":"weird"}')).toEqual({
      render: false,
      issue: 'broken_layout',
    });
    expect(parseVerdict('{"usable":true,"issue":"weird"}')).toEqual({
      render: true,
      issue: 'ok',
    });
  });

  it('returns null on malformed input', () => {
    expect(parseVerdict('not json')).toBeNull();
    expect(parseVerdict('{"issue":"ok"}')).toBeNull(); // missing usable
    expect(parseVerdict('{"usable":"yes"}')).toBeNull(); // wrong type
  });
});

describe('assessScreenshotQuality', () => {
  const args = { findingId: 'f_1', buffer: Buffer.from('png-bytes') };

  it('returns the model verdict for a clean page', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse({ usable: true, issue: 'ok' }));
    const verdict = await assessScreenshotQuality(args, {
      apiKey: 'k',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ render: true, issue: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('suppresses a login-gated screenshot', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse({ usable: false, issue: 'login_gated' }));
    const verdict = await assessScreenshotQuality(args, {
      apiKey: 'k',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ render: false, issue: 'login_gated' });
  });

  it('fail-soft: no API key → render anyway', async () => {
    const fetchImpl = vi.fn();
    const verdict = await assessScreenshotQuality(args, {
      apiKey: null,
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ render: true, issue: 'ok' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fail-soft: API error → render anyway', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    const verdict = await assessScreenshotQuality(args, {
      apiKey: 'k',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ render: true, issue: 'ok' });
  });

  it('fail-soft: network throw → render anyway', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const verdict = await assessScreenshotQuality(args, {
      apiKey: 'k',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ render: true, issue: 'ok' });
  });

  it('kill switch: AUDIT_SCREENSHOT_GATE_DISABLED=1 short-circuits to render', async () => {
    process.env.AUDIT_SCREENSHOT_GATE_DISABLED = '1';
    const fetchImpl = vi.fn();
    const verdict = await assessScreenshotQuality(args, {
      apiKey: 'k',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ render: true, issue: 'ok' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

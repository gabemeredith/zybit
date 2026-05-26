import { describe, it, expect } from 'vitest';
import { captureVisualSignals, validateVisualSignals, VISION_MODEL } from '../captureVisualSignals';

const VALID_RAW = {
  visualPrimaryCta: {
    text: 'Get started',
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    confidence: 0.92,
  },
  visualSecondaryCta: {
    text: 'See docs',
    bbox: { x: 0.5, y: 0.2, width: 0.2, height: 0.1 },
    confidence: 0.75,
  },
  pageType: 'home',
  heroBlock: {
    headline: 'Ship better experiments',
    subheadline: 'Real CRO for product teams',
    firstParagraph: null,
  },
};

describe('validateVisualSignals', () => {
  it('accepts a fully-valid payload', () => {
    const out = validateVisualSignals(VALID_RAW);
    expect(out).not.toBeNull();
    expect(out!.visualPrimaryCta?.text).toBe('Get started');
    expect(out!.pageType).toBe('home');
  });

  it('returns null when the input is not an object', () => {
    expect(validateVisualSignals(null)).toBeNull();
    expect(validateVisualSignals('not-json')).toBeNull();
    expect(validateVisualSignals(42)).toBeNull();
  });

  it('returns null when visualPrimaryCta has no text', () => {
    const out = validateVisualSignals({
      ...VALID_RAW,
      visualPrimaryCta: { text: '', bbox: { x: 0, y: 0, width: 0, height: 0 }, confidence: 0.5 },
    });
    expect(out).toBeNull();
  });

  it('allows visualPrimaryCta to be explicitly null', () => {
    const out = validateVisualSignals({ ...VALID_RAW, visualPrimaryCta: null });
    expect(out).not.toBeNull();
    expect(out!.visualPrimaryCta).toBeNull();
  });

  it('rejects bbox values outside [-0.05, 1.05]', () => {
    const out = validateVisualSignals({
      ...VALID_RAW,
      visualPrimaryCta: {
        text: 'Get started',
        bbox: { x: 5, y: 0, width: 0.5, height: 0.5 },
        confidence: 0.5,
      },
    });
    expect(out).toBeNull();
  });

  it('clamps bbox values inside the tolerance band', () => {
    const out = validateVisualSignals({
      ...VALID_RAW,
      visualPrimaryCta: {
        text: 'Get started',
        bbox: { x: -0.01, y: 1.01, width: 0.5, height: 0.5 },
        confidence: 0.5,
      },
    });
    expect(out).not.toBeNull();
    expect(out!.visualPrimaryCta!.bbox.x).toBe(0);
    expect(out!.visualPrimaryCta!.bbox.y).toBe(1);
  });

  it('coerces unknown pageType to "unknown"', () => {
    const out = validateVisualSignals({ ...VALID_RAW, pageType: 'invented-category' });
    expect(out).not.toBeNull();
    expect(out!.pageType).toBe('unknown');
  });

  it('returns null when pageType is not a string', () => {
    expect(validateVisualSignals({ ...VALID_RAW, pageType: 42 })).toBeNull();
  });

  it('truncates over-long CTA text by rejecting it', () => {
    const out = validateVisualSignals({
      ...VALID_RAW,
      visualPrimaryCta: {
        text: 'x'.repeat(201),
        bbox: { x: 0, y: 0, width: 0.5, height: 0.5 },
        confidence: 0.5,
      },
    });
    expect(out).toBeNull();
  });

  it('strips overlong heroBlock fields by nulling them', () => {
    const out = validateVisualSignals({
      ...VALID_RAW,
      heroBlock: {
        headline: 'x'.repeat(600),
        subheadline: 'fine',
        firstParagraph: null,
      },
    });
    expect(out).not.toBeNull();
    expect(out!.heroBlock!.headline).toBeNull();
    expect(out!.heroBlock!.subheadline).toBe('fine');
  });
});

describe('captureVisualSignals', () => {
  function makeBody(text: string) {
    return {
      candidates: [{ content: { parts: [{ text }] } }],
    };
  }

  it('returns null when GEMINI_API_KEY is not set', async () => {
    const out = await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('fake') },
      { apiKey: null },
    );
    expect(out).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const out = await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('fake') },
      {
        apiKey: 'fake-key',
        fetch: () => Promise.reject(new Error('network down')),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when the response is not ok', async () => {
    const out = await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('fake') },
      {
        apiKey: 'fake-key',
        fetch: () =>
          Promise.resolve(new Response('rate limited', { status: 429 })),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when the response body is the JSON literal null', async () => {
    // `null` is valid JSON. Without a guard, extractText would access
    // `.candidates` on null and throw a TypeError that rejects the
    // captureVisualSignals promise and breaks the page snapshot loop.
    const out = await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('fake') },
      {
        apiKey: 'fake-key',
        fetch: () =>
          Promise.resolve(new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when the model output is not valid JSON', async () => {
    const out = await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('fake') },
      {
        apiKey: 'fake-key',
        fetch: () =>
          Promise.resolve(new Response(JSON.stringify(makeBody('not-json {{{')), { status: 200 })),
      },
    );
    expect(out).toBeNull();
  });

  it('returns parsed signals with capturedAt + modelVersion stamped', async () => {
    const fixedDate = new Date('2026-05-26T12:00:00Z');
    const out = await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('fake') },
      {
        apiKey: 'fake-key',
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify(makeBody(JSON.stringify(VALID_RAW))), { status: 200 }),
          ),
        now: () => fixedDate,
      },
    );
    expect(out).not.toBeNull();
    expect(out!.visualPrimaryCta?.text).toBe('Get started');
    expect(out!.pageType).toBe('home');
    expect(out!.capturedAt).toBe(fixedDate.toISOString());
    expect(out!.modelVersion).toBe(VISION_MODEL);
  });

  it('passes the screenshot as base64-encoded inline data', async () => {
    const captured: { body?: string } = {};
    await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('hello') },
      {
        apiKey: 'fake-key',
        fetch: (_input, init) => {
          captured.body = typeof init?.body === 'string' ? init.body : '';
          return Promise.resolve(
            new Response(JSON.stringify(makeBody(JSON.stringify(VALID_RAW))), { status: 200 }),
          );
        },
      },
    );
    expect(captured.body).toBeTruthy();
    const parsed = JSON.parse(captured.body!);
    const inline = parsed.contents[0].parts[0].inlineData;
    expect(inline.mimeType).toBe('image/jpeg');
    // 'hello' base64 = 'aGVsbG8='
    expect(inline.data).toBe('aGVsbG8=');
  });

  it('passes the API key as x-goog-api-key header (never in URL)', async () => {
    const captured: { url?: string; headers?: Record<string, string> } = {};
    await captureVisualSignals(
      { url: 'https://example.com', domain: 'example.com', screenshot: Buffer.from('hello') },
      {
        apiKey: 'secret-token-123',
        fetch: (input, init) => {
          captured.url = typeof input === 'string' ? input : (input as Request).url;
          captured.headers = (init?.headers ?? {}) as Record<string, string>;
          return Promise.resolve(
            new Response(JSON.stringify(makeBody(JSON.stringify(VALID_RAW))), { status: 200 }),
          );
        },
      },
    );
    expect(captured.url!.includes('secret-token-123')).toBe(false);
    expect(captured.headers!['x-goog-api-key']).toBe('secret-token-123');
  });
});

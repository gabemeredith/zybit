/**
 * Tests for `captureCopyCritique` — Layer F capture module.
 *
 * Mirrors the structure of `captureVisualSignals.test.ts`: pure validator
 * cases + fail-soft contract tests on the surrounding `captureCopyCritique`
 * function. The validator is the part most likely to silently regress
 * (it's the boundary between trusted internal types and untrusted model
 * output), so it gets the bulk of the coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPromptInput,
  captureCopyCritique,
  COPY_CRITIQUE_MODEL,
  validateCopyCritique,
} from '../captureCopyCritique';
import type { VisualHeroBlock } from '@/lib/phase2/snapshots/types';

const VALID_RAW = {
  specificity: 0.7,
  vagueTerms: [],
  suggestedRewrites: [],
  proofSignals: ['named customer logo', 'specific metric'],
  ctaAlignment: { matches: true, suggestedVerbs: [] },
};

const HERO: VisualHeroBlock = {
  headline: 'Ship better experiments',
  subheadline: 'Real CRO for product teams',
  firstParagraph: null,
};

const EMPTY_HERO: VisualHeroBlock = {
  headline: null,
  subheadline: null,
  firstParagraph: null,
};

describe('validateCopyCritique', () => {
  it('accepts a fully-valid payload', () => {
    const out = validateCopyCritique(VALID_RAW);
    expect(out).not.toBeNull();
    expect(out!.specificity).toBe(0.7);
    expect(out!.proofSignals).toEqual(['named customer logo', 'specific metric']);
    expect(out!.ctaAlignment?.matches).toBe(true);
  });

  it('returns null when the input is not an object', () => {
    expect(validateCopyCritique(null)).toBeNull();
    expect(validateCopyCritique('not-json')).toBeNull();
    expect(validateCopyCritique(42)).toBeNull();
  });

  it('returns null when specificity is missing', () => {
    const out = validateCopyCritique({ ...VALID_RAW, specificity: undefined });
    expect(out).toBeNull();
  });

  it('returns null when specificity is out of range', () => {
    expect(validateCopyCritique({ ...VALID_RAW, specificity: 5 })).toBeNull();
    expect(validateCopyCritique({ ...VALID_RAW, specificity: -1 })).toBeNull();
  });

  it('clamps specificity values inside the tolerance band', () => {
    const out = validateCopyCritique({ ...VALID_RAW, specificity: 1.02 });
    expect(out).not.toBeNull();
    expect(out!.specificity).toBe(1);
  });

  it('rejects vagueTerms that exceed the per-entry length cap', () => {
    const out = validateCopyCritique({ ...VALID_RAW, vagueTerms: ['x'.repeat(201)] });
    expect(out).toBeNull();
  });

  it('rejects vagueTerms that exceed the count cap', () => {
    const out = validateCopyCritique({
      ...VALID_RAW,
      vagueTerms: Array.from({ length: 11 }, (_, i) => `term-${i}`),
    });
    expect(out).toBeNull();
  });

  it('drops empty strings from string arrays silently', () => {
    const out = validateCopyCritique({
      ...VALID_RAW,
      vagueTerms: ['  ', 'real vague phrase'],
    });
    expect(out).not.toBeNull();
    expect(out!.vagueTerms).toEqual(['real vague phrase']);
  });

  it('rejects non-string entries in string arrays', () => {
    const out = validateCopyCritique({
      ...VALID_RAW,
      vagueTerms: ['fine', 42],
    });
    expect(out).toBeNull();
  });

  it('allows ctaAlignment to be explicitly null', () => {
    const out = validateCopyCritique({ ...VALID_RAW, ctaAlignment: null });
    expect(out).not.toBeNull();
    expect(out!.ctaAlignment).toBeNull();
  });

  it('returns null when ctaAlignment.matches is not a boolean', () => {
    const out = validateCopyCritique({
      ...VALID_RAW,
      ctaAlignment: { matches: 'yes', suggestedVerbs: [] },
    });
    expect(out).toBeNull();
  });

  it('rejects suggestedVerbs that exceed per-entry length', () => {
    const out = validateCopyCritique({
      ...VALID_RAW,
      ctaAlignment: { matches: false, suggestedVerbs: ['x'.repeat(101)] },
    });
    expect(out).toBeNull();
  });
});

describe('buildPromptInput', () => {
  it('lists every non-null hero field on its own line', () => {
    const input = buildPromptInput({
      url: 'https://example.com',
      heroBlock: {
        headline: 'Hello',
        subheadline: 'World',
        firstParagraph: 'Lorem ipsum',
      },
      primaryCtaText: 'Get started',
      pageType: 'home',
    });
    expect(input).toContain('Page type: home');
    expect(input).toContain('Headline: Hello');
    expect(input).toContain('Subheadline: World');
    expect(input).toContain('First paragraph: Lorem ipsum');
    expect(input).toContain('Primary CTA: Get started');
  });

  it('omits null hero fields cleanly', () => {
    const input = buildPromptInput({
      url: 'https://example.com',
      heroBlock: { headline: 'Hello', subheadline: null, firstParagraph: null },
      primaryCtaText: null,
      pageType: 'pricing',
    });
    expect(input).not.toContain('Subheadline:');
    expect(input).not.toContain('First paragraph:');
    expect(input).toContain('Primary CTA: (none observed)');
  });
});

describe('captureCopyCritique', () => {
  function makeBody(text: string) {
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }

  it('returns null when GEMINI_API_KEY is not set', async () => {
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
      { apiKey: null },
    );
    expect(out).toBeNull();
  });

  it('returns null when heroBlock has no readable text', async () => {
    // Defense: we should not spend tokens critiquing an empty hero.
    // Vision pass gave up on the page; copy critique can't do better.
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: EMPTY_HERO, primaryCtaText: null, pageType: 'home' },
      {
        apiKey: 'fake-key',
        fetch: () => Promise.reject(new Error('must not be called')),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
      {
        apiKey: 'fake-key',
        fetch: () => Promise.reject(new Error('network down')),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when the response is not ok', async () => {
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
      {
        apiKey: 'fake-key',
        fetch: () => Promise.resolve(new Response('rate limited', { status: 429 })),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when the response body is the JSON literal null', async () => {
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
      {
        apiKey: 'fake-key',
        fetch: () =>
          Promise.resolve(
            new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
          ),
      },
    );
    expect(out).toBeNull();
  });

  it('returns null when the model output is not valid JSON', async () => {
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
      {
        apiKey: 'fake-key',
        fetch: () =>
          Promise.resolve(new Response(JSON.stringify(makeBody('not-json {{{')), { status: 200 })),
      },
    );
    expect(out).toBeNull();
  });

  it('returns parsed critique with capturedAt + modelVersion stamped', async () => {
    const fixedDate = new Date('2026-05-26T12:00:00Z');
    const out = await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
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
    expect(out!.specificity).toBe(0.7);
    expect(out!.proofSignals.length).toBe(2);
    expect(out!.capturedAt).toBe(fixedDate.toISOString());
    expect(out!.modelVersion).toBe(COPY_CRITIQUE_MODEL);
  });

  it('passes the API key as x-goog-api-key header (never in URL)', async () => {
    const captured: { url?: string; headers?: Record<string, string> } = {};
    await captureCopyCritique(
      { url: 'https://example.com', heroBlock: HERO, primaryCtaText: 'Get started', pageType: 'home' },
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

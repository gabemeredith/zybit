import { describe, it, expect } from 'vitest';
import type { OpenAIFetcher } from '@/lib/ai/openai';
import {
  buildSiteContextPrompt,
  deriveSiteContext,
  validateSiteContext,
} from '../deriveSiteContext';
import { isSiteContextEnabled } from '../types';
import { reviewerPersona, siteContextPromptBlock } from '../promptBlock';

/** Stub the OpenAI fetcher to return a fixed chat-completion body. */
function stubFetcher(content: string): OpenAIFetcher {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
}

const throwingFetcher: OpenAIFetcher = async () => {
  throw new Error('network down');
};

const fixedNow = () => new Date('2026-06-01T00:00:00.000Z');

describe('validateSiteContext', () => {
  it('accepts a well-formed payload', () => {
    const v = validateSiteContext({
      industry: 'saas',
      businessModel: 'subscription',
      conversionGoal: 'start-free-trial',
      audience: 'engineering teams',
      brandVoice: 'technical, precise',
      confidence: 0.8,
    });
    expect(v).toEqual({
      industry: 'saas',
      businessModel: 'subscription',
      conversionGoal: 'start-free-trial',
      audience: 'engineering teams',
      brandVoice: 'technical, precise',
      confidence: 0.8,
    });
  });

  it('coerces unknown enum values to safe defaults instead of rejecting', () => {
    const v = validateSiteContext({
      industry: 'crypto-casino',
      businessModel: 'ponzi',
      conversionGoal: 'vibes',
      audience: null,
      brandVoice: null,
      confidence: 0.5,
    });
    expect(v).toMatchObject({ industry: 'other', businessModel: 'unknown', conversionGoal: 'unknown' });
  });

  it('rejects when confidence is missing or out of range', () => {
    expect(validateSiteContext({ industry: 'saas' })).toBeNull();
    expect(validateSiteContext({ industry: 'saas', confidence: 5 })).toBeNull();
    expect(validateSiteContext('not an object')).toBeNull();
  });

  it('strips angle brackets and "null" strings from free-text fields', () => {
    const v = validateSiteContext({
      industry: 'media',
      audience: '<script>readers</script>',
      brandVoice: 'null',
      confidence: 0.3,
    });
    expect(v?.audience).toBe('scriptreaders/script');
    expect(v?.brandVoice).toBeNull();
  });
});

describe('buildSiteContextPrompt', () => {
  it('names the heuristic prior and includes the signals', () => {
    const prompt = buildSiteContextPrompt(
      { url: 'https://acme.com', signals: { title: 'Acme CRM', ctaVocabulary: ['Start free trial'] } },
      'saas',
    );
    expect(prompt).toContain('pre-classified the industry as "saas"');
    expect(prompt).toContain('Title: Acme CRM');
    expect(prompt).toContain('CTA labels: Start free trial');
  });
});

describe('deriveSiteContext — merge precedence + fail-soft', () => {
  it('returns a heuristic-only context when the LLM is disabled but the URL classifies', async () => {
    const ctx = await deriveSiteContext(
      { url: 'https://acme.com/pricing', signals: {} },
      { apiKey: null, now: fixedNow },
    );
    expect(ctx).toMatchObject({ industry: 'saas', source: 'inferred', modelVersion: 'heuristic', confidence: 0.3 });
  });

  it('returns null when there is nothing to say (no key, no heuristic, no declared)', async () => {
    const ctx = await deriveSiteContext(
      { url: 'https://nondescript.example/', signals: {} },
      { apiKey: null, now: fixedNow },
    );
    expect(ctx).toBeNull();
  });

  it('lets declared onboarding values win, with source=declared when no LLM', async () => {
    const ctx = await deriveSiteContext(
      { url: 'https://acme.com/', declared: { industry: 'fintech', conversionGoal: 'book-demo' }, signals: {} },
      { apiKey: null, now: fixedNow },
    );
    expect(ctx).toMatchObject({ industry: 'fintech', conversionGoal: 'book-demo', source: 'declared', confidence: 1 });
  });

  it('uses the LLM result when available (source=inferred)', async () => {
    const content = JSON.stringify({
      industry: 'ecommerce',
      businessModel: 'transactional',
      conversionGoal: 'purchase',
      audience: 'home cooks',
      brandVoice: 'warm, playful',
      confidence: 0.9,
    });
    const ctx = await deriveSiteContext(
      { url: 'https://shop.example/', signals: { title: 'Cookware' } },
      { apiKey: 'k', fetcher: stubFetcher(content), now: fixedNow },
    );
    expect(ctx).toMatchObject({
      industry: 'ecommerce',
      businessModel: 'transactional',
      conversionGoal: 'purchase',
      audience: 'home cooks',
      source: 'inferred',
      confidence: 0.9,
    });
  });

  it('marks source=hybrid and lets declared override the LLM on conflict', async () => {
    const content = JSON.stringify({
      industry: 'saas',
      businessModel: 'subscription',
      conversionGoal: 'start-free-trial',
      audience: null,
      brandVoice: null,
      confidence: 0.6,
    });
    const ctx = await deriveSiteContext(
      { url: 'https://acme.com/', declared: { industry: 'fintech' }, signals: {} },
      { apiKey: 'k', fetcher: stubFetcher(content), now: fixedNow },
    );
    expect(ctx).toMatchObject({ industry: 'fintech', source: 'hybrid', confidence: 0.7 });
  });

  it('fails soft to the heuristic when the LLM call throws', async () => {
    const ctx = await deriveSiteContext(
      { url: 'https://acme.com/pricing', signals: {} },
      { apiKey: 'k', fetcher: throwingFetcher, now: fixedNow },
    );
    expect(ctx).toMatchObject({ industry: 'saas', modelVersion: 'heuristic' });
  });
});

describe('prompt-block helpers', () => {
  it('reviewerPersona specialises by industry and falls back neutrally', () => {
    expect(reviewerPersona({ industry: 'ecommerce' } as never)).toBe('DTC e-commerce landing-page reviewer');
    expect(reviewerPersona({ industry: 'other' } as never)).toBe('landing-page reviewer');
    expect(reviewerPersona(null)).toBe('landing-page reviewer');
  });

  it('siteContextPromptBlock omits unknown fields and returns empty for null', () => {
    expect(siteContextPromptBlock(null)).toBe('');
    const block = siteContextPromptBlock({
      industry: 'saas',
      businessModel: 'unknown',
      conversionGoal: 'book-demo',
      audience: 'IT admins',
      brandVoice: null,
      source: 'inferred',
      confidence: 0.5,
      capturedAt: '',
      modelVersion: '',
    });
    expect(block).toContain('industry: saas');
    expect(block).toContain('primary conversion goal: book-demo');
    expect(block).toContain('audience: IT admins');
    expect(block).not.toContain('business model'); // unknown is omitted
    expect(block).not.toContain('brand voice'); // null is omitted
  });
});

describe('isSiteContextEnabled', () => {
  it('is driven by the LLM_SITE_CONTEXT_ENABLED env flag', () => {
    const prev = process.env.LLM_SITE_CONTEXT_ENABLED;
    process.env.LLM_SITE_CONTEXT_ENABLED = '1';
    expect(isSiteContextEnabled()).toBe(true);
    process.env.LLM_SITE_CONTEXT_ENABLED = '0';
    expect(isSiteContextEnabled()).toBe(false);
    delete process.env.LLM_SITE_CONTEXT_ENABLED;
    expect(isSiteContextEnabled()).toBe(false);
    if (prev !== undefined) process.env.LLM_SITE_CONTEXT_ENABLED = prev;
  });
});

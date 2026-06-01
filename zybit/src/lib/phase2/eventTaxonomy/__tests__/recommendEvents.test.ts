import { describe, it, expect } from 'vitest';
import type { OpenAIFetcher } from '@/lib/ai/openai';
import {
  buildEventTaxonomyPrompt,
  recommendEvents,
  validateEvents,
  type RecommendEventsInput,
} from '../recommendEvents';

function stubFetcher(content: string): OpenAIFetcher {
  return async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
}

const BASE: RecommendEventsInput = {
  siteContext: {
    industry: 'ecommerce',
    businessModel: 'transactional',
    conversionGoal: 'purchase',
    audience: null,
    brandVoice: null,
    source: 'inferred',
    confidence: 0.8,
    capturedAt: '',
    modelVersion: '',
  },
  pageTypes: ['home', 'pricing', 'checkout'],
  funnelPaths: ['/', '/products', '/cart', '/checkout'],
  currentEvents: ['pageview', 'add_to_cart'],
};

describe('buildEventTaxonomyPrompt', () => {
  it('includes goal, page types, funnel paths, and current events', () => {
    const p = buildEventTaxonomyPrompt(BASE);
    expect(p).toContain('CONVERSION GOAL: purchase');
    expect(p).toContain('OBSERVED PAGE TYPES: home, pricing, checkout');
    expect(p).toContain('/checkout');
    expect(p).toContain('ALREADY TRACKED EVENTS: pageview, add_to_cart');
  });
});

describe('validateEvents', () => {
  it('keeps well-formed events and computes alreadyTracked deterministically', () => {
    const events = validateEvents(
      {
        events: [
          { name: 'checkout_shipping_viewed', trigger: 'on shipping step', why: 'reveals shipping drop-off', priority: 'high' },
          { name: 'Add To Cart', trigger: 'on add', why: 'cart intent', priority: 'nonsense' },
        ],
      },
      ['pageview', 'add_to_cart'],
    );
    expect(events).toHaveLength(2);
    expect(events![0]).toMatchObject({ name: 'checkout_shipping_viewed', priority: 'high', alreadyTracked: false });
    // "Add To Cart" normalizes to add_to_cart → already tracked; bad priority → medium
    expect(events![1]).toMatchObject({ alreadyTracked: true, priority: 'medium' });
  });

  it('drops entries missing required fields and caps the list', () => {
    expect(validateEvents({ events: [{ name: 'x' }] }, [])).toEqual([]);
    expect(validateEvents({ notEvents: [] }, [])).toBeNull();
    expect(validateEvents('nope', [])).toBeNull();
    const many = { events: Array.from({ length: 30 }, (_, i) => ({ name: `e_${i}`, trigger: 't', why: 'w', priority: 'low' })) };
    expect(validateEvents(many, [])!.length).toBeLessThanOrEqual(12);
  });
});

describe('recommendEvents', () => {
  it('returns recommendations from the model, alreadyTracked stamped by us', async () => {
    const content = JSON.stringify({
      events: [
        { name: 'checkout_started', trigger: 'enter checkout', why: 'top of checkout funnel', priority: 'high' },
        { name: 'pageview', trigger: 'any page', why: 'baseline', priority: 'low' },
      ],
    });
    const rec = await recommendEvents(BASE, { apiKey: 'k', fetcher: stubFetcher(content), now: () => new Date('2026-06-01T00:00:00Z') });
    expect(rec).not.toBeNull();
    expect(rec!.events[0]).toMatchObject({ name: 'checkout_started', alreadyTracked: false });
    expect(rec!.events[1]).toMatchObject({ name: 'pageview', alreadyTracked: true });
  });

  it('returns null without a key, and on an empty funnel', async () => {
    expect(await recommendEvents(BASE, { apiKey: null })).toBeNull();
    expect(
      await recommendEvents({ ...BASE, pageTypes: [], funnelPaths: [] }, { apiKey: 'k', fetcher: stubFetcher('{}') }),
    ).toBeNull();
  });

  it('fails soft to null when the model call throws', async () => {
    const throwing: OpenAIFetcher = async () => {
      throw new Error('boom');
    };
    expect(await recommendEvents(BASE, { apiKey: 'k', fetcher: throwing })).toBeNull();
  });
});

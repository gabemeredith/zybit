import { describe, expect, it } from 'vitest';
import {
  buildLayerBPrompt,
  parseLayerBResponse,
  runLayerB,
  type LayerBFetcher,
  type LayerBInput,
} from '../runLayerB';

const BASE_INPUT: LayerBInput = {
  ruleId: 'return-visit-thrash',
  category: 'thrash',
  title: 'Return-visit thrash',
  pageType: 'pricing',
  pathRef: '/pricing',
  factsJson: {
    thrashSessions: 234,
    totalSessions: 1950,
    thrashRate: 0.12,
    interimTopPaths: ['/features', '/docs'],
  },
  designTokens: { primaryColor: '#1A73E8', typeScale: [16, 20, 28, 40] },
};

const VALID_RESPONSE = JSON.stringify({
  summary:
    '234 sessions visit /pricing 3+ times without progressing — 12% of sessions that touch the pricing page get stuck.',
  recommendation: [
    'Return-visit loops mean visitors leave, look elsewhere, and come back because they did not find the answer the first time.',
    'On /pricing, the most likely missing answer is a comparison of plans or a TL;DR of who each plan is for.',
  ],
  prescription: {
    whyItMatters:
      'Pricing thrash predicts pricing-page abandonment; every loop is a visitor losing momentum toward purchase.',
    whatToChange:
      'Add a top-of-page quick-answer section to /pricing that names the most common follow-up destinations.',
    whyItWorks:
      'Surfacing the destination on the first visit eliminates the need to leave and return.',
    experimentVariantDescription:
      'Variant B: top-of-page quick-answer block added to /pricing; primary metric is return-visit rate.',
  },
});

describe('buildLayerBPrompt', () => {
  it('includes ruleId, title, pageType, pathRef, and stringified facts', () => {
    const prompt = buildLayerBPrompt(BASE_INPUT);
    expect(prompt).toContain('return-visit-thrash');
    expect(prompt).toContain('Return-visit thrash');
    expect(prompt).toContain('PAGE TYPE: pricing');
    expect(prompt).toContain('/pricing');
    expect(prompt).toContain('thrashSessions');
    expect(prompt).toContain('234');
  });

  it('says site-wide when pathRef is null', () => {
    const prompt = buildLayerBPrompt({ ...BASE_INPUT, pathRef: null });
    expect(prompt).toContain('site-wide');
  });

  it('strips angle brackets from untrusted finding strings', () => {
    const prompt = buildLayerBPrompt({
      ...BASE_INPUT,
      title: '<script>alert(1)</script>',
    });
    expect(prompt).not.toContain('<script>');
    expect(prompt).not.toContain('</script>');
  });

  it('emits empty-object design tokens when null', () => {
    const prompt = buildLayerBPrompt({ ...BASE_INPUT, designTokens: null });
    expect(prompt).toContain('DESIGN TOKENS');
    expect(prompt).toContain('{}');
  });
});

describe('parseLayerBResponse', () => {
  it('parses a valid response', () => {
    const out = parseLayerBResponse(VALID_RESPONSE);
    expect(out).not.toBeNull();
    expect(out?.summary).toMatch(/^234 sessions/);
    expect(out?.recommendation).toHaveLength(2);
    expect(out?.prescription.whatToChange).toMatch(/^Add a top-of-page/);
    expect(out?.prescription.whyItMatters).toBeDefined();
  });

  it('strips markdown fences before parsing', () => {
    const fenced = '```json\n' + VALID_RESPONSE + '\n```';
    const out = parseLayerBResponse(fenced);
    expect(out).not.toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(parseLayerBResponse('not json')).toBeNull();
    expect(parseLayerBResponse('')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const missingPrescription = JSON.stringify({
      summary: 'ok',
      recommendation: ['ok'],
    });
    expect(parseLayerBResponse(missingPrescription)).toBeNull();

    const missingWhatToChange = JSON.stringify({
      summary: 'ok',
      recommendation: ['ok'],
      prescription: {
        whyItWorks: 'because',
        experimentVariantDescription: 'variant',
      },
    });
    expect(parseLayerBResponse(missingWhatToChange)).toBeNull();
  });

  it('returns null when recommendation is empty', () => {
    const emptyRec = JSON.stringify({
      summary: 'ok',
      recommendation: [],
      prescription: {
        whatToChange: 'do x',
        whyItWorks: 'because',
        experimentVariantDescription: 'variant',
      },
    });
    expect(parseLayerBResponse(emptyRec)).toBeNull();
  });

  it('clamps overlong fields rather than rejecting', () => {
    const longSummary = 'x'.repeat(2000);
    const out = parseLayerBResponse(
      JSON.stringify({
        summary: longSummary,
        recommendation: ['short'],
        prescription: {
          whatToChange: 'do x',
          whyItWorks: 'because',
          experimentVariantDescription: 'variant',
        },
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.summary.length).toBeLessThan(longSummary.length);
  });

  it('caps recommendation paragraphs at the configured maximum', () => {
    const many = Array.from({ length: 10 }, (_, i) => `paragraph ${i}`);
    const out = parseLayerBResponse(
      JSON.stringify({
        summary: 'ok',
        recommendation: many,
        prescription: {
          whatToChange: 'do x',
          whyItWorks: 'because',
          experimentVariantDescription: 'variant',
        },
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.recommendation.length).toBeLessThanOrEqual(3);
  });

  it('omits whyItMatters when blank rather than persisting empty string', () => {
    const out = parseLayerBResponse(
      JSON.stringify({
        summary: 'ok',
        recommendation: ['ok'],
        prescription: {
          whyItMatters: '   ',
          whatToChange: 'do x',
          whyItWorks: 'because',
          experimentVariantDescription: 'variant',
        },
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.prescription.whyItMatters).toBeUndefined();
  });
});

describe('runLayerB', () => {
  it('returns null when no API key is set', async () => {
    const result = await runLayerB(BASE_INPUT, { apiKey: '' });
    expect(result).toBeNull();
  });

  it('returns a parsed result when the call succeeds', async () => {
    const fetcher: LayerBFetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: VALID_RESPONSE }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200 },
      }),
    });
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).not.toBeNull();
    expect(result?.summary).toMatch(/^234 sessions/);
  });

  it('returns null when the HTTP call throws', async () => {
    const fetcher: LayerBFetcher = async () => {
      throw new Error('network');
    };
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).toBeNull();
  });

  it('returns null when the HTTP call returns non-2xx', async () => {
    const fetcher: LayerBFetcher = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).toBeNull();
  });

  it('returns null when the model returns garbage', async () => {
    const fetcher: LayerBFetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'lol not json' }] } }],
      }),
    });
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).toBeNull();
  });
});

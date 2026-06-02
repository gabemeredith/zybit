import { describe, expect, it } from 'vitest';
import {
  buildLayerBPrompt,
  collectFactNumbers,
  extractClaims,
  LAYER_B_MODEL_NAME,
  parseLayerBResponse,
  runLayerB,
  verifyOutputAgainstFacts,
  type LayerBFetcher,
  type LayerBInput,
  type LayerBOutput,
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

  it('omits the SITE CONTEXT block when no siteContext is provided (baseline)', () => {
    const prompt = buildLayerBPrompt(BASE_INPUT);
    expect(prompt).not.toContain('SITE CONTEXT');
  });

  it('includes the SITE CONTEXT block when siteContext is provided', () => {
    const prompt = buildLayerBPrompt({
      ...BASE_INPUT,
      siteContext: {
        industry: 'ecommerce',
        businessModel: 'transactional',
        conversionGoal: 'purchase',
        audience: 'home cooks',
        brandVoice: 'warm, playful',
        source: 'inferred',
        confidence: 0.8,
        capturedAt: '2026-06-01T00:00:00.000Z',
        modelVersion: 'gpt-5.4-mini',
      },
    });
    expect(prompt).toContain('SITE CONTEXT');
    expect(prompt).toContain('industry: ecommerce');
    expect(prompt).toContain('primary conversion goal: purchase');
    expect(prompt).toContain('audience: home cooks');
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

describe('collectFactNumbers', () => {
  it('walks nested objects and arrays', () => {
    const { counts, percents } = collectFactNumbers({
      thrashSessions: 234,
      thrashRate: 0.12,
      nested: { totalSessions: 1950 },
      array: [{ count: 7 }, { count: 12 }],
    });
    expect(counts.has(234)).toBe(true);
    expect(counts.has(1950)).toBe(true);
    expect(counts.has(7)).toBe(true);
    expect(counts.has(12)).toBe(true);
    // 0.12 → 12% derivation
    expect(percents.has(12)).toBe(true);
  });

  it('derives both whole and one-decimal percents from a rate', () => {
    const { percents } = collectFactNumbers({ rate: 0.1234 });
    expect(percents.has(12)).toBe(true); // rounded
    expect(percents.has(12.3)).toBe(true); // one-decimal
  });

  it('harvests a thousands-separated number from a STRING fact value', () => {
    // Regression: a comma-formatted string fact ("6,030 sessions") must read as
    // 6030 — the same way extractClaims reads the model's "6,030" — or a
    // grounded large number would be split ("6" + "030") and wrongly rejected.
    const { counts } = collectFactNumbers({ lost: '6,030 sessions' });
    expect(counts.has(6030)).toBe(true);
    expect(counts.has(30)).toBe(false); // not the trailing group on its own

    // End-to-end: prose echoing the comma-formatted string fact verifies.
    const out: LayerBOutput = {
      summary: 'That loses about 6,030 sessions a month.',
      recommendation: ['ok'],
      prescription: { whatToChange: 'x', whyItWorks: 'y', experimentVariantDescription: 'z' },
    };
    expect(verifyOutputAgainstFacts(out, { lost: '6,030 sessions' }).ok).toBe(true);
  });
});

describe('extractClaims', () => {
  it('captures percents and material counts but skips small ordinals', () => {
    const claims = extractClaims('234 sessions visit /pricing 3+ times — 12% loop.');
    expect(claims).toContainEqual({ value: 234, kind: 'count', raw: '234' });
    expect(claims).toContainEqual({ value: 12, kind: 'percent', raw: '12%' });
    // "3" is below the small-ordinal threshold (< 4) — not a claim
    expect(claims.find((c) => c.value === 3)).toBeUndefined();
  });

  it('does not double-count a percent value as both percent and count', () => {
    const claims = extractClaims('12% of sessions');
    const twelves = claims.filter((c) => c.value === 12);
    expect(twelves).toHaveLength(1);
    expect(twelves[0].kind).toBe('percent');
  });

  it('skips numbers embedded in paths and identifiers', () => {
    const claims = extractClaims('See /v1/api or item-42 above /pricing.');
    expect(claims.find((c) => c.raw === '1')).toBeUndefined();
    expect(claims.find((c) => c.raw === '42')).toBeUndefined();
  });
});

describe('verifyOutputAgainstFacts', () => {
  const facts = {
    thrashSessions: 234,
    totalSessions: 1950,
    thrashRate: 0.12,
  };

  function makeOutput(summary: string): LayerBOutput {
    return {
      summary,
      recommendation: ['ok'],
      prescription: {
        whatToChange: 'do x',
        whyItWorks: 'because',
        experimentVariantDescription: 'variant',
      },
    };
  }

  it('passes when every number is grounded', () => {
    const out = makeOutput('234 sessions visit /pricing — 12% loop.');
    expect(verifyOutputAgainstFacts(out, facts).ok).toBe(true);
  });

  it('passes percent derived from a rate fact', () => {
    const out = makeOutput('12% of sessions get stuck.');
    expect(verifyOutputAgainstFacts(out, facts).ok).toBe(true);
  });

  it('rejects a fabricated count', () => {
    const out = makeOutput('589 sessions visit /pricing.');
    const result = verifyOutputAgainstFacts(out, facts);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.value)).toContain(589);
  });

  it('rejects a fabricated percent', () => {
    const out = makeOutput('87% of sessions are stuck.');
    const result = verifyOutputAgainstFacts(out, facts);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.value)).toContain(87);
  });

  it('scans every narrative field, not just summary', () => {
    const out: LayerBOutput = {
      summary: 'ok',
      recommendation: ['Affects 999 visitors.'],
      prescription: {
        whatToChange: 'do x',
        whyItWorks: 'because',
        experimentVariantDescription: 'variant',
      },
    };
    expect(verifyOutputAgainstFacts(out, facts).ok).toBe(false);
  });

  it('tolerates ±1 rounding on counts', () => {
    const out = makeOutput('1951 sessions touched the page.');
    expect(verifyOutputAgainstFacts(out, facts).ok).toBe(true);
  });

  it('accepts a grounded number written with a thousands separator', () => {
    // Regression: the model writes "6,030"; the claim extractor must read it
    // as 6030 (not split into 6 + 030) so a grounded large number isn't
    // wrongly rejected. Live-caught on a bounce finding (impact value 6030).
    const out = makeOutput('That loses about 6,030 sessions a month.');
    expect(verifyOutputAgainstFacts(out, { lost: 6030 }).ok).toBe(true);
    // And a comma-grouped number NOT in facts is still rejected.
    expect(verifyOutputAgainstFacts(makeOutput('A loss of 9,999 sessions.'), { lost: 6030 }).ok).toBe(
      false,
    );
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
        choices: [{ message: { content: VALID_RESPONSE } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
    });
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).not.toBeNull();
    expect(result?.summary).toMatch(/^234 sessions/);
  });

  it('sends the Layer B model + json_object format in the request body', async () => {
    let capturedBody: unknown = null;
    const fetcher: LayerBFetcher = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: VALID_RESPONSE } }],
        }),
      };
    };
    await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    const body = capturedBody as {
      model: string;
      response_format?: { type: string };
      // Reasoning model rejects non-default temps, so we must NOT send one.
      temperature?: number;
    };
    expect(body.model).toBe(LAYER_B_MODEL_NAME);
    expect(body.response_format?.type).toBe('json_object');
    expect(body.temperature).toBeUndefined();
  });

  it('falls back to null when the LLM invents a number', async () => {
    const fabricated = JSON.stringify({
      summary: '999 sessions visit /pricing — 87% loop.',
      recommendation: ['ok'],
      prescription: {
        whatToChange: 'do x',
        whyItWorks: 'because',
        experimentVariantDescription: 'variant',
      },
    });
    const fetcher: LayerBFetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: fabricated } }],
      }),
    });
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).toBeNull();
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
        choices: [{ message: { content: 'lol not json' } }],
      }),
    });
    const result = await runLayerB(BASE_INPUT, { apiKey: 'test-key', fetcher });
    expect(result).toBeNull();
  });
});

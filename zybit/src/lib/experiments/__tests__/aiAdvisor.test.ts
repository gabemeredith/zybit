import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  callGeminiFlash,
  parseAndValidateResponse,
  type AdvisorFinding,
  type AdvisorDesignContext,
  type AdvisorSnapshotContext,
} from '../aiAdvisor';

const FINDING: AdvisorFinding = {
  ruleId: 'hero-hierarchy-inversion',
  prescription: {
    whatToChange: 'Lift primary CTA visual weight above the hero illustration.',
    whyItWorks: 'Visual prominence aligns with click intent on landing pages.',
    experimentVariantDescription: 'Bigger button, brand-primary fill, sentence-case copy.',
  },
};

const DESIGN_FULL: AdvisorDesignContext = {
  captureMethod: 'full',
  designTokens: { primaryColor: '#1a56db', secondaryColor: '#111827', typeScale: [16, 24, 48] },
  computedStyles: { 'cta:cta_hero': { selector: 'button.cta-primary', backgroundColor: '#1a56db' } },
  cssSystem: 'tailwind',
  screenshotUrl: 'https://blob.vercel/x.png',
};

const SNAPSHOT: AdvisorSnapshotContext = {
  availableSelectors: ['button.cta-primary', '#signup-form', 'a.cta-secondary'],
  ctaVocabulary: ['Get started', 'Book a demo'],
};

describe('buildPrompt', () => {
  it('includes the finding rule + prescription verbatim', () => {
    const prompt = buildPrompt({ finding: FINDING, design: DESIGN_FULL, snapshot: SNAPSHOT });
    expect(prompt).toContain('hero-hierarchy-inversion');
    expect(prompt).toContain('Lift primary CTA visual weight above the hero illustration.');
    expect(prompt).toContain('Bigger button, brand-primary fill, sentence-case copy.');
  });

  it('embeds design tokens, css system, and capture method', () => {
    const prompt = buildPrompt({ finding: FINDING, design: DESIGN_FULL, snapshot: SNAPSHOT });
    expect(prompt).toContain('"primaryColor":"#1a56db"');
    expect(prompt).toContain('CSS FRAMEWORK: tailwind');
    expect(prompt).toContain('CAPTURE METHOD: full');
    expect(prompt).not.toContain('computed styles unavailable');
  });

  it('adds a degraded-mode note when capture method is structural', () => {
    const prompt = buildPrompt({
      finding: FINDING,
      design: { ...DESIGN_FULL, captureMethod: 'structural', computedStyles: null },
      snapshot: SNAPSHOT,
    });
    expect(prompt).toContain('CAPTURE METHOD: structural');
    expect(prompt).toContain('computed styles unavailable');
  });

  it('exposes the allowed-selectors list', () => {
    const prompt = buildPrompt({ finding: FINDING, design: DESIGN_FULL, snapshot: SNAPSHOT });
    expect(prompt).toContain('"button.cta-primary"');
    expect(prompt).toContain('"#signup-form"');
  });
});

describe('parseAndValidateResponse', () => {
  const allowed = SNAPSHOT.availableSelectors;

  it('returns valid options and stamps confidence from captureMethod', () => {
    const raw = JSON.stringify({
      options: [
        {
          label: 'Bigger primary',
          modifications: [
            { type: 'text-replace', selector: 'button.cta-primary', text: 'Start free trial' },
            { type: 'css-inject', selector: 'button.cta-primary', css: 'font-size: 24px;' },
          ],
        },
        {
          label: 'Hide secondary',
          modifications: [{ type: 'element-hide', selector: 'a.cta-secondary' }],
        },
      ],
    });
    const out = parseAndValidateResponse({ raw, availableSelectors: allowed, captureMethod: 'full' });
    expect(out.options).toHaveLength(2);
    expect(out.options[0].label).toBe('Bigger primary');
    expect(out.options[0].confidence).toBe('high');
    expect(out.droppedCount).toBe(0);
    expect(out.note).toMatch(/2 of 3/);
  });

  it('marks confidence "low" when capture method is structural', () => {
    const raw = JSON.stringify({
      options: [
        {
          label: 'a',
          modifications: [{ type: 'element-hide', selector: 'button.cta-primary' }],
        },
      ],
    });
    const out = parseAndValidateResponse({
      raw,
      availableSelectors: allowed,
      captureMethod: 'structural',
    });
    expect(out.options[0].confidence).toBe('low');
  });

  it('drops modifications with selectors not on the allowlist', () => {
    const raw = JSON.stringify({
      options: [
        {
          label: 'try-bad-selector',
          modifications: [
            { type: 'text-replace', selector: '.invented-by-ai', text: 'X' },
            { type: 'text-replace', selector: 'button.cta-primary', text: 'OK' },
          ],
        },
      ],
    });
    const out = parseAndValidateResponse({ raw, availableSelectors: allowed, captureMethod: 'full' });
    expect(out.options).toHaveLength(1);
    expect(out.options[0].modifications).toEqual([
      { type: 'text-replace', selector: 'button.cta-primary', text: 'OK' },
    ]);
    expect(out.droppedCount).toBe(1);
  });

  it('drops an option whose modifications are all invalid', () => {
    const raw = JSON.stringify({
      options: [
        {
          label: 'all-bad',
          modifications: [{ type: 'text-replace', selector: 'a.cta-secondary', text: '' }],
        },
        {
          label: 'one-good',
          modifications: [{ type: 'element-hide', selector: 'button.cta-primary' }],
        },
      ],
    });
    const out = parseAndValidateResponse({ raw, availableSelectors: allowed, captureMethod: 'full' });
    expect(out.options).toHaveLength(1);
    expect(out.options[0].label).toBe('one-good');
    expect(out.droppedCount).toBe(1);
  });

  it('rejects unknown modification types', () => {
    const raw = JSON.stringify({
      options: [
        {
          label: 'weird',
          modifications: [
            { type: 'eval', selector: 'button.cta-primary', code: 'alert(1)' },
            { type: 'element-reorder', parentSelector: 'button.cta-primary', childOrder: [1, 0] },
          ],
        },
      ],
    });
    const out = parseAndValidateResponse({ raw, availableSelectors: allowed, captureMethod: 'full' });
    expect(out.options).toHaveLength(0);
    expect(out.droppedCount).toBe(2);
    expect(out.note).toMatch(/No valid options/);
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n' + JSON.stringify({
      options: [
        {
          label: 'fenced',
          modifications: [{ type: 'element-hide', selector: 'button.cta-primary' }],
        },
      ],
    }) + '\n```';
    const out = parseAndValidateResponse({ raw, availableSelectors: allowed, captureMethod: 'full' });
    expect(out.options).toHaveLength(1);
  });

  it('returns a note when raw is not valid JSON', () => {
    const out = parseAndValidateResponse({
      raw: 'not json at all',
      availableSelectors: allowed,
      captureMethod: 'full',
    });
    expect(out.options).toHaveLength(0);
    expect(out.note).toMatch(/not valid JSON/);
  });

  it('falls back to a numbered label when the AI omits one', () => {
    const raw = JSON.stringify({
      options: [
        { modifications: [{ type: 'element-hide', selector: 'button.cta-primary' }] },
      ],
    });
    const out = parseAndValidateResponse({ raw, availableSelectors: allowed, captureMethod: 'full' });
    expect(out.options[0].label).toBe('Option 1');
  });
});

describe('callGeminiFlash', () => {
  it('extracts text + token counts from a successful response', async () => {
    const fakeBody = {
      candidates: [{ content: { parts: [{ text: '{"options":[]}' }] } }],
      usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 45 },
    };
    const result = await callGeminiFlash({
      prompt: 'hi',
      apiKey: 'k',
      fetcher: async () => ({ ok: true, status: 200, json: async () => fakeBody }),
    });
    expect(result.text).toBe('{"options":[]}');
    expect(result.promptTokens).toBe(123);
    expect(result.responseTokens).toBe(45);
  });

  it('throws when the upstream returns non-2xx', async () => {
    await expect(
      callGeminiFlash({
        prompt: 'hi',
        apiKey: 'k',
        fetcher: async () => ({ ok: false, status: 429, json: async () => ({}) }),
      }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it('handles missing usageMetadata gracefully', async () => {
    const result = await callGeminiFlash({
      prompt: 'hi',
      apiKey: 'k',
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }),
      }),
    });
    expect(result.promptTokens).toBeNull();
    expect(result.responseTokens).toBeNull();
  });
});

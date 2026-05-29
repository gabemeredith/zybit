/**
 * Live end-to-end check for the AI Variant Advisor scope expansion.
 *
 * Runs against the real OpenAI endpoint when `OPENAI_API_KEY`
 * is present in the environment; otherwise skipped. Verifies that:
 *
 *   1. The new MODIFICATION SCHEMA (with `element-insert`) round-trips
 *      through Gemini and the response parser without losing options.
 *   2. Heading selectors in the allowlist are usable as anchors —
 *      a return-visit-thrash-shaped prescription does not silently
 *      degrade into text-replace on a CTA.
 *   3. `parseAndValidateResponse` accepts whatever the live model
 *      returns (no dropped options) for at least one of the offered
 *      heading + CTA anchors.
 *
 * Skipped via vitest's `it.skipIf` when OPENAI_API_KEY is absent so the
 * test does not fail in CI without secrets. This is intentional — the
 * test sits in the regular suite as an opt-in live smoke check.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  callAdvisorModel,
  parseAndValidateResponse,
  type AdvisorDesignContext,
  type AdvisorFinding,
  type AdvisorSnapshotContext,
} from '../aiAdvisor';

const HAS_KEY = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10;

// The return-visit-thrash prescription is the canonical insert-shaped
// finding — the AcmeBank quick-answer prescription pre-loads with a starter
// HTML scaffold in the experiment builder. If element-insert isn't in the
// schema, the model has nowhere to put this and degrades to text-replace.
const INSERT_FINDING: AdvisorFinding = {
  ruleId: 'return-visit-thrash',
  prescription: {
    whatToChange:
      'Add a quick-answer section above the H1 with the three questions visitors most often arrive with already answered.',
    whyItWorks:
      'Returning visitors are re-reading because they did not get the answer they came for on the first visit. Putting the answers above the hero converts a re-read into a yes.',
    experimentVariantDescription:
      'A short block placed before the H1 with three Q-and-A pairs styled as compact paragraphs.',
  },
};

const DESIGN: AdvisorDesignContext = {
  captureMethod: 'full',
  designTokens: { primaryColor: '#1A73E8', secondaryColor: '#111827', typeScale: [16, 20, 24, 48] },
  computedStyles: {
    'cta:hero': { selector: 'button.cta-primary', backgroundColor: '#1A73E8', color: '#FFFFFF' },
    'heading:h1-0': { color: '#111827', fontSize: '48px' },
  },
  cssSystem: 'tailwind',
  screenshotUrl: null,
};

// The advisor's selector allowlist now includes heading cssSelectors —
// `#hero-h1` mirrors what the parser would emit for an H1 with a human id.
const SNAPSHOT: AdvisorSnapshotContext = {
  availableSelectors: ['#hero-h1', 'button.cta-primary', 'a.cta-secondary'],
  ctaVocabulary: ['Open a checking account', 'See pricing'],
};

describe('AI Variant Advisor — live OpenAI smoke check', () => {
  it.skipIf(!HAS_KEY)(
    'returns at least one valid option for an insert-shaped finding against a heading anchor',
    async () => {
      const prompt = buildPrompt({ finding: INSERT_FINDING, design: DESIGN, snapshot: SNAPSHOT });
      expect(prompt).toContain('element-insert');
      expect(prompt).toContain('#hero-h1');

      const apiKey = process.env.OPENAI_API_KEY!;
      const modelResult = await callAdvisorModel({ prompt, apiKey });

      // Raw text should be JSON (json mode is requested in our call).
      expect(modelResult.text.length).toBeGreaterThan(0);

      const result = parseAndValidateResponse({
        raw: modelResult.text,
        availableSelectors: SNAPSHOT.availableSelectors,
        captureMethod: 'full',
      });

      // The strict contract: at least one option survived schema + selector
      // validation. The advisor route returns 503/note when zero options
      // survive — that's the failure mode PR #84 was paused on.
      expect(result.options.length, `model returned: ${modelResult.text.slice(0, 500)}`).toBeGreaterThan(0);

      // Every surviving modification must target an allowlisted selector
      // (proves the new heading selector flows through validation).
      const allSelectors = new Set(SNAPSHOT.availableSelectors);
      for (const opt of result.options) {
        for (const mod of opt.modifications) {
          // every kind we accept carries a `selector`
          if ('selector' in mod) {
            expect(allSelectors.has(mod.selector)).toBe(true);
          }
        }
      }
    },
    60_000,
  );

  it.skipIf(!HAS_KEY)(
    'rejects an element-insert proposal that sanitizes to empty (script-only payload)',
    async () => {
      // This does NOT call Gemini — it pipes a hand-crafted "as if the model
      // tried this" response through parseAndValidateResponse. Belt-and-
      // suspenders: confirms the live validation pipeline matches the unit
      // test in the same shape Gemini would actually return.
      const raw = JSON.stringify({
        options: [
          {
            label: 'all-stripped',
            modifications: [
              {
                type: 'element-insert',
                selector: '#hero-h1',
                position: 'before',
                html: '<script>alert(1)</script>',
              },
            ],
          },
        ],
      });
      const result = parseAndValidateResponse({
        raw,
        availableSelectors: SNAPSHOT.availableSelectors,
        captureMethod: 'full',
      });
      expect(result.options).toHaveLength(0);
    },
  );
});

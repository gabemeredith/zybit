import { describe, expect, it } from 'vitest';
import { buildJudgePrompt, parseJudgeVerdict, runJudge, type JudgeInput } from '../judge';
import type { OpenAIFetcher } from '@/lib/ai/openai';

const INPUT: JudgeInput = {
  ruleId: 'bounce-on-key-page',
  pathRef: '/pricing',
  a: { summary: 'Add a quick-answer block above the hero', whatToChange: 'Do X' },
  b: { summary: 'Place a comparison table above the fold', whatToChange: 'Do Y' },
};

describe('buildJudgePrompt', () => {
  it('includes the finding, both write-ups, and a blind A/B framing', () => {
    const p = buildJudgePrompt(INPUT);
    expect(p).toContain('bounce-on-key-page');
    expect(p).toContain('/pricing');
    expect(p).toContain('WRITE-UP A:');
    expect(p).toContain('WRITE-UP B:');
    expect(p).toContain('Add a quick-answer block above the hero');
    expect(p).toContain('Place a comparison table above the fold');
    // the framing never leaks which write-up is the machine
    expect(p).not.toMatch(/template|llm|machine|which is the model/i);
  });

  it('strips angle brackets from untrusted prose', () => {
    const p = buildJudgePrompt({ ...INPUT, a: { summary: '<script>x</script>' } });
    expect(p).not.toContain('<script>');
  });
});

describe('parseJudgeVerdict', () => {
  it('parses A / B / tie', () => {
    expect(parseJudgeVerdict('{"winner":"A","reason":"clearer"}')?.winner).toBe('A');
    expect(parseJudgeVerdict('{"winner":"B","reason":"x"}')?.winner).toBe('B');
    expect(parseJudgeVerdict('{"winner":"tie","reason":"x"}')?.winner).toBe('tie');
  });
  it('strips markdown fences', () => {
    expect(parseJudgeVerdict('```json\n{"winner":"B","reason":"x"}\n```')?.winner).toBe('B');
  });
  it('returns null on invalid JSON or bad winner', () => {
    expect(parseJudgeVerdict('not json')).toBeNull();
    expect(parseJudgeVerdict('{"winner":"C"}')).toBeNull();
    expect(parseJudgeVerdict('{"reason":"no winner"}')).toBeNull();
  });
});

describe('runJudge', () => {
  it('returns null when no API key is available', async () => {
    expect(await runJudge(INPUT, { apiKey: null })).toBeNull();
  });
  it('returns the parsed verdict from the model', async () => {
    const fetcher: OpenAIFetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"winner":"B","reason":"more concrete"}' } }] }),
    });
    const v = await runJudge(INPUT, { apiKey: 'k', fetcher });
    expect(v).toEqual({ winner: 'B', reason: 'more concrete' });
  });
});

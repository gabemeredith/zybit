import { describe, expect, it } from 'vitest';
import { runEval } from '../runEval';
import type { LayerBRunTelemetry } from '../../orchestrator';
import type { OpenAIFetcher } from '@/lib/ai/openai';

// Telemetry with two findings, each carrying a template + LLM prose pair.
// Markers let the mock judge tell the two apart from the (blind) prompt.
function telemetry(): LayerBRunTelemetry {
  const finding = (id: string) =>
    ({
      findingId: id,
      ruleId: id,
      pathRef: '/x',
      pageType: 'unknown',
      priorityScore: 0.5,
      category: 'bounce',
      proseSource: 'llm-v1',
      call: { outcome: 'success' },
      prose: {
        template: { summary: 'TPL-PROSE summary', recommendation: [], prescription: { whatToChange: 'tpl' } },
        llm: { summary: 'LLM-PROSE summary', recommendation: [], prescription: { whatToChange: 'llm' } },
      },
    }) as unknown as LayerBRunTelemetry['findings'][number];
  return {
    enabled: true,
    model: 'gemini-2.5-flash',
    attempted: 2,
    llmWon: 2,
    fellBack: 0,
    fallbackRate: 0,
    fabricationRejections: 0,
    fabricationRejectionRate: 0,
    latencyMsP50: 100,
    latencyMsP95: 100,
    totalPromptTokens: 0,
    totalResponseTokens: 0,
    estTotalCostUsd: 0,
    proseSourceCounts: { template: 0, 'llm-v1': 2 },
    brandProfile: null,
    siteContext: null,
    findings: [finding('a'), finding('b')],
  };
}

function verdictResponse(winner: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ winner, reason: 'mock' }) } }] }) };
}

describe('runEval', () => {
  it('counts an LLM win only when the judge prefers it in BOTH orders', async () => {
    // Mock judge always prefers whichever slot holds the LLM marker.
    const fetcher: OpenAIFetcher = async (_url, init) => {
      const prompt = (JSON.parse(init.body).messages[0].content as string);
      const aSection = prompt.slice(prompt.indexOf('WRITE-UP A:'), prompt.indexOf('WRITE-UP B:'));
      const winner = aSection.includes('LLM-PROSE') ? 'A' : 'B';
      return verdictResponse(winner);
    };
    const report = await runEval(telemetry(), { apiKey: 'k', fetcher });
    expect(report.judged).toBe(2);
    expect(report.llmWins).toBe(2);
    expect(report.ties).toBe(0);
    expect(report.llmWinRate).toBe(1);
  });

  it('cancels a position-biased judge (always picks A) to ties, not wins', async () => {
    const fetcher: OpenAIFetcher = async () => verdictResponse('A');
    const report = await runEval(telemetry(), { apiKey: 'k', fetcher });
    expect(report.llmWins).toBe(0);
    expect(report.templateWins).toBe(0);
    expect(report.ties).toBe(2);
    expect(report.llmWinRate).toBe(0);
    expect(report.decisiveRate).toBe(0);
  });

  it('reports a tie when the judge is unavailable', async () => {
    const report = await runEval(telemetry(), { apiKey: null, geminiApiKey: null });
    expect(report.ties).toBe(2);
    expect(report.judged).toBe(2);
  });
});

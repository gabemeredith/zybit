import { describe, expect, it } from 'vitest';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import type { PageSnapshot } from '@/lib/phase2/snapshots/types';
import { applyLayerB, isLayerBEnabled } from '../orchestrator';
import type { LayerBFetcher } from '../runLayerB';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 'return-visit-thrash:/pricing',
    ruleId: 'return-visit-thrash',
    category: 'thrash',
    severity: 'warn',
    confidence: 0.8,
    priorityScore: 0.5,
    pathRef: '/pricing',
    title: 'Return-visit thrash',
    summary: 'TEMPLATE summary',
    recommendation: ['TEMPLATE recommendation'],
    prescription: {
      whatToChange: 'TEMPLATE whatToChange',
      whyItWorks: 'TEMPLATE whyItWorks',
      experimentVariantDescription: 'TEMPLATE variant',
    },
    evidence: [],
    factsJson: { thrashSessions: 234, totalSessions: 1950, thrashRate: 0.12 },
    ...overrides,
  };
}

const VALID_LLM = JSON.stringify({
  summary: '234 sessions loop on /pricing — 12% of touching sessions get stuck.',
  recommendation: ['LLM recommendation grounded in 234 sessions.'],
  prescription: {
    whatToChange: 'Add a quick-answer block to /pricing.',
    whyItWorks: 'Surfacing the answer on the first visit eliminates the loop.',
    experimentVariantDescription: 'Variant B: top-of-page quick-answer block.',
  },
});

function okFetcher(text: string, tokens = { p: 100, r: 200 }): LayerBFetcher {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: tokens.p, completion_tokens: tokens.r },
    }),
  });
}

const emptySnapshots = new Map<string, PageSnapshot>();
const clock = (() => {
  let t = 0;
  return () => (t += 5);
})();

// ---------------------------------------------------------------------------

describe('isLayerBEnabled', () => {
  it('explicit override wins over the env flag', () => {
    expect(isLayerBEnabled(true)).toBe(true);
    expect(isLayerBEnabled(false)).toBe(false);
  });
});

describe('applyLayerB', () => {
  it('is a no-op when disabled — findings unchanged, telemetry.enabled false', async () => {
    const findings = [makeFinding()];
    const { findings: out, telemetry } = await applyLayerB(
      findings,
      { pageSnapshotsByPath: emptySnapshots },
      { enabled: false },
    );
    expect(out[0].summary).toBe('TEMPLATE summary');
    expect(out[0].proseSource).toBeUndefined();
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.attempted).toBe(0);
  });

  it('swaps prose + marks llm-v1 + records telemetry on success', async () => {
    const { findings: out, telemetry } = await applyLayerB(
      [makeFinding()],
      { pageSnapshotsByPath: emptySnapshots },
      { enabled: true, apiKey: 'k', fetcher: okFetcher(VALID_LLM), now: clock },
    );
    expect(out[0].summary).toMatch(/^234 sessions loop/);
    expect(out[0].proseSource).toBe('llm-v1');
    expect(telemetry.attempted).toBe(1);
    expect(telemetry.llmWon).toBe(1);
    expect(telemetry.fellBack).toBe(0);
    expect(telemetry.totalResponseTokens).toBe(200);
    expect(telemetry.estTotalCostUsd).toBeGreaterThan(0);
    // Both prose versions captured for the side-by-side.
    expect(telemetry.findings[0].prose.template.summary).toBe('TEMPLATE summary');
    expect(telemetry.findings[0].prose.llm?.summary).toMatch(/^234 sessions loop/);
  });

  it('keeps template prose + records fallback reason on fabrication', async () => {
    const fabricated = JSON.stringify({
      summary: '999 sessions loop — 87% stuck.',
      recommendation: ['ok'],
      prescription: {
        whatToChange: 'x',
        whyItWorks: 'y',
        experimentVariantDescription: 'z',
      },
    });
    const { findings: out, telemetry } = await applyLayerB(
      [makeFinding()],
      { pageSnapshotsByPath: emptySnapshots },
      { enabled: true, apiKey: 'k', fetcher: okFetcher(fabricated), now: clock },
    );
    expect(out[0].summary).toBe('TEMPLATE summary');
    expect(out[0].proseSource).toBe('template');
    expect(telemetry.fellBack).toBe(1);
    expect(telemetry.fabricationRejections).toBe(1);
    expect(telemetry.findings[0].call.outcome).toBe('fabrication-reject');
  });

  it('leaves findings without factsJson untouched (not eligible)', async () => {
    const noFacts = makeFinding({ id: 'other:/x', ruleId: 'other', factsJson: undefined });
    const { findings: out, telemetry } = await applyLayerB(
      [noFacts],
      { pageSnapshotsByPath: emptySnapshots },
      { enabled: true, apiKey: 'k', fetcher: okFetcher(VALID_LLM), now: clock },
    );
    expect(out[0].proseSource).toBeUndefined();
    expect(telemetry.attempted).toBe(0);
  });

  it('compare mode makes a finding without factsJson eligible via derived facts', async () => {
    const noFacts = makeFinding({
      id: 'bounce:/x',
      ruleId: 'bounce-on-key-page',
      factsJson: undefined,
      evidence: [
        { label: 'Entries', value: 300 },
        { label: 'Bounce rate', value: '67%' },
      ],
    });
    // Without compare mode → not eligible.
    const off = await applyLayerB(
      [noFacts],
      { pageSnapshotsByPath: emptySnapshots },
      { enabled: true, apiKey: 'k', fetcher: okFetcher(VALID_LLM), now: clock },
    );
    expect(off.telemetry.attempted).toBe(0);

    // With compare mode → eligible (facts derived from evidence).
    const on = await applyLayerB(
      [noFacts],
      { pageSnapshotsByPath: emptySnapshots },
      {
        enabled: true,
        deriveFactsFromEvidence: true,
        apiKey: 'k',
        fetcher: okFetcher(VALID_LLM),
        now: clock,
      },
    );
    expect(on.telemetry.attempted).toBe(1);
    expect(on.telemetry.findings[0].prose.template.summary).toBe('TEMPLATE summary');
  });

  it('only sends the top-N eligible findings by priorityScore', async () => {
    const findings = [
      makeFinding({ id: 'a', priorityScore: 0.9 }),
      makeFinding({ id: 'b', priorityScore: 0.8 }),
      makeFinding({ id: 'c', priorityScore: 0.1 }),
    ];
    const { telemetry } = await applyLayerB(
      findings,
      { pageSnapshotsByPath: emptySnapshots },
      { enabled: true, apiKey: 'k', fetcher: okFetcher(VALID_LLM), now: clock, topN: 2 },
    );
    expect(telemetry.attempted).toBe(2);
    expect(telemetry.findings.map((f) => f.findingId).sort()).toEqual(['a', 'b']);
  });
});

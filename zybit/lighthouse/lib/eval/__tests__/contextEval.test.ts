import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pairFindings, type ComparableFinding } from '../contextComparison';
import { computeScoreboard, createVerdictStore, type VerdictRecord } from '../verdictStore';

const f = (
  ruleId: string,
  pathRef: string | null,
  summary: string,
  whatToChange?: string,
): ComparableFinding => ({
  ruleId,
  pathRef,
  title: `${ruleId} title`,
  summary,
  prescription: whatToChange ? { whatToChange } : null,
});

describe('pairFindings', () => {
  it('flags changed prose and orders interesting rows first', () => {
    const baseline = [
      f('proof-missing', '/', 'Add social proof', 'Add a logo row'),
      f('vague-claim', '/', 'Claim is vague', 'Rewrite hero'),
    ];
    const enriched = [
      f('proof-missing', '/', 'Add social proof', 'Add a logo row'), // identical
      f('vague-claim', '/', 'Hero is vague for fintech buyers', 'Rewrite hero to name the outcome'), // changed
    ];
    const rows = pairFindings(baseline, enriched);
    expect(rows).toHaveLength(2);
    // changed row sorts before the unchanged one
    expect(rows[0].ruleId).toBe('vague-claim');
    expect(rows[0].changed).toBe(true);
    expect(rows[1].ruleId).toBe('proof-missing');
    expect(rows[1].changed).toBe(false);
  });

  it('marks presenceDiff when a finding fires in only one run', () => {
    const baseline = [f('proof-missing', '/', 'x')];
    const enriched = [f('proof-missing', '/', 'x'), f('cta-verb-mismatch', '/pricing', 'y')];
    const rows = pairFindings(baseline, enriched);
    const only = rows.find((r) => r.ruleId === 'cta-verb-mismatch')!;
    expect(only.presenceDiff).toBe(true);
    expect(only.baseline).toBeNull();
    expect(only.enriched).not.toBeNull();
    // presence-diff rows rank first
    expect(rows[0].ruleId).toBe('cta-verb-mismatch');
  });

  it('keys on ruleId+pathRef so the same rule on two pages stays distinct', () => {
    const rows = pairFindings(
      [f('proof-missing', '/', 'a'), f('proof-missing', '/pricing', 'b')],
      [f('proof-missing', '/', 'a'), f('proof-missing', '/pricing', 'b')],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe('computeScoreboard', () => {
  it('tallies per-variant valid/invalid and computes the valid-rate delta', () => {
    const recs: VerdictRecord[] = [
      { url: 'u', key: 'a', variant: 'baseline', verdict: 'invalid', at: '' },
      { url: 'u', key: 'b', variant: 'baseline', verdict: 'valid', at: '' },
      { url: 'u', key: 'a', variant: 'enriched', verdict: 'valid', at: '' },
      { url: 'u', key: 'b', variant: 'enriched', verdict: 'valid', at: '' },
    ];
    const s = computeScoreboard(recs);
    expect(s.baseline).toEqual({ valid: 1, invalid: 1 }); // 0.5
    expect(s.enriched).toEqual({ valid: 2, invalid: 0 }); // 1.0
    expect(s.validRateDelta).toBeCloseTo(0.5);
  });

  it('returns null delta when an arm has no judgments', () => {
    expect(computeScoreboard([]).validRateDelta).toBeNull();
  });
});

describe('createVerdictStore', () => {
  const path = join(tmpdir(), `zybit-eval-verdicts-test-${process.pid}.json`);
  afterEach(() => {
    try {
      rmSync(path);
    } catch {
      /* ignore */
    }
  });

  it('persists and reloads verdicts, last-write-wins per (url,key,variant)', () => {
    const store = createVerdictStore(path);
    store.record({ url: 'u', key: 'a', variant: 'enriched', verdict: 'valid' });
    store.record({ url: 'u', key: 'a', variant: 'enriched', verdict: 'invalid' }); // overwrite
    store.record({ url: 'u', key: 'b', variant: 'baseline', verdict: 'valid' });
    store.record({ url: 'other', key: 'a', variant: 'enriched', verdict: 'valid' });

    const forU = store.listForUrl('u');
    expect(forU).toHaveLength(2);
    expect(forU.find((r) => r.key === 'a')!.verdict).toBe('invalid');
    expect(store.scoreboard('u').enriched).toEqual({ valid: 0, invalid: 1 });
  });

  it('tolerates a missing file', () => {
    const store = createVerdictStore(join(tmpdir(), `zybit-eval-missing-${process.pid}.json`));
    expect(store.listForUrl('u')).toEqual([]);
  });
});

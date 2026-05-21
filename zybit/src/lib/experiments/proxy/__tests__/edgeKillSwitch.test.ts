import { describe, it, expect } from 'vitest';
import {
  nextDisabledList,
  resolveEdgeConfigId,
  disableExperimentAtEdge,
} from '../edgeKillSwitch';
import { filterDisabledExperiments, type ProxyConfig } from '../config';

describe('nextDisabledList', () => {
  it('adds an id to an empty/undefined list', () => {
    expect(nextDisabledList(undefined, 'a')).toEqual(['a']);
    expect(nextDisabledList([], 'a')).toEqual(['a']);
  });

  it('unions without duplicating', () => {
    expect(nextDisabledList(['a', 'b'], 'a').sort()).toEqual(['a', 'b']);
    expect(nextDisabledList(['a'], 'b').sort()).toEqual(['a', 'b']);
  });
});

describe('resolveEdgeConfigId', () => {
  it('prefers EDGE_CONFIG_ID', () => {
    expect(resolveEdgeConfigId({ EDGE_CONFIG_ID: 'ecfg_explicit' })).toBe('ecfg_explicit');
  });

  it('parses the id out of an EDGE_CONFIG connection string', () => {
    const env = { EDGE_CONFIG: 'https://edge-config.vercel.com/ecfg_abc123?token=xyz' };
    expect(resolveEdgeConfigId(env)).toBe('ecfg_abc123');
  });

  it('returns null when nothing is configured', () => {
    expect(resolveEdgeConfigId({})).toBeNull();
  });
});

describe('disableExperimentAtEdge', () => {
  it('is a no-op when Edge Config write is not configured', async () => {
    const res = await disableExperimentAtEdge('exp-1', {});
    expect(res).toEqual({ ok: false, reason: 'not-configured' });
  });
});

describe('filterDisabledExperiments', () => {
  const config: ProxyConfig = {
    site: { id: 's1', domain: 'x.com' },
    experiments: [
      { id: 'e1', targetPath: null, modifications: [], controlPct: 50, durationDays: 14, status: 'running' },
      { id: 'e2', targetPath: null, modifications: [], controlPct: 50, durationDays: 14, status: 'running' },
    ],
  };

  it('returns config unchanged when the kill-list is empty', () => {
    expect(filterDisabledExperiments(config, []).experiments).toHaveLength(2);
    expect(filterDisabledExperiments(config, undefined).experiments).toHaveLength(2);
  });

  it('drops experiments on the kill-list', () => {
    const out = filterDisabledExperiments(config, ['e1']);
    expect(out.experiments.map((e) => e.id)).toEqual(['e2']);
  });
});

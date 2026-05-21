import { describe, expect, it } from 'vitest';
import {
  didDrift,
  latestSnapshotPerPath,
  snapshotStaleDays,
  type RefreshableSnapshot,
} from '../refresh';

function snap(pathRef: string, contentHash: string, fetchedAt: string): RefreshableSnapshot {
  return { pathRef, url: `https://x.test${pathRef}`, contentHash, fetchedAt: new Date(fetchedAt) };
}

describe('latestSnapshotPerPath', () => {
  it('keeps the newest snapshot per pathRef regardless of input order', () => {
    const input = [
      snap('/a', 'h1', '2026-05-01T00:00:00Z'),
      snap('/a', 'h2', '2026-05-10T00:00:00Z'), // newer for /a
      snap('/b', 'h3', '2026-05-05T00:00:00Z'),
      snap('/a', 'h0', '2026-04-01T00:00:00Z'), // older for /a
    ];
    const out = latestSnapshotPerPath(input);
    expect(out).toHaveLength(2);
    const a = out.find((s) => s.pathRef === '/a');
    expect(a?.contentHash).toBe('h2');
    expect(out.find((s) => s.pathRef === '/b')?.contentHash).toBe('h3');
  });

  it('returns an empty array for no snapshots', () => {
    expect(latestSnapshotPerPath([])).toEqual([]);
  });
});

describe('didDrift', () => {
  it('detects a content hash change', () => {
    expect(didDrift('abc', 'def')).toBe(true);
    expect(didDrift('abc', 'abc')).toBe(false);
  });
});

describe('snapshotStaleDays', () => {
  const now = new Date('2026-05-21T00:00:00Z').getTime();

  it('returns null when there is no snapshot', () => {
    expect(snapshotStaleDays(null, now)).toBeNull();
  });

  it('floors whole days since the last fetch', () => {
    expect(snapshotStaleDays(new Date('2026-05-13T12:00:00Z'), now)).toBe(7);
    expect(snapshotStaleDays(new Date('2026-05-20T23:00:00Z'), now)).toBe(0);
  });

  it('clamps a future fetch to 0', () => {
    expect(snapshotStaleDays(new Date('2026-06-01T00:00:00Z'), now)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  boundedNormal,
  logNormal,
  randInt,
  weightedSample,
} from './distributions';
import { mulberry32 } from './rng';

const N = 10_000;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

describe('logNormal', () => {
  it('hits the requested mean and stddev within ~5% over N=10k draws', () => {
    const rng = mulberry32(1);
    const samples = Array.from({ length: N }, () => logNormal(1000, 300, rng));
    expect(mean(samples)).toBeGreaterThan(950);
    expect(mean(samples)).toBeLessThan(1050);
    expect(stddev(samples)).toBeGreaterThan(270);
    expect(stddev(samples)).toBeLessThan(330);
  });

  it('always returns positive values (log-normal support)', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 200; i++) {
      expect(logNormal(50, 30, rng)).toBeGreaterThan(0);
    }
  });

  it('returns the mean when stddev is 0', () => {
    expect(logNormal(500, 0, mulberry32(3))).toBe(500);
  });
});

describe('boundedNormal', () => {
  it('clips to [min, max]', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 1000; i++) {
      const v = boundedNormal(50, 100, 10, 90, rng);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(90);
    }
  });
});

describe('weightedSample', () => {
  it('respects weights over many draws', () => {
    const rng = mulberry32(5);
    const items = [
      { item: 'A', weight: 1 },
      { item: 'B', weight: 3 },
    ];
    const counts = { A: 0, B: 0 } as Record<string, number>;
    for (let i = 0; i < N; i++) {
      counts[weightedSample(items, rng)]++;
    }
    // expected ratio 1:3 → A ~ 25%, B ~ 75%; allow ±2pp slack
    expect(counts.A / N).toBeGreaterThan(0.22);
    expect(counts.A / N).toBeLessThan(0.28);
    expect(counts.B / N).toBeGreaterThan(0.72);
    expect(counts.B / N).toBeLessThan(0.78);
  });

  it('throws on empty list', () => {
    expect(() => weightedSample([], mulberry32(6))).toThrow();
  });

  it('throws when all weights are zero', () => {
    expect(() =>
      weightedSample([{ item: 'x', weight: 0 }], mulberry32(7)),
    ).toThrow();
  });

  it('throws on negative weight', () => {
    expect(() =>
      weightedSample(
        [
          { item: 'x', weight: 1 },
          { item: 'y', weight: -1 },
        ],
        mulberry32(8),
      ),
    ).toThrow();
  });
});

describe('randInt', () => {
  it('produces inclusive integers in [min, max]', () => {
    const rng = mulberry32(9);
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 1000; i++) {
      const v = randInt(3, 5, rng);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
      if (v === 3) sawMin = true;
      if (v === 5) sawMax = true;
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, seededRng } from './rng';

describe('mulberry32', () => {
  it('produces a deterministic sequence given the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('always returns values in [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('is stable across calls', () => {
    expect(hashSeed('acmebank|0')).toBe(hashSeed('acmebank|0'));
  });

  it('differs for differing inputs', () => {
    expect(hashSeed('acmebank|0')).not.toBe(hashSeed('acmebank|1'));
  });

  it('returns a non-negative 32-bit integer', () => {
    const h = hashSeed('something');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('seededRng', () => {
  it('two rngs from the same key produce the same sequence', () => {
    const a = seededRng('cal-com|session=7');
    const b = seededRng('cal-com|session=7');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});

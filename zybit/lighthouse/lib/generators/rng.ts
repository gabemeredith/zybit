/**
 * Deterministic RNG for Lighthouse session generation.
 *
 * Determinism guarantee: same `seed` → same `Rng` → same sequence of
 * `next()` outputs. Used by all driver/distribution code so re-running a
 * scenario with the same scenarioId + sessionIndex produces the same
 * Playwright behavior. (Postgres `createdAt` and PostHog server-side
 * timestamps will still differ — those are upstream of us.)
 *
 * Uses mulberry32 (32-bit state, period ~2^32) which is more than enough
 * for ~10k events per scenario; not crypto-secure on purpose.
 */

export interface Rng {
  next(): number;
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * 32-bit FNV-1a hash. Stable, fast, plenty good for seeding mulberry32
 * from `scenarioId + sessionIndex` style keys.
 */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRng(key: string): Rng {
  return mulberry32(hashSeed(key));
}

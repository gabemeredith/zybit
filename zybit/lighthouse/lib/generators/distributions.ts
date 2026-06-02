/**
 * Sampling primitives for persona behavior.
 *
 * Persona traits are parameterized in *natural* units (mean dwell ms,
 * mean pages per session, scroll depth percent) so the persona file
 * stays readable. These helpers translate from natural-unit parameters
 * to the actual draw, sourcing entropy from a seeded Rng so the whole
 * pipeline stays deterministic.
 */

import type { Rng } from './rng';

/** Box–Muller standard normal. Always pairs but we only need one. */
function standardNormal(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng.next();
  while (v === 0) v = rng.next();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Sample a log-normal value with the given natural-unit mean and stddev.
 *
 * We parameterize in natural units (not in log-space mu/sigma) because
 * personas are easier to write that way. The conversion uses the
 * standard moment-matching formulas:
 *
 *   sigma^2 = ln(1 + (stddev/mean)^2)
 *   mu      = ln(mean) - sigma^2 / 2
 */
export function logNormal(mean: number, stddev: number, rng: Rng): number {
  if (mean <= 0) return 0;
  if (stddev <= 0) return mean;
  const variance = stddev * stddev;
  const sigmaSq = Math.log(1 + variance / (mean * mean));
  const mu = Math.log(mean) - sigmaSq / 2;
  return Math.exp(mu + Math.sqrt(sigmaSq) * standardNormal(rng));
}

/** Normal sample clipped to [min, max]. */
export function boundedNormal(
  mean: number,
  stddev: number,
  min: number,
  max: number,
  rng: Rng,
): number {
  const x = mean + stddev * standardNormal(rng);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export interface Weighted<T> {
  item: T;
  weight: number;
}

/**
 * Weighted random pick. Weights need not sum to 1 (we normalize). Throws
 * if the list is empty or all weights are zero — caller mistake.
 */
export function weightedSample<T>(items: Weighted<T>[], rng: Rng): T {
  if (items.length === 0) {
    throw new Error('weightedSample: empty list');
  }
  let total = 0;
  for (const it of items) {
    if (it.weight < 0) throw new Error('weightedSample: negative weight');
    total += it.weight;
  }
  if (total <= 0) throw new Error('weightedSample: all weights zero');
  let r = rng.next() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.item;
  }
  return items[items.length - 1].item;
}

/** Inclusive integer in [min, max]. */
export function randInt(min: number, max: number, rng: Rng): number {
  return Math.floor(min + rng.next() * (max - min + 1));
}

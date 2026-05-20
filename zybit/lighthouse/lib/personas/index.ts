/**
 * Five starter personas for Phase 1.
 *
 * Numbers are deliberate-but-uncalibrated guesses. Calibration is
 * Phase 3 work (see phase1.md §7 bias-controls). When real benchmarks
 * are available, replace these and the `// TODO(prior):` comment with
 * the citation.
 *
 * Bias control: `clickIntent` and `formSubmitIntent` span ≥3× across
 * the five personas (0.08 → 0.55 and 0.02 → 0.40) per phase1.md §7.
 */

import type { Persona } from './types';

// TODO(prior): swap guesses for Baymard / NN/g / Contentsquare numbers
// once we calibrate. The relative shape (power > evaluator > casual >
// churning > bot-ish) is what matters; absolute levels will shift.

export const PERSONAS: Persona[] = [
  {
    id: 'power-user',
    weight: 0.08,
    sessionsPerVisit: { min: 1, max: 3 },
    pagesPerSession: { mean: 12, stddev: 5 },
    dwellMsPerPage: { mean: 18_000, stddev: 8_000 },
    scrollDepthPct: { mean: 80, stddev: 15 },
    clickIntent: 0.55,
    formSubmitIntent: 0.4,
    bounceProbability: 0.05,
    preferredPaths: ['/event-types', '/bookings', '/settings', '/team'],
    diurnalWindowUtc: [13, 22],
  },
  {
    id: 'casual',
    weight: 0.45,
    sessionsPerVisit: { min: 1, max: 2 },
    pagesPerSession: { mean: 4, stddev: 2 },
    dwellMsPerPage: { mean: 6_000, stddev: 3_000 },
    scrollDepthPct: { mean: 45, stddev: 20 },
    clickIntent: 0.18,
    formSubmitIntent: 0.08,
    bounceProbability: 0.35,
    preferredPaths: ['/', '/pricing', '/signup'],
    diurnalWindowUtc: [12, 23],
  },
  {
    id: 'evaluator',
    weight: 0.2,
    sessionsPerVisit: { min: 2, max: 5 },
    pagesPerSession: { mean: 8, stddev: 3 },
    dwellMsPerPage: { mean: 11_000, stddev: 5_000 },
    scrollDepthPct: { mean: 70, stddev: 18 },
    clickIntent: 0.35,
    formSubmitIntent: 0.12,
    bounceProbability: 0.15,
    preferredPaths: ['/', '/pricing', '/docs', '/customers', '/integrations'],
    diurnalWindowUtc: [14, 21],
  },
  {
    id: 'churning',
    weight: 0.15,
    sessionsPerVisit: { min: 1, max: 1 },
    pagesPerSession: { mean: 2, stddev: 1 },
    dwellMsPerPage: { mean: 3_500, stddev: 1_500 },
    scrollDepthPct: { mean: 25, stddev: 15 },
    clickIntent: 0.1,
    formSubmitIntent: 0.03,
    bounceProbability: 0.6,
    preferredPaths: ['/settings/billing', '/settings/account'],
    diurnalWindowUtc: [13, 23],
  },
  {
    id: 'bot-ish',
    weight: 0.12,
    sessionsPerVisit: { min: 1, max: 1 },
    pagesPerSession: { mean: 1.5, stddev: 0.6 },
    dwellMsPerPage: { mean: 800, stddev: 400 },
    scrollDepthPct: { mean: 8, stddev: 5 },
    clickIntent: 0.08,
    formSubmitIntent: 0.02,
    bounceProbability: 0.85,
    preferredPaths: ['/', '/robots.txt', '/sitemap.xml'],
    diurnalWindowUtc: [0, 24],
  },
];

export const PERSONAS_BY_ID: Record<string, Persona> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p]),
);

export function personaById(id: string): Persona {
  const p = PERSONAS_BY_ID[id];
  if (!p) throw new Error(`unknown persona: ${id}`);
  return p;
}

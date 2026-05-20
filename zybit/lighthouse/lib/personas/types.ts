/**
 * Persona DSL — matches phase1.md §5.4.
 *
 * Persona traits are declarative because the rest of the driver
 * shouldn't need to "read" persona behavior; the driver just samples
 * from these distributions. Numbers are in natural units (ms, %, 0..1
 * probabilities) so the file stays reviewable.
 */

export interface Persona {
  id: string;
  /** Share of sessions assigned to this persona; weights are normalized at sample time. */
  weight: number;
  sessionsPerVisit: { min: number; max: number };
  pagesPerSession: { mean: number; stddev: number };
  /** Per-page dwell time in ms; log-normal. */
  dwellMsPerPage: { mean: number; stddev: number };
  /** Scroll depth percent (0..100); bounded normal. */
  scrollDepthPct: { mean: number; stddev: number };
  /** Probability of clicking a CTA when one is visible. */
  clickIntent: number;
  /** Probability of completing a visible form when intent fires. */
  formSubmitIntent: number;
  /** Probability of leaving after exactly one page. */
  bounceProbability: number;
  /** Path-prefix biases — click weighting nudged toward these. */
  preferredPaths: string[];
  /** Hour-of-day band the persona is active in (UTC). */
  diurnalWindowUtc: [number, number];
}

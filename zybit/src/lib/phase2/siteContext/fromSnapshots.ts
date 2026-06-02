/**
 * Adapter: page snapshots → SiteContext input signals. Kept separate from
 * `deriveSiteContext` so the inference core stays decoupled from snapshot types
 * (and trivially unit-testable without constructing full PageSnapshot rows).
 *
 * SiteContext is a SITE-level property, so we draw signals from the homepage
 * (the page that carries the positioning) and fall back to the first snapshot.
 */

import type { PageSnapshot, PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { SiteContextSignals } from './deriveSiteContext';

export interface SnapshotSignals {
  /** Best site URL for the deterministic industry prior (host/path based). */
  url: string | null;
  signals: SiteContextSignals;
}

/** Extract SiteContext signals from one page's parsed snapshot data. */
export function siteSignalsFromData(d: PageSnapshotData): SiteContextSignals {
  const headings = (d.headings ?? [])
    .filter((h) => h.level <= 2)
    .map((h) => h.text)
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  const ctaVocabulary = (d.ctas ?? [])
    .map((c) => c.text)
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

  return {
    title: d.meta?.title ?? null,
    description: d.meta?.description ?? null,
    headings,
    heroHeadline: d.visualSignals?.heroBlock?.headline ?? null,
    heroSubheadline: d.visualSignals?.heroBlock?.subheadline ?? null,
    ctaVocabulary,
  };
}

/** Site-level signals: drawn from the homepage (falls back to first snapshot). */
export function siteSignalsFromSnapshots(snapshots: PageSnapshot[]): SnapshotSignals {
  const home = snapshots.find((s) => s.pathRef === '/') ?? snapshots[0] ?? null;
  if (!home) return { url: null, signals: {} };
  return { url: home.url ?? null, signals: siteSignalsFromData(home.data) };
}

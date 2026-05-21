/**
 * Pure helpers for the snapshot refresh cron (Zybit-023).
 *
 * The cron itself (HTTP fetch + DB upsert) lives in the route; the
 * dedupe + drift logic is isolated here so it can be unit-tested without
 * a database or network.
 */

/** Minimal shape the refresh logic needs from a stored snapshot. */
export interface RefreshableSnapshot {
  pathRef: string;
  url: string;
  contentHash: string;
  fetchedAt: Date;
}

/**
 * Reduce a site's snapshots to the most recent one per `pathRef`.
 *
 * Snapshots are stored one row per (siteId, pathRef) — but to be order-safe
 * regardless of the query's sort, we keep the row with the newest `fetchedAt`
 * for each path.
 */
export function latestSnapshotPerPath<T extends RefreshableSnapshot>(snapshots: T[]): T[] {
  const byPath = new Map<string, T>();
  for (const snapshot of snapshots) {
    const existing = byPath.get(snapshot.pathRef);
    if (!existing || snapshot.fetchedAt.getTime() > existing.fetchedAt.getTime()) {
      byPath.set(snapshot.pathRef, snapshot);
    }
  }
  return [...byPath.values()];
}

/** True when a re-fetch produced different content from what we stored. */
export function didDrift(previousHash: string, nextHash: string): boolean {
  return previousHash !== nextHash;
}

/**
 * Whole-days elapsed since the most recent snapshot fetch, or null when a
 * site has no snapshots. Used by the cockpit to flag staleness.
 */
export function snapshotStaleDays(lastFetchedAt: Date | null, now: number = Date.now()): number | null {
  if (!lastFetchedAt) return null;
  const ms = now - lastFetchedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

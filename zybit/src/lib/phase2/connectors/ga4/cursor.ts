/**
 * Pure cursor helpers for the GA4 connector. The cursor tracks the last
 * (synthetic timestamp, grain key) pair processed so subsequent syncs resume
 * strictly after it. GA4 rows are aggregate-grain at minute granularity, so
 * many rows can share a timestamp — the grain key breaks ties deterministically.
 *
 * No I/O, no clocks. The job layer owns persistence.
 */

import { ga4GrainKey } from './mapping';
import type { GA4Cursor, GA4EventRow } from './types';

export function emptyCursor(): GA4Cursor {
  return { afterTimestamp: '' };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readCursor(value: Record<string, unknown> | null | undefined): {
  afterTimestamp: string;
  lastKey: string;
} {
  if (!value) return { afterTimestamp: '', lastKey: '' };
  return {
    afterTimestamp: asString(value.afterTimestamp),
    lastKey: asString(value.lastKey),
  };
}

export function writeCursor(cursor: { afterTimestamp: string; lastKey: string }): Record<
  string,
  unknown
> {
  return { afterTimestamp: cursor.afterTimestamp, lastKey: cursor.lastKey };
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Largest (timestamp, key) pair across `rows` and the incoming cursor. */
export function advanceCursor(
  current: { afterTimestamp: string; lastKey: string },
  rows: GA4EventRow[],
): { afterTimestamp: string; lastKey: string } {
  let maxTs = current.afterTimestamp;
  let maxKey = current.lastKey;
  for (const row of rows) {
    const key = ga4GrainKey(row);
    const c = cmp(row.timestamp, maxTs);
    if (c > 0 || (c === 0 && cmp(key, maxKey) > 0)) {
      maxTs = row.timestamp;
      maxKey = key;
    }
  }
  return { afterTimestamp: maxTs, lastKey: maxKey };
}

/** Drop rows at or before the cursor; ties on timestamp broken by grain key. */
export function filterAfterCursor(
  rows: GA4EventRow[],
  cursor: { afterTimestamp: string; lastKey: string },
): GA4EventRow[] {
  if (cursor.afterTimestamp.length === 0) return rows;
  return rows.filter((row) => {
    const c = cmp(row.timestamp, cursor.afterTimestamp);
    if (c > 0) return true;
    if (c < 0) return false;
    return cmp(ga4GrainKey(row), cursor.lastKey) > 0;
  });
}

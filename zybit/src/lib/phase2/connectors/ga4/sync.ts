/**
 * GA4 sync adapter. Composes the Data API client, cursor helpers, and
 * mapping into one orderly run. Same contract as the PostHog adapter:
 * returns canonical events + the cursor to persist; never touches storage.
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';
import type { ConnectorContext, ValidateReport } from '../types';
import { fetchGA4EventsPage, getAccessToken, isoToGa4StartDate } from './client';
import { advanceCursor, filterAfterCursor, readCursor, writeCursor } from './cursor';
import { GA4ConnectorError } from './errors';
import { mapGA4Events } from './mapping';
import type { GA4ConnectorConfig, GA4EventRow } from './types';

export interface RunSyncResult {
  events: CanonicalEventInput[];
  cursor: Record<string, unknown> | null;
  hasMore: boolean;
  pages: number;
}

const PAGE_SIZE = 10_000;
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

function resolvePropertyId(ctx: ConnectorContext): string {
  const config = ctx.integration.config as Partial<GA4ConnectorConfig>;
  const propertyId = typeof config.propertyId === 'string' ? config.propertyId.trim() : '';
  if (propertyId.length === 0) {
    throw new GA4ConnectorError('GA4_CONFIG', 'Integration is missing GA4 propertyId.');
  }
  return propertyId;
}

function applyUntilFilter(rows: GA4EventRow[], until: string | null): GA4EventRow[] {
  if (until === null) return rows;
  const untilMs = Date.parse(until);
  if (!Number.isFinite(untilMs)) return rows;
  return rows.filter((r) => {
    const ts = Date.parse(r.timestamp);
    return !Number.isFinite(ts) || ts < untilMs;
  });
}

export async function runGA4Sync(
  ctx: ConnectorContext,
  signal?: AbortSignal,
): Promise<RunSyncResult> {
  const propertyId = resolvePropertyId(ctx);

  const persisted = readCursor(ctx.integration.cursor);
  const sinceOverride = ctx.since;
  const effectiveAfterIso =
    sinceOverride ??
    (persisted.afterTimestamp.length > 0 ? persisted.afterTimestamp : null) ??
    new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();

  const cursorForFilter =
    sinceOverride !== null
      ? { afterTimestamp: sinceOverride, lastKey: '' }
      : persisted;

  const cap = Math.max(0, Math.floor(ctx.maxEvents));
  const startDate = isoToGa4StartDate(effectiveAfterIso);
  const accessToken = await getAccessToken(ctx.secret);

  const accumulated: CanonicalEventInput[] = [];
  let cursor = persisted;
  let pages = 0;
  let offset = 0;
  let hasMore = false;

  while (accumulated.length < cap) {
    if (signal?.aborted) {
      hasMore = true;
      break;
    }

    const { rows, rowCount } = await fetchGA4EventsPage(
      propertyId,
      startDate,
      accessToken,
      offset,
      PAGE_SIZE,
      signal,
    );
    pages += 1;

    const filtered = applyUntilFilter(
      filterAfterCursor(rows, cursorForFilter),
      ctx.until,
    );
    cursor = advanceCursor(cursor, filtered);

    const { events } = mapGA4Events(filtered, { siteId: ctx.integration.siteId });
    accumulated.push(...events.slice(0, cap - accumulated.length));

    offset += rows.length;
    const exhausted = rows.length === 0 || offset >= rowCount;
    if (exhausted) {
      hasMore = false;
      break;
    }
    if (accumulated.length >= cap) {
      hasMore = true;
      break;
    }
  }

  return {
    events: accumulated,
    cursor: writeCursor(cursor),
    hasMore,
    pages,
  };
}

/**
 * Dry-run check: fetch one small page and report whether the service
 * account, property, and scopes look correct. Non-throwing for recoverable
 * errors; surfaces them as warnings. Throws GA4_CONFIG only when config is
 * fundamentally missing.
 */
export async function validateGA4Connection(ctx: ConnectorContext): Promise<ValidateReport> {
  const propertyId = resolvePropertyId(ctx);
  try {
    const accessToken = await getAccessToken(ctx.secret);
    const startDate = isoToGa4StartDate(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    );
    const { rows } = await fetchGA4EventsPage(propertyId, startDate, accessToken, 0, 100);
    const { events } = mapGA4Events(rows, { siteId: ctx.integration.siteId });
    const types = Array.from(new Set(events.map((e) => e.type))).sort();
    return {
      ok: true,
      sampleEvents: rows.length,
      recentEventTypes: types,
      warnings: [],
    };
  } catch (err) {
    if (err instanceof GA4ConnectorError) {
      if (err.code === 'GA4_CONFIG') throw err;
      return {
        ok: false,
        sampleEvents: null,
        recentEventTypes: [],
        warnings: [{ code: err.code, message: err.message }],
      };
    }
    return {
      ok: false,
      sampleEvents: null,
      recentEventTypes: [],
      warnings: [
        { code: 'GA4_HTTP', message: err instanceof Error ? err.message : 'Unknown GA4 error.' },
      ],
    };
  }
}

export type { GA4ConnectorConfig, GA4Cursor } from './types';

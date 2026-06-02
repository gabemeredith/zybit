/**
 * GA4 → CanonicalEvent mapping.
 *
 * GA4 `runReport` is aggregated: each row is a unique
 * (date, hour, minute, pagePath, eventName) grain carrying eventCount +
 * sessions. We map each row to ONE canonical event:
 *   - `type`           ← canonical type from GA4_EVENT_MAP
 *   - `metrics`        ← { eventCount, sessions }
 *   - `sessionId`      ← `ga4:<grain>` — an AGGREGATE-GRAIN key, not a real
 *                        user session. GA4 exposes no per-session id without
 *                        a BigQuery export, so GA4 is an Identify/Propose
 *                        source only, NOT joinable to proxy assignments.
 *   - `sourceEventId`  ← the grain key, making re-syncs idempotent via the
 *                        (siteId, source, sourceEventId) dedupe key.
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';
import type { GA4EventRow } from './types';

const GA4_EVENT_MAP: Record<string, string> = {
  page_view: 'page_view',
  session_start: 'session_start',
  purchase: 'checkout_complete',
  add_to_cart: 'add_to_cart',
  begin_checkout: 'checkout_start',
  form_submit: 'form_submit',
  search: 'search',
  scroll: 'scroll',
  click: 'click',
};

export interface MapOptions {
  siteId: string;
}

export type GA4SkipReason = 'UNKNOWN_EVENT_TYPE' | 'INVALID_TIMESTAMP';

/** Deterministic aggregate-grain key for a GA4 row (also the dedupe id). */
export function ga4GrainKey(row: GA4EventRow): string {
  const d = row.dimensions;
  return [
    d.date ?? '',
    d.hour ?? '',
    d.minute ?? '',
    encodeURIComponent(row.pagePath ?? '/'),
    encodeURIComponent(row.eventName),
  ].join('|');
}

function toInt(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function mapGA4Event(
  row: GA4EventRow,
  options: MapOptions,
): { event: CanonicalEventInput | null; skippedReason?: GA4SkipReason } {
  const type = GA4_EVENT_MAP[row.eventName];
  if (!type) return { event: null, skippedReason: 'UNKNOWN_EVENT_TYPE' };

  const ts = Date.parse(row.timestamp);
  if (!Number.isFinite(ts)) return { event: null, skippedReason: 'INVALID_TIMESTAMP' };

  const grain = ga4GrainKey(row);

  return {
    event: {
      siteId: options.siteId,
      type,
      sessionId: `ga4:${grain}`,
      path: row.pagePath ?? '/',
      occurredAt: row.timestamp,
      source: 'ga4',
      sourceEventId: grain,
      metrics: {
        eventCount: toInt(row.dimensions.eventCount),
        sessions: toInt(row.dimensions.sessions),
      },
      properties: { originalEventName: row.eventName },
    },
  };
}

export function mapGA4Events(
  rows: GA4EventRow[],
  options: MapOptions,
): { events: CanonicalEventInput[]; skipped: Array<{ index: number; reason: GA4SkipReason }> } {
  const events: CanonicalEventInput[] = [];
  const skipped: Array<{ index: number; reason: GA4SkipReason }> = [];
  rows.forEach((row, index) => {
    const result = mapGA4Event(row, options);
    if (result.event) {
      events.push(result.event);
    } else if (result.skippedReason !== undefined) {
      skipped.push({ index, reason: result.skippedReason });
    }
  });
  return { events, skipped };
}

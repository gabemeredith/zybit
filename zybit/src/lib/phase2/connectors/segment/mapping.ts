/**
 * Segment → Zybit canonical-event mapping for webhook ingestion (HTTP Sources,
 * Forwarding Destination). Scalar properties only (max 25 keys).
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function pickSessionId(msg: Record<string, unknown>): string {
  const ctxRecord = asRecord(msg.context);
  const nested =
    typeof ctxRecord?.sessionId === 'string'
      ? ctxRecord.sessionId
      : typeof ctxRecord?.session_id === 'string'
        ? ctxRecord.session_id
        : null;
  if (nested?.trim()) return nested.trim().slice(0, 200);
  const aid = typeof msg.anonymousId === 'string' ? msg.anonymousId : '';
  const uid = typeof msg.userId === 'string' ? msg.userId : '';
  const mid = typeof msg.messageId === 'string' ? msg.messageId : '';
  const base = aid || uid || mid;
  return base.length > 0 ? `segment_${base.slice(0, 180)}`.slice(0, 200) : 'segment_unknown';
}

function pathFromMessage(msg: Record<string, unknown>): string {
  const props = asRecord(msg.properties);
  if (props) {
    const direct = props.path ?? props.pathname;
    if (typeof direct === 'string' && direct.length > 0) {
      return direct.startsWith('/') ? direct.slice(0, 500) : `/${direct.slice(0, 499)}`;
    }
  }
  const pageMeta = asRecord(asRecord(msg.context)?.page as unknown);
  if (typeof pageMeta?.path === 'string' && pageMeta.path.length > 0) {
    return pageMeta.path.startsWith('/') ? pageMeta.path.slice(0, 500) : `/${pageMeta.path.slice(0, 499)}`;
  }
  if (typeof pageMeta?.url === 'string' && pageMeta.url.length > 0) {
    try {
      const u = new URL(pageMeta.url);
      return u.pathname.startsWith('/') ? u.pathname.slice(0, 500) : '/';
    } catch {
      return '/';
    }
  }
  return '/';
}

function isoOccurredAt(msg: Record<string, unknown>): string {
  const raw = msg.timestamp ?? msg.originalTimestamp ?? msg.sentAt ?? msg.receivedAt;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 2e13 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function flattenProps(props: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [key, val] of Object.entries(props)) {
    if (n >= 25) break;
    if (val === null || typeof val === 'boolean') {
      out[key] = val;
      n += 1;
      continue;
    }
    if (typeof val === 'string') {
      out[key] = val.slice(0, 600);
      n += 1;
      continue;
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      out[key] = val;
      n += 1;
    }
  }
  return out;
}

interface MapSegmentArgs {
  siteId: string;
}

/** One Segment Protocol message → CanonicalEventInput, or null when intentionally skipped (identify, group, alias). */
export function mapSegmentMessageToCanonical(raw: unknown, args: MapSegmentArgs): CanonicalEventInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const msg = raw as Record<string, unknown>;

  const mt = typeof msg.type === 'string' ? msg.type.toLowerCase() : '';
  if (mt === 'identify' || mt === 'group' || mt === 'alias') return null;

  /** Only ingest message types Zybit maps today; silently skip the rest so unknown SDK shapes don't pollute canonical events. */
  if (mt !== 'page' && mt !== 'track' && mt !== 'screen') {
    return null;
  }

  const sessionId = pickSessionId(msg);
  const occurredAt = isoOccurredAt(msg);

  let type = 'page_view';
  const path = pathFromMessage(msg);

  if (mt === 'track') {
    const ev = typeof msg.event === 'string' ? msg.event : '';
    type = ev.length > 0 ? slugify(ev) : 'track';
  } else if (mt === 'screen') {
    const name = typeof msg.name === 'string' ? msg.name : '';
    type = name.length > 0 ? `screen_${slugify(name).slice(0, 96)}` : 'screen';
  }

  const props = flattenProps(asRecord(msg.properties) ?? {});
  props.segment_type = mt.slice(0, 48);
  const trackLbl =
    typeof msg.event === 'string' ? msg.event.slice(0, 160) : mt === 'page' ? 'page_load' : null;
  if (trackLbl) props.segment_track_name = trackLbl;

  const anon =
    typeof msg.anonymousId === 'string'
      ? msg.anonymousId
      : typeof msg.userId === 'string'
        ? msg.userId
        : undefined;

  const messageId =
    typeof msg.messageId === 'string' && msg.messageId.length > 0
      ? msg.messageId.slice(0, 200)
      : `${occurredAt}-${sessionId}-${type}`.slice(0, 200);

  const out: CanonicalEventInput = {
    siteId: args.siteId,
    sessionId,
    type,
    path,
    occurredAt,
    source: 'segment',
    sourceEventId: messageId,
    ...(anon ? { anonymousId: anon.slice(0, 200) } : {}),
    ...(Object.keys(props).length > 0 ? { properties: props } : {}),
  };

  return out;
}

function slugify(ev: string): string {
  return ev
    .trim()
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .slice(0, 120) || 'track';
}

export function unwrapSegmentPayload(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) return body;
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.batch)) return o.batch;
  return [body];
}

/** Segment caps batches well under this; reject larger payloads as malformed/abusive. */
export const MAX_SEGMENT_BATCH_SIZE = 1000;

export type SegmentBatchGuard =
  | { ok: true; items: unknown[] }
  | { ok: false; code: 'SEGMENT_PAYLOAD_INVALID' | 'SEGMENT_BATCH_TOO_LARGE'; message: string };

/**
 * Schema guard (Zybit-137) — validate the webhook envelope before mapping.
 * Rejects non-object/non-array bodies and oversized batches up front so a
 * malformed or abusive payload can't reach the mapper or the DB. Individual
 * message-shape validation stays in `mapSegmentMessageToCanonical` (unknown
 * shapes map to null and are skipped).
 */
export function guardSegmentBatch(body: unknown): SegmentBatchGuard {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'SEGMENT_PAYLOAD_INVALID', message: 'Webhook body must be a JSON object or array.' };
  }
  const items = unwrapSegmentPayload(body);
  if (items.length > MAX_SEGMENT_BATCH_SIZE) {
    return {
      ok: false,
      code: 'SEGMENT_BATCH_TOO_LARGE',
      message: `Batch exceeds ${MAX_SEGMENT_BATCH_SIZE} messages.`,
    };
  }
  return { ok: true, items };
}

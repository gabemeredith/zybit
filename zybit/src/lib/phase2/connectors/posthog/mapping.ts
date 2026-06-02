/**
 * PostHog → Zybit canonical event mapping.
 *
 * Pure, deterministic transformation: same input → same output. No I/O,
 * no clocks, no env reads. Designed to run inside connector adapters and
 * inside ad-hoc backfill scripts with identical results.
 *
 * PII guardrails: this mapper never copies `$ip`, `$user_agent`, `email`,
 * `name`, `phone`, raw cookies, or other unknown property blobs. Only the
 * explicitly named subset below is forwarded onto the canonical event.
 *
 * Conversion proxy: if a PostHog event carries `$revenue` (any finite
 * number, even 0) we set `metrics.conversion = 1`. Phase 2 rollups treat
 * any revenue-tagged event as a conversion signal; if a downstream config
 * needs stricter rules it should match by event type instead.
 */

import { createHash } from "node:crypto";

import type { CanonicalEventInput } from "@/lib/phase2/types";

import {
  parseElementsChain,
  type ParsedElementsChain,
  type ParsedElementsChainNode,
} from "./elementsChain";
import type { PostHogEventDTO } from "./types";

export interface MapResult {
  event: CanonicalEventInput | null;
  /** Reason the event was skipped, when event is null. Stable codes: "MISSING_TIMESTAMP", "MISSING_EVENT_NAME", "INVALID_TIMESTAMP", "INVALID_PATH". */
  skippedReason?: "MISSING_TIMESTAMP" | "MISSING_EVENT_NAME" | "INVALID_TIMESTAMP" | "INVALID_PATH";
}

export interface MapOptions {
  /** Zybit site id assigned to events that come from this integration. */
  siteId: string;
}

type SkipReason = NonNullable<MapResult["skippedReason"]>;

// `zybit_vid` is the Zybit proxy visitor ID, registered as a PostHog
// super-property by the bridge script. Preferring it makes conversion
// events key off the same stable ID as proxy assignment events, so the
// outcome-computation join matches across providers. Falls back to
// PostHog's own session keys when the bridge is not present.
const SESSION_PROPERTY_KEYS = ["zybit_vid", "$session_id", "$window_id", "session_id"] as const;

const PROPERTY_PASSTHROUGH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

const PROPERTY_RENAME_MAP: ReadonlyArray<{ from: string; to: string }> = [
  { from: "$browser", to: "browser" },
  { from: "$device_type", to: "device_type" },
  { from: "$referrer", to: "referrer" },
  { from: "$host", to: "host" },
];

const MAX_ELEMENT_CLASSES = 5;
const MAX_FEATURE_FLAG_PROPS = 10;
const RAGE_TARGET_REF_LENGTH = 16;
const ACTIVE_SECONDS_CAP = 86400;

/**
 * Map a single PostHog event to a CanonicalEventInput.
 *
 * Returns `{ event: null, skippedReason }` when the event cannot be
 * canonicalized but the input shape is otherwise structurally sound.
 * Throws `TypeError` when `dto` or `options` is not an object — the
 * adapter is expected to feed us valid PostHog DTOs.
 */
export function mapPostHogEvent(dto: PostHogEventDTO, options: MapOptions): MapResult {
  assertOptions(options);
  assertDto(dto);

  if (typeof dto.event !== "string" || dto.event.trim().length === 0) {
    return { event: null, skippedReason: "MISSING_EVENT_NAME" };
  }
  const rawEventName = dto.event.trim();
  const type = canonicalizeEventName(rawEventName);

  if (dto.timestamp === undefined || dto.timestamp === null || dto.timestamp === "") {
    return { event: null, skippedReason: "MISSING_TIMESTAMP" };
  }
  if (typeof dto.timestamp !== "string") {
    return { event: null, skippedReason: "INVALID_TIMESTAMP" };
  }
  const parsedTs = Date.parse(dto.timestamp);
  if (Number.isNaN(parsedTs)) {
    return { event: null, skippedReason: "INVALID_TIMESTAMP" };
  }
  const occurredAt = new Date(parsedTs).toISOString();

  const properties = isRecord(dto.properties) ? dto.properties : {};

  const pathResult = derivePath(properties);
  if (pathResult.kind === "invalid") {
    return { event: null, skippedReason: "INVALID_PATH" };
  }

  const distinctId = dto.distinct_id ?? dto.person?.distinct_id;
  const sessionId = deriveSessionId(properties, distinctId);
  const anonymousId = deriveAnonymousId(distinctId);
  const sourceEventId = deriveSourceEventId(dto);
  const metrics = deriveMetrics(properties, type);
  const mappedProperties = deriveProperties(properties, rawEventName);

  const event: CanonicalEventInput = {
    siteId: options.siteId,
    sessionId,
    type,
    path: pathResult.value,
    occurredAt,
    source: "posthog",
  };

  if (anonymousId !== undefined) {
    event.anonymousId = anonymousId;
  }
  if (sourceEventId !== undefined) {
    event.sourceEventId = sourceEventId;
  }
  if (metrics !== undefined) {
    event.metrics = metrics;
  }
  if (mappedProperties !== undefined) {
    event.properties = mappedProperties;
  }

  return { event };
}

/**
 * Map many PostHog events. Preserves input order for emitted events and
 * for skip diagnostics; skip diagnostics carry the original index so the
 * caller can correlate against the input array.
 */
export function mapPostHogEvents(
  dtos: PostHogEventDTO[],
  options: MapOptions,
): { events: CanonicalEventInput[]; skipped: Array<{ index: number; reason: SkipReason }> } {
  if (!Array.isArray(dtos)) {
    throw new TypeError("dtos must be an array.");
  }
  assertOptions(options);

  const events: CanonicalEventInput[] = [];
  const skipped: Array<{ index: number; reason: SkipReason }> = [];

  for (let index = 0; index < dtos.length; index++) {
    const result = mapPostHogEvent(dtos[index], options);
    if (result.event === null) {
      if (result.skippedReason !== undefined) {
        skipped.push({ index, reason: result.skippedReason });
      }
      continue;
    }
    events.push(result.event);
  }

  return { events, skipped };
}

/**
 * Known PostHog event names get a stable Zybit type. Unknown `$`-prefixed
 * names lose the leading `$` for canonical readability; bare event names
 * pass through untouched so custom product events keep their identity.
 */
function canonicalizeEventName(raw: string): string {
  switch (raw) {
    case "$pageview":
      return "page_view";
    case "$pageleave":
      return "page_leave";
    case "$autocapture":
      return "cta_click";
    case "$rageclick":
      return "rage_click";
    case "$exception":
      return "error";
    default:
      return raw.startsWith("$") ? raw.slice(1) : raw;
  }
}

function deriveSessionId(properties: Record<string, unknown>, distinctId: unknown): string {
  for (const key of SESSION_PROPERTY_KEYS) {
    const candidate = properties[key];
    const trimmed = trimToString(candidate);
    if (trimmed !== null) {
      return trimmed;
    }
  }
  const fromDistinct = trimToString(distinctId);
  if (fromDistinct !== null) {
    return fromDistinct;
  }
  return "unknown_session";
}

function deriveAnonymousId(distinctId: unknown): string | undefined {
  const trimmed = trimToString(distinctId);
  return trimmed === null ? undefined : trimmed;
}

function deriveSourceEventId(dto: PostHogEventDTO): string | undefined {
  const fromUuid = trimToString(dto.uuid);
  if (fromUuid !== null) {
    return fromUuid;
  }
  const fromId = trimToString(dto.id);
  if (fromId !== null) {
    return fromId;
  }
  return undefined;
}

type PathDerivation = { kind: "ok"; value: string } | { kind: "invalid" };

function derivePath(properties: Record<string, unknown>): PathDerivation {
  const pathname = properties["$pathname"];
  if (typeof pathname === "string") {
    const cleaned = pathname.trimEnd();
    if (cleaned.length > 0) {
      return { kind: "ok", value: ensureLeadingSlash(cleaned) };
    }
  }

  const currentUrl = properties["$current_url"];
  if (typeof currentUrl === "string" && currentUrl.length > 0) {
    try {
      const parsed = new URL(currentUrl);
      const pathFromUrl = parsed.pathname.trimEnd();
      return { kind: "ok", value: ensureLeadingSlash(pathFromUrl.length === 0 ? "/" : pathFromUrl) };
    } catch {
      const trimmed = currentUrl.trimEnd();
      if (trimmed.startsWith("/")) {
        return { kind: "ok", value: trimmed };
      }
      return { kind: "invalid" };
    }
  }

  return { kind: "ok", value: "/" };
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function deriveMetrics(
  properties: Record<string, unknown>,
  type: string,
): Record<string, number> | undefined {
  const metrics: Record<string, number> = {};

  const duration = properties["$duration"];
  if (isFiniteNumber(duration)) {
    metrics.dwellMs = duration * 1000;
  } else {
    const dwell = properties["dwell_ms"];
    if (isFiniteNumber(dwell)) {
      metrics.dwellMs = dwell;
    }
  }

  const scroll = properties["$scroll_percentage"];
  if (isFiniteNumber(scroll)) {
    const clamped = clamp(scroll, 0, 100);
    metrics.scrollPct = clamped;
    metrics.scrollPctNormalized = clamped / 100;
  }

  const activeSeconds = properties["$active_seconds"];
  if (isFiniteNumber(activeSeconds)) {
    metrics.activeSeconds = activeSeconds;
  }

  const intent = properties["intent"];
  if (isFiniteNumber(intent)) {
    metrics.intent = clamp(intent, 0, 1);
  }

  if (type === "rage_click") {
    metrics.rage = 1;
  } else {
    const rageCount = properties["$rage_click_count"];
    if (isFiniteNumber(rageCount)) {
      metrics.rage = rageCount;
    }
  }

  const revenue = properties["$revenue"];
  if (isFiniteNumber(revenue)) {
    metrics.conversion = 1;
  }

  if (Object.keys(metrics).length === 0) {
    return undefined;
  }
  return sortRecord(metrics);
}

function deriveProperties(
  properties: Record<string, unknown>,
  rawEventName: string,
): Record<string, string | number | boolean | null> | undefined {
  const out: Record<string, string | number | boolean | null> = {};

  for (const key of PROPERTY_PASSTHROUGH_KEYS) {
    const value = properties[key];
    if (isCanonicalPropertyValue(value)) {
      out[key] = value;
    }
  }

  for (const { from, to } of PROPERTY_RENAME_MAP) {
    const value = properties[from];
    if (isCanonicalPropertyValue(value)) {
      out[to] = value;
    }
  }

  if (rawEventName === "$autocapture") {
    const ctaText = properties["$el_text"];
    if (typeof ctaText === "string") {
      out.cta_text = ctaText;
    }
    const ctaId = properties["$el_attr__data-attr"];
    if (typeof ctaId === "string") {
      out.cta_id = ctaId;
    }
    const ctaTag = properties["tag_name"];
    if (typeof ctaTag === "string") {
      out.cta_tag = ctaTag;
    }
  }

  const parsedChain = readElementsChain(properties);
  if (parsedChain !== null) {
    applyElementsChainProperties(out, parsedChain);
  }

  const activeSeconds = properties["$active_seconds"];
  if (isFiniteNumber(activeSeconds)) {
    out.dwell_seconds = clamp(activeSeconds, 0, ACTIVE_SECONDS_CAP);
  }

  const recordingId = trimToString(properties["$session_recording_id"]);
  if (recordingId !== null) {
    out.recording_id = recordingId;
  }

  applyFeatureFlagProperties(out, properties);

  if (rawEventName === "$rageclick" && parsedChain?.leaf) {
    applyRageClickProperties(out, properties, parsedChain.leaf);
  }

  if (rawEventName === "$exception") {
    applyExceptionProperties(out, properties);
  }

  if (Object.keys(out).length === 0) {
    return undefined;
  }
  return sortRecord(out);
}

/**
 * Capture PostHog `$exception` payloads as structured `error_*` properties.
 * Stack traces and `$exception_personURL` are intentionally dropped — they
 * tend to carry user/session ids and aren't needed for the audit-rule
 * grouping (which keys on type + message + path).
 */
function applyExceptionProperties(
  out: Record<string, string | number | boolean | null>,
  properties: Record<string, unknown>,
): void {
  const errorType = trimToString(properties["$exception_type"]);
  if (errorType !== null) {
    out.error_type = errorType.slice(0, 200);
  }
  const errorMessage = trimToString(properties["$exception_message"]);
  if (errorMessage !== null) {
    out.error_message = errorMessage.slice(0, 500);
  }
  const errorSource = trimToString(properties["$exception_source"]);
  if (errorSource !== null) {
    out.error_source = errorSource.slice(0, 200);
  }
  const errorLine = properties["$exception_lineno"];
  if (isFiniteNumber(errorLine)) {
    out.error_line = Math.max(0, Math.floor(errorLine));
  }
  const errorCol = properties["$exception_colno"];
  if (isFiniteNumber(errorCol)) {
    out.error_column = Math.max(0, Math.floor(errorCol));
  }
  const handled = properties["$exception_handled"];
  if (typeof handled === "boolean") {
    out.error_handled = handled;
  }
}

function readElementsChain(
  properties: Record<string, unknown>,
): ParsedElementsChain | null {
  const primary = properties["$elements_chain"];
  if (typeof primary === "string" && primary.length > 0) {
    return parseElementsChain(primary);
  }
  const fallback = properties["$elements_chain_chain"];
  if (typeof fallback === "string" && fallback.length > 0) {
    return parseElementsChain(fallback);
  }
  return null;
}

function applyElementsChainProperties(
  out: Record<string, string | number | boolean | null>,
  parsed: ParsedElementsChain,
): void {
  out.element_depth = parsed.depth;
  out.element_role = parsed.nearestLandmark ?? null;
  out.element_landmark_distance = parsed.nearestLandmarkDepth;
  out.element_tag = parsed.leaf?.tag ?? null;
  out.element_classes = parsed.leaf
    ? parsed.leaf.classes.slice(0, MAX_ELEMENT_CLASSES).join(" ")
    : null;
}

function applyFeatureFlagProperties(
  out: Record<string, string | number | boolean | null>,
  properties: Record<string, unknown>,
): void {
  const singleFlag = properties["$feature_flag"];
  const singleResponse = properties["$feature_flag_response"];
  if (typeof singleFlag === "string" && typeof singleResponse === "string") {
    out[`flag_${singleFlag}`] = singleResponse;
  }

  const flagsBag = properties["$feature_flags"];
  if (isRecord(flagsBag)) {
    let written = 0;
    for (const key of Object.keys(flagsBag)) {
      if (written >= MAX_FEATURE_FLAG_PROPS) {
        break;
      }
      const value = flagsBag[key];
      if (typeof value === "string" || typeof value === "boolean") {
        out[`flag_${key}`] = value;
        written++;
        continue;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        out[`flag_${key}`] = value;
        written++;
      }
    }
  }
}

function applyRageClickProperties(
  out: Record<string, string | number | boolean | null>,
  properties: Record<string, unknown>,
  leaf: ParsedElementsChainNode,
): void {
  const elText = properties["$el_text"];
  let rageText: string;
  if (typeof elText === "string") {
    rageText = elText;
  } else if (leaf.classes[0] !== undefined) {
    rageText = leaf.classes[0];
  } else if (typeof leaf.attrs["aria-label"] === "string") {
    rageText = leaf.attrs["aria-label"];
  } else {
    rageText = leaf.tag;
  }
  out.rage_target_text = rageText;
  out.rage_target_ref = deriveRageTargetRef(leaf);
}

function deriveRageTargetRef(leaf: ParsedElementsChainNode): string {
  const dataCta = leaf.attrs["data-cta"] ?? "";
  const ariaLabel = leaf.attrs["aria-label"] ?? "";
  const material = `${leaf.tag}|${leaf.classes.join(".")}|${dataCta}|${ariaLabel}`;
  return createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, RAGE_TARGET_REF_LENGTH);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCanonicalPropertyValue(value: unknown): value is string | number | boolean | null {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimToString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const out: Record<string, T> = {};
  for (const key of keys) {
    out[key] = record[key];
  }
  return out;
}

function assertOptions(options: MapOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("options must be an object.");
  }
  if (typeof options.siteId !== "string" || options.siteId.trim().length === 0) {
    throw new TypeError("options.siteId must be a non-empty string.");
  }
}

function assertDto(dto: PostHogEventDTO): void {
  if (typeof dto !== "object" || dto === null) {
    throw new TypeError("dto must be an object.");
  }
}

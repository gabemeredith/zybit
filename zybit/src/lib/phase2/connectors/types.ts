/**
 * Generic connector contracts. Each Phase 2 provider (PostHog, Segment, Shopify,
 * GA4, ...) implements these against its own API. Implementations stay pure
 * about transformation; the adapter is the only place network I/O lives.
 */

import type { CanonicalEventInput, ISODateString } from "../types";

export type ConnectorProvider = "posthog" | "segment" | "shopify" | "ga4" | "custom";

/**
 * Connector lifecycle status. `degraded` and `disconnected` are written by the
 * circuit breaker (`observability/errorBudget.ts`): an integration degrades
 * after 3 consecutive sync failures and disconnects after 5 — at which point
 * the sync crons skip it until a PM hits the resume route (Zybit-154).
 */
export type IntegrationStatus =
  | "pending"
  | "active"
  | "error"
  | "disabled"
  | "degraded"
  | "disconnected";

/**
 * A persisted integration row. Secrets are NEVER stored here; only the env-var
 * name (`secretRef`) at which the secret can be resolved server-side.
 */
export interface IntegrationRecord {
  id: string;
  organizationId: string;
  siteId: string;
  provider: ConnectorProvider;
  status: IntegrationStatus;
  /** Provider-specific config (e.g. host, projectId for PostHog). Public values only. */
  config: Record<string, unknown>;
  /** Env-var key name where the API key/token is stored. */
  secretRef: string | null;
  /** Pagination cursor opaque to the route layer; provider decides shape. */
  cursor: Record<string, unknown> | null;
  lastSyncedAt: ISODateString | null;
  lastErrorCode: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CreateIntegrationInput {
  id: string;
  organizationId: string;
  siteId: string;
  provider: ConnectorProvider;
  config: Record<string, unknown>;
  secretRef: string | null;
  createdAt: ISODateString;
  /** Optional initial status; drivers default to "pending". */
  status?: IntegrationStatus;
}

export interface UpdateIntegrationStateInput {
  id: string;
  organizationId: string;
  status?: IntegrationStatus;
  cursor?: Record<string, unknown> | null;
  lastSyncedAt?: ISODateString | null;
  lastErrorCode?: string | null;
  updatedAt: ISODateString;
}

/**
 * Adapter input handed to a connector's pull/sync function.
 * Secret is resolved by the route layer before the adapter runs.
 */
export interface ConnectorContext {
  integration: IntegrationRecord;
  secret: string;
  /** Inclusive lower bound for events to fetch; falls back to integration.lastSyncedAt. */
  since: ISODateString | null;
  /** Exclusive upper bound for events to fetch; defaults to "now" at the adapter. */
  until: ISODateString | null;
  /** Soft cap on events fetched in a single sync run. */
  maxEvents: number;
}

export interface SyncBatch {
  events: CanonicalEventInput[];
  /** Updated cursor to persist after these events succeed; opaque shape. */
  nextCursor: Record<string, unknown> | null;
  /** True when the adapter has more pages available; false when caught up. */
  hasMore: boolean;
}

export interface SyncReport {
  fetched: number;
  inserted: number;
  deduped: number;
  /** Per-reason counts for events that failed mapping and were skipped. */
  skipped: Array<{ code: string; count: number }>;
  errors: Array<{ code: string; message: string }>;
  /** Final persisted cursor after sync. */
  cursor: Record<string, unknown> | null;
  /** Whether more events remain unfetched (caller may schedule a next run). */
  hasMore: boolean;
}

export interface ValidateReport {
  ok: boolean;
  /** Number of events seen in the last 24h sample; null when not testable. */
  sampleEvents: number | null;
  /** Recent canonicalized event types observed (deterministic order). */
  recentEventTypes: string[];
  warnings: Array<{ code: string; message: string }>;
}

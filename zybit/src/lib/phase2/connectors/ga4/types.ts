/**
 * GA4 connector — type definitions.
 *
 * Data source: Google Analytics Data API v1beta
 * Auth: Google service account (JSON key stored in GOOGLE_SA_KEY_<siteId> env var,
 *       or GOOGLE_SA_KEY for a single-site setup).
 *
 * Config shape stored in integrations.config:
 *   { propertyId: "properties/123456789" }
 *
 * TODO (Zybit-110): implement service-account auth via google-auth-library.
 * TODO (Zybit-111): map GA4 event names to CanonicalEvent types — see mapping.ts.
 */

export interface GA4ConnectorConfig {
  /** GA4 property ID, e.g. "properties/123456789" */
  propertyId: string;
}

export interface GA4Cursor {
  /** ISO timestamp of the last event synced; next sync starts from this point. */
  afterTimestamp: string;
}

/** Minimal shape of a GA4 event row from the runReport API. */
export interface GA4EventRow {
  eventName: string;
  sessionId: string;
  userId: string | null;
  timestamp: string; // ISO
  pagePath: string | null;
  /** Additional dimensions from the report request. */
  dimensions: Record<string, string>;
}

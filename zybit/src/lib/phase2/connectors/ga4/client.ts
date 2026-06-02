/**
 * GA4 Data API client. The ONLY place network I/O lives in the connector.
 *
 * Auth: Google service-account JWT (RS256), signed with the Web Crypto API
 * (zero extra deps, edge-safe), exchanged for a short-lived access token at
 * the Google OAuth2 token endpoint. Tokens are cached in-memory per service
 * account until shortly before expiry.
 *
 * Data: `runReport` is an AGGREGATED API — it returns counts grouped by the
 * requested dimensions, not an individual event stream. We request the finest
 * grain GA4 exposes without a BigQuery export (date + hour + minute +
 * pagePath + eventName) and treat each row as one aggregate canonical event
 * carrying `metrics: { eventCount, sessions }`. This is sufficient for the
 * Identify/Propose loop; it is NOT visitor-level and therefore not joinable
 * to proxy assignments (only PostHog/Segment are measurement-grade). See
 * mapping.ts and docs/ARCHITECTURE.md.
 *
 * Retry policy mirrors the PostHog client: 15s per-request timeout, up to 3
 * retries on 429/5xx/network with exponential backoff.
 */

import { GA4ConnectorError } from './errors';
import type { GA4EventRow } from './types';

const GA4_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const PER_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRY_BACKOFFS_MS: ReadonlyArray<number> = [200, 800, 2400];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface JwtClaims {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// base64url helpers (binary-safe, no Node Buffer dependency)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(str: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

// ---------------------------------------------------------------------------
// Service-account auth
// ---------------------------------------------------------------------------

function parseServiceAccount(json: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new GA4ConnectorError('GA4_CONFIG', 'Service-account key is not valid JSON.', {
      cause: err,
    });
  }
  const obj = parsed as Partial<ServiceAccountKey>;
  if (
    !obj ||
    typeof obj.client_email !== 'string' ||
    typeof obj.private_key !== 'string' ||
    obj.client_email.length === 0 ||
    obj.private_key.length === 0
  ) {
    throw new GA4ConnectorError(
      'GA4_CONFIG',
      'Service-account key is missing client_email or private_key.',
    );
  }
  return {
    client_email: obj.client_email,
    private_key: obj.private_key,
    token_uri: typeof obj.token_uri === 'string' ? obj.token_uri : DEFAULT_TOKEN_URI,
  };
}

function pemToPkcs8Bytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (body.length === 0) {
    throw new GA4ConnectorError('GA4_CONFIG', 'Service-account private_key is empty.');
  }
  return base64ToBytes(body);
}

async function signJwt(claims: JwtClaims, privateKeyPem: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(
    JSON.stringify(claims),
  )}`;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8Bytes(privateKeyPem) as unknown as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch (err) {
    throw new GA4ConnectorError('GA4_AUTH', 'Failed to import service-account private key.', {
      cause: err,
    });
  }

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}
const tokenCache = new Map<string, CachedToken>();

/**
 * Exchange a service-account key JSON for a short-lived OAuth2 access token.
 * Cached in-memory per service account until 60s before expiry.
 */
export async function getAccessToken(serviceAccountKeyJson: string): Promise<string> {
  const sa = parseServiceAccount(serviceAccountKeyJson);

  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.token;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const assertion = await signJwt(
    {
      iss: sa.client_email,
      scope: ANALYTICS_SCOPE,
      aud: tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    },
    sa.private_key,
  );

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  let res: Response;
  try {
    res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GA4ConnectorError('GA4_TIMEOUT', 'Network error contacting Google OAuth2.', {
      cause: err,
    });
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new GA4ConnectorError(
      res.status === 400 || res.status === 401 ? 'GA4_AUTH' : 'GA4_HTTP',
      `Google token endpoint returned status ${res.status}.`,
      { status: res.status },
    );
  }

  let json: { access_token?: unknown; expires_in?: unknown };
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new GA4ConnectorError('GA4_PARSE', 'Google token response was not JSON.', {
      cause: err,
    });
  }
  if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
    throw new GA4ConnectorError('GA4_AUTH', 'Google token response had no access_token.');
  }

  const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  tokenCache.set(sa.client_email, {
    token: json.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  });
  return json.access_token;
}

// ---------------------------------------------------------------------------
// runReport
// ---------------------------------------------------------------------------

interface RunReportRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}
interface RunReportResponse {
  rows?: RunReportRow[];
  rowCount?: number;
}

/** GA4 `date` is YYYYMMDD, `hour` is HH (00-23), `minute` is MM (00-59). */
function buildTimestamp(date: string, hour: string, minute: string): string | null {
  if (!/^\d{8}$/.test(date)) return null;
  const y = date.slice(0, 4);
  const m = date.slice(4, 6);
  const d = date.slice(6, 8);
  const hh = /^\d{1,2}$/.test(hour) ? hour.padStart(2, '0') : '00';
  const mm = /^\d{1,2}$/.test(minute) ? minute.padStart(2, '0') : '00';
  return `${y}-${m}-${d}T${hh}:${mm}:00.000Z`;
}

/** Cursor `afterTimestamp` (ISO) → GA4 `startDate` (YYYY-MM-DD). */
export function isoToGa4StartDate(iso: string): string {
  const ms = Date.parse(iso);
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  return d.toISOString().slice(0, 10);
}

async function performFetch(
  url: string,
  init: RequestInit,
  callerSignal: AbortSignal | undefined,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS);
  const composite =
    callerSignal !== undefined ? AbortSignal.any([timeoutSignal, callerSignal]) : timeoutSignal;
  try {
    return await fetch(url, { ...init, signal: composite });
  } catch (err) {
    if (callerSignal?.aborted) {
      throw new GA4ConnectorError('GA4_ABORT', 'Request aborted by caller.', { cause: err });
    }
    if (timeoutSignal.aborted) {
      throw new GA4ConnectorError('GA4_TIMEOUT', 'Request to GA4 timed out after 15s.', {
        cause: err,
      });
    }
    throw new GA4ConnectorError('GA4_TIMEOUT', 'Network error contacting GA4.', { cause: err });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Fetch one page of aggregated GA4 rows starting at `offset`. Caller composes
 * pagination by looping until `offset + rows.length >= rowCount`.
 */
export async function fetchGA4EventsPage(
  propertyId: string,
  startDate: string,
  accessToken: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ rows: GA4EventRow[]; rowCount: number }> {
  const property = propertyId.startsWith('properties/')
    ? propertyId
    : `properties/${propertyId}`;
  const url = `${GA4_API_BASE}/${property}:runReport`;

  const requestBody = {
    dimensions: [
      { name: 'date' },
      { name: 'hour' },
      { name: 'minute' },
      { name: 'pagePath' },
      { name: 'eventName' },
    ],
    metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
    dateRanges: [{ startDate, endDate: 'today' }],
    orderBys: [
      { dimension: { dimensionName: 'date' } },
      { dimension: { dimensionName: 'hour' } },
      { dimension: { dimensionName: 'minute' } },
    ],
    limit: String(limit),
    offset: String(offset),
    keepEmptyRows: false,
  };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    Accept: 'application/json',
  };

  let lastError: GA4ConnectorError | null = null;

  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (signal?.aborted) throw new GA4ConnectorError('GA4_ABORT', 'Request aborted by caller.');

    let attemptError: GA4ConnectorError | null = null;
    let waitOverrideMs: number | null = null;

    try {
      const response = await performFetch(
        url,
        { method: 'POST', headers, body: JSON.stringify(requestBody) },
        signal,
      );

      if (response.ok) {
        const text = await response.text();
        let json: RunReportResponse;
        try {
          json = JSON.parse(text);
        } catch (err) {
          throw new GA4ConnectorError('GA4_PARSE', 'GA4 response was not JSON.', { cause: err });
        }
        const rows: GA4EventRow[] = [];
        for (const r of json.rows ?? []) {
          const dv = r.dimensionValues ?? [];
          const mv = r.metricValues ?? [];
          const date = dv[0]?.value ?? '';
          const hour = dv[1]?.value ?? '00';
          const minute = dv[2]?.value ?? '00';
          const pagePath = dv[3]?.value ?? null;
          const eventName = dv[4]?.value ?? '';
          const ts = buildTimestamp(date, hour, minute);
          if (ts === null || eventName.length === 0) continue;
          rows.push({
            eventName,
            sessionId: '',
            userId: null,
            timestamp: ts,
            pagePath,
            dimensions: {
              date,
              hour,
              minute,
              eventCount: mv[0]?.value ?? '0',
              sessions: mv[1]?.value ?? '0',
            },
          });
        }
        return { rows, rowCount: Number(json.rowCount ?? rows.length) };
      }

      const status = response.status;
      await response.text().catch(() => undefined);

      if (status === 401 || status === 403) {
        throw new GA4ConnectorError('GA4_AUTH', `GA4 rejected the credentials (status ${status}).`, {
          status,
        });
      }
      if (status === 404) {
        throw new GA4ConnectorError('GA4_NOT_FOUND', 'GA4 property not found (status 404).', {
          status,
        });
      }
      if (status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const secs = retryAfter ? Number(retryAfter) : NaN;
        waitOverrideMs = Number.isFinite(secs)
          ? Math.min(secs * 1000, MAX_RETRY_AFTER_MS)
          : null;
        attemptError = new GA4ConnectorError('GA4_RATE_LIMIT', 'GA4 rate limit (status 429).', {
          status,
        });
      } else if (status >= 500 && status < 600) {
        attemptError = new GA4ConnectorError('GA4_HTTP', `GA4 returned status ${status}.`, {
          status,
        });
      } else {
        throw new GA4ConnectorError('GA4_HTTP', `GA4 returned status ${status}.`, {
          status,
          retryable: false,
        });
      }
    } catch (err) {
      if (err instanceof GA4ConnectorError) {
        if (!err.retryable) throw err;
        attemptError = err;
      } else {
        throw new GA4ConnectorError('GA4_HTTP', 'Unexpected error contacting GA4.', {
          cause: err,
        });
      }
    }

    if (attemptError === null) continue;
    lastError = attemptError;
    if (attempt >= RETRY_BACKOFFS_MS.length) throw attemptError;
    await sleep(waitOverrideMs ?? RETRY_BACKOFFS_MS[attempt]);
  }

  throw lastError ?? new GA4ConnectorError('GA4_HTTP', 'GA4 request exhausted retries.');
}

export type { JwtClaims };

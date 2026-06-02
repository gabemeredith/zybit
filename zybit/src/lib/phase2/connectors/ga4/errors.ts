/**
 * Structured error class for the GA4 connector. Mirrors the PostHog
 * connector's discriminated-code design so the sync job can branch on
 * intent (auth, rate-limit, parse, ...) without string matching.
 *
 * Error messages MUST NEVER include the service-account private key or
 * any other secret.
 */

export type GA4ErrorCode =
  | 'GA4_AUTH'
  | 'GA4_NOT_FOUND'
  | 'GA4_RATE_LIMIT'
  | 'GA4_HTTP'
  | 'GA4_TIMEOUT'
  | 'GA4_PARSE'
  | 'GA4_CONFIG'
  | 'GA4_ABORT'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN';

export interface GA4ConnectorErrorOptions {
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

const NON_RETRYABLE_DEFAULT: ReadonlySet<GA4ErrorCode> = new Set<GA4ErrorCode>([
  'GA4_AUTH',
  'GA4_NOT_FOUND',
  'GA4_PARSE',
  'GA4_CONFIG',
  'GA4_ABORT',
  'NOT_IMPLEMENTED',
]);

export class GA4ConnectorError extends Error {
  public readonly code: GA4ErrorCode;
  public readonly status?: number;
  public readonly retryable: boolean;

  constructor(code: GA4ErrorCode, message: string, opts: GA4ConnectorErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'GA4ConnectorError';
    this.code = code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? !NON_RETRYABLE_DEFAULT.has(code);
  }
}

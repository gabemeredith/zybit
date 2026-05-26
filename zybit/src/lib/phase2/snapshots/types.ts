/**
 * Phase 2 — Design DNA snapshots
 *
 * A page snapshot is a *static* analysis of a customer URL: meta tags,
 * heading hierarchy, CTA inventory (with visual-weight signals), forms.
 * It exists so the audit can ground its findings in *the actual page* —
 * naming the H1 it sees, the button class it sees, the section it sits in.
 *
 * v1 is HTML-only (no JS execution). Future versions may add a headless
 * pass for sites that ship most content client-side.
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';

// re-export so consumers can pull the canonical type from one place
export type { CanonicalEventInput };

export type SnapshotSchemaVersion = 1;

/** Stable canonical key for a page within a site. e.g. `/`, `/pricing`. */
export type PathRef = string;

export type PageLandmark =
  | 'header'
  | 'nav'
  | 'main'
  | 'aside'
  | 'footer'
  | 'dialog'
  | 'unknown';

export type FoldGuess = 'above' | 'uncertain' | 'below';

export interface PageSnapshotMeta {
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  charset: string | null;
  themeColor: string | null;
  viewport: string | null;
  robotsMeta: string | null;
}

export interface HeadingItem {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  documentIndex: number;
  /**
   * See `CtaCandidate.cssSelector` — same stability ladder, same bail policy.
   * Populated so the AI Variant Advisor can target headings (insert-shaped
   * findings like return-visit-thrash anchor a quick-answer block above the
   * top-most H1; without a selector the advisor degrades to text-replace on
   * the nearest CTA).
   */
  cssSelector: string | null;
}

/**
 * A clickable affordance discovered in the page. We score visual weight
 * from class hints (Tailwind/utility tokens) — the score is a heuristic,
 * not a measurement. Downstream rules combine it with click-share to flag
 * inversions (eye drawn one way, clicks go another).
 */
export interface CtaCandidate {
  /** Stable hash derived from outer markup; safe to reference across rules. */
  ref: string;
  /**
   * Best-guess browser-runnable CSS selector, computed at parse time. `null`
   * when no stable attribute was available — better to leave the experiment
   * builder field empty than to emit a fragile selector that silently breaks
   * on a CSS refactor. See `cssSelector.ts` for the stability ladder.
   */
  cssSelector: string | null;
  tag: 'a' | 'button';
  text: string;
  href: string | null;
  ariaLabel: string | null;
  landmark: PageLandmark;
  /** 0..1 — heuristic visual prominence based on class signals + tag + landmark. */
  visualWeight: number;
  /** Tokens that contributed to the weight (for explainability in findings). */
  visualWeightSignals: string[];
  foldGuess: FoldGuess;
  /** Depth in the DOM tree (root = 0). */
  domDepth: number;
  /** 0-based index in document order across all CTAs. */
  documentIndex: number;
  /** True if disabled / aria-disabled / inert. */
  disabled: boolean;
}

export interface ImageItem {
  /** `src` attribute value (may be relative or data URI). */
  src: string;
  /** `alt` attribute value, or `null` if the attribute is absent. */
  alt: string | null;
  /** True when the `alt` attribute is present (even if empty string). */
  hasAlt: boolean;
  /** `width` attribute as a number, or `null` if absent/non-numeric. */
  width: number | null;
  /** `height` attribute as a number, or `null` if absent/non-numeric. */
  height: number | null;
  /** Whether the image is inside the `<a>` or `<button>` that makes it a CTA (already handled). */
  isCtaChild: boolean;
  documentIndex: number;
}

export interface FormInputItem {
  type: string;
  name: string | null;
  required: boolean;
  labelText: string | null;
}

export interface FormCandidate {
  ref: string;
  /** See `CtaCandidate.cssSelector` — same shape, same bail policy. */
  cssSelector: string | null;
  landmark: PageLandmark;
  fieldCount: number;
  inputs: FormInputItem[];
  documentIndex: number;
  hasSubmitButton: boolean;
}

export interface PageSnapshotData {
  schemaVersion: SnapshotSchemaVersion;
  meta: PageSnapshotMeta;
  headings: HeadingItem[];
  ctas: CtaCandidate[];
  forms: FormCandidate[];
  /** All <img> elements found in the page body. Used by structural/accessibility rules. Absent on snapshots captured before schema v1.1. */
  images?: ImageItem[];
  /** sha256 hex of normalized HTML — used to detect drift across re-fetches. */
  contentHash: string;
  /** Bytes of the original HTML response. */
  rawByteSize: number;
  /** ISO timestamp of when parsing completed. */
  parsedAt: string;
  /** Detected CSS authoring system. Optional — absent on old snapshots. */
  cssSystem?: import('./cssSystemDetector').CssSystem;
}

export interface PageSnapshot {
  id: string;
  organizationId: string;
  siteId: string;
  pathRef: PathRef;
  /** Fully-qualified URL we fetched. */
  url: string;
  data: PageSnapshotData;
  fetchedAt: Date;
  createdAt: Date;
}

// ----- repository inputs -----

export interface UpsertPageSnapshotInput {
  organizationId: string;
  siteId: string;
  pathRef: PathRef;
  url: string;
  data: PageSnapshotData;
  fetchedAt: Date;
}

export interface GetPageSnapshotInput {
  organizationId: string;
  siteId: string;
  pathRef: PathRef;
}

export interface ListPageSnapshotsInput {
  organizationId: string;
  siteId: string;
  limit?: number;
}

// ----- fetch + parse contracts (Subagent A2 owns these implementations) -----

export interface SnapshotFetchOptions {
  /** Default 5_000ms. */
  timeoutMs: number;
  /** Default 1_500_000 (1.5MB). Bytes after which we abort the read. */
  maxBytes: number;
  /** Default 'ZybitAudit/1.0 (+https://zybit.dev)'. */
  userAgent: string;
  /** Default 5. */
  followRedirects: number;
  /** Default true. v1 makes a best-effort robots.txt check. */
  respectRobots: boolean;
}

export const DEFAULT_SNAPSHOT_FETCH_OPTIONS: SnapshotFetchOptions = {
  timeoutMs: 5_000,
  maxBytes: 1_500_000,
  userAgent: 'ZybitAudit/1.0 (+https://zybit.dev)',
  followRedirects: 5,
  respectRobots: true,
};

export interface SnapshotFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  html: string;
  byteSize: number;
  /** 'browser' when Browserless was used; 'http-only' otherwise. */
  snapshotMethod: 'http-only' | 'browser';
}

export type SnapshotErrorCode =
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'NON_HTML'
  | 'TOO_LARGE'
  | 'BLOCKED_BY_ROBOTS'
  | 'STATUS_4XX'
  | 'STATUS_5XX'
  | 'PARSE_ERROR'
  | 'INVALID_URL'
  | 'UNKNOWN';

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  readonly cause?: unknown;

  constructor(code: SnapshotErrorCode, message: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = 'SnapshotError';
  }
}

/**
 * Pure function: given a fetched HTML string + the final URL, produce
 * SnapshotData. Subagent A2 implements this in `parser.ts`.
 */
export type SnapshotParser = (input: {
  html: string;
  finalUrl: string;
  rawByteSize: number;
}) => Promise<PageSnapshotData>;

/**
 * Resilient fetch wrapper. Subagent A2 implements this in `fetcher.ts`.
 */
export type SnapshotFetcher = (
  url: string,
  options?: Partial<SnapshotFetchOptions>,
) => Promise<SnapshotFetchResult>;

// ----- normalization -----

/**
 * Canonical path key used by the repository unique index.
 * Strips trailing slash (except root), query string, and fragment.
 * Lowercases percent-encoding sequences. Throws SnapshotError('INVALID_URL').
 */
export function normalizePathRef(rawUrl: string): PathRef {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new SnapshotError('INVALID_URL', `cannot parse url: ${rawUrl}`, err);
  }
  let path = parsed.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}

// ----- per-path snapshot run result (used by routes) -----

export interface SnapshotRunInput {
  organizationId: string;
  siteId: string;
  baseUrl: string;
  paths: string[];
  options?: Partial<SnapshotFetchOptions>;
}

export interface SnapshotRunPathResult {
  path: string;
  pathRef: PathRef | null;
  url: string;
  status: 'ok' | 'error';
  errorCode?: SnapshotErrorCode;
  errorMessage?: string;
  snapshotId?: string;
}

export interface SnapshotRunReport {
  total: number;
  succeeded: number;
  failed: number;
  results: SnapshotRunPathResult[];
}

/**
 * Slice 2 shared core — turn a finding id into annotated HTML ready to
 * render in an iframe or hand to Browserless for a screenshot. Both the
 * preview route and the screenshot helper call this so they produce
 * byte-identical HTML (and so a fix in one surface never drifts from
 * the other).
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { phase1Sites, zybitFindings } from '@/lib/db/schema';
import { applyModifications, stripScripts } from '@/lib/experiments/htmlModifier';
import { createPhase1Repository } from '@/lib/phase1/repository';
import { getRuleById } from '@/lib/phase2/rules';
import type { AuditFinding } from '@/lib/phase2/rules/types';
import { createDesignSnapshotRepository } from '@/lib/phase2/snapshots/designSnapshotRepository';
import type { DesignTokens } from '@/lib/phase2/snapshots/tokenExtractor';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECT_HOPS = 5;

export interface BuildAnnotatedFindingHtmlOk {
  ok: true;
  html: string;
  annotationsCount: number;
  /** Set when the finding's site is a Lighthouse synthetic site. */
  lighthouseSlug: string | null;
  finding: AuditFinding;
}

export interface BuildAnnotatedFindingHtmlErr {
  ok: false;
  status: number;
  message: string;
}

export type BuildAnnotatedFindingHtmlResult =
  | BuildAnnotatedFindingHtmlOk
  | BuildAnnotatedFindingHtmlErr;

export async function buildAnnotatedFindingHtml(
  findingId: string,
  organizationId: string,
): Promise<BuildAnnotatedFindingHtmlResult> {
  const db = getDb();
  const findingRows = await db
    .select()
    .from(zybitFindings)
    .where(
      and(eq(zybitFindings.id, findingId), eq(zybitFindings.organizationId, organizationId)),
    )
    .limit(1);
  const findingRow = findingRows[0];
  if (!findingRow) return { ok: false, status: 404, message: 'Not Found' };
  if (!findingRow.pathRef) {
    return { ok: false, status: 404, message: 'Finding has no pathRef' };
  }

  const repository = createPhase1Repository();
  const snapshot = await repository.getPageSnapshot({
    organizationId,
    siteId: findingRow.siteId,
    pathRef: findingRow.pathRef,
  });
  if (!snapshot) return { ok: false, status: 404, message: 'No snapshot for this finding' };

  const siteRows = await db
    .select({ domain: phase1Sites.domain })
    .from(phase1Sites)
    .where(
      and(
        eq(phase1Sites.id, findingRow.siteId),
        eq(phase1Sites.organizationId, organizationId),
      ),
    )
    .limit(1);
  const domain = siteRows[0]?.domain;
  if (!domain) return { ok: false, status: 404, message: 'Site domain not found' };

  const designRepo = createDesignSnapshotRepository();
  const designRow = await designRepo.findBySitePath(
    organizationId,
    findingRow.siteId,
    findingRow.pathRef,
  );
  const designTokens = (designRow?.designTokens as DesignTokens | null) ?? null;

  const lighthouseSlug = findingRow.siteId.startsWith('lighthouse_site_')
    ? findingRow.siteId.slice('lighthouse_site_'.length)
    : null;
  const originUrl = lighthouseSlug
    ? `http://${domain}/fake-sites/${lighthouseSlug}${findingRow.pathRef}`
    : `https://${domain}${findingRow.pathRef}`;

  // SSRF guard with redirect-following. `domain` is customer-configured;
  // without this a malicious tenant could point it at 127.0.0.1,
  // 169.254.169.254 (cloud metadata), 10.x, etc. and use the preview
  // endpoint to read internal services. We use manual redirect handling
  // because `redirect: 'follow'` would skip the SSRF check on every hop —
  // a public URL that 302s to http://127.0.0.1/admin would bypass the
  // pre-fetch host check entirely.
  //
  // The lighthouse-slug path is dev-only (gated by LIGHTHOUSE_PREVIEW_ORIGIN
  // on the route and a `lighthouse_site_*` siteId that only our tooling
  // creates) and is expected to hit localhost, so skip the SSRF check there.
  // We still follow redirects manually so the hop cap applies.
  const fetched = await fetchWithSsrfGuard(originUrl, lighthouseSlug === null);
  if (!fetched.ok) return fetched;
  const html = fetched.html;

  const finding = rowToFinding(findingRow);
  const rule = getRuleById(finding.ruleId);
  const annotations = rule?.proposeAnnotations?.(finding, { snapshot, designTokens }) ?? [];
  const annotated = annotations.length > 0 ? applyModifications(html, annotations) : html;
  const stripped = stripScripts(annotated);
  const out = injectBaseHref(stripped, originUrl);

  return {
    ok: true,
    html: out,
    annotationsCount: annotations.length,
    lighthouseSlug,
    finding,
  };
}

/**
 * Fetch `initialUrl`, following redirects manually so we can re-run the SSRF
 * host check on every hop. `redirect: 'follow'` from the native `fetch` would
 * happily chase a public URL into 127.0.0.1, defeating the pre-fetch check.
 *
 * `enforceSsrfGuard=false` skips the host check (used for the lighthouse-slug
 * path, which legitimately needs to reach localhost), but still applies the
 * hop cap.
 */
export async function fetchWithSsrfGuard(
  initialUrl: string,
  enforceSsrfGuard: boolean,
): Promise<{ ok: true; html: string } | { ok: false; status: number; message: string }> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, status: 400, message: `Invalid URL after ${hop} hop(s)` };
    }
    if (enforceSsrfGuard) {
      const hostCheck = await isSafePreviewHost(parsed.hostname);
      if (!hostCheck.ok) {
        return {
          ok: false,
          status: 400,
          message: `Refusing to fetch preview: ${hostCheck.reason}`,
        };
      }
    }
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        headers: { 'User-Agent': 'Zybit-Preview/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      return { ok: false, status: 504, message: `Could not reach origin: ${message}` };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { ok: false, status: 502, message: `Origin returned ${res.status} with no Location header` };
      }
      // Resolve relative redirects against the current URL.
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!res.ok) {
      return { ok: false, status: 502, message: `Origin returned ${res.status}` };
    }
    const html = await res.text();
    return { ok: true, html };
  }
  return { ok: false, status: 502, message: `Too many redirects (> ${MAX_REDIRECT_HOPS})` };
}

function injectBaseHref(html: string, originUrl: string): string {
  if (/<base\s/i.test(html)) return html;
  const baseTag = `<base href="${escapeAttr(originUrl)}">`;
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    return html.replace(headOpen[0], `${headOpen[0]}${baseTag}`);
  }
  return `${baseTag}${html}`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Block the obvious SSRF targets: localhost, loopback, link-local
 * (including the AWS/GCP metadata IP 169.254.169.254), private RFC1918
 * ranges, CGNAT, and IPv6 equivalents.
 *
 * Two layers:
 *   1. Reject if the hostname is itself a private IP literal or `localhost`.
 *   2. DNS-resolve the hostname and reject if any answer is a private IP.
 *      Defeats `evil.example.com → 127.0.0.1` rebinding-at-config-time.
 *
 * Caveat: a true TOCTOU-safe SSRF guard would also pin the socket-level
 * resolved IP (since fetch re-resolves). That's a separate, larger change;
 * this layer blocks the demonstrated risk (customer typing 127.0.0.1 as
 * their domain) and the obvious A-record-to-internal-IP variant.
 */
export async function isSafePreviewHost(
  hostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isPrivateHostname(hostname)) {
    return { ok: false, reason: `host '${hostname}' is private/loopback/link-local` };
  }
  let addresses: string[] = [];
  try {
    const { lookup } = await import('node:dns/promises');
    const results = await lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    return { ok: false, reason: `could not resolve host '${hostname}'` };
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      return { ok: false, reason: `host '${hostname}' resolves to private IP ${addr}` };
    }
  }
  return { ok: true };
}

function isPrivateHostname(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  return isPrivateIp(lower);
}

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0) return true;             // 0.0.0.0/8 — "this network"
    if (a === 10) return true;            // RFC1918
    if (a === 127) return true;           // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }
  // IPv6
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80:') || v6.startsWith('fe80::')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true; // ULA fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compat (::127.0.0.1).
  const mapped = v6.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

function rowToFinding(row: typeof zybitFindings.$inferSelect): AuditFinding {
  return {
    id: row.id,
    ruleId: row.ruleId,
    category: row.category as AuditFinding['category'],
    severity: row.severity as AuditFinding['severity'],
    confidence: row.confidence,
    priorityScore: row.priorityScore,
    pathRef: row.pathRef,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    evidence: row.evidence,
    prescription: row.prescription ?? undefined,
    impactEstimate: row.impactEstimate ?? undefined,
    refs: (row.refs as AuditFinding['refs']) ?? undefined,
  };
}

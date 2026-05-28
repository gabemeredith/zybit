import { NextRequest, NextFetchEvent, NextResponse } from 'next/server';
import {
  assignBucket,
  bucketCookieMaxAge,
  bucketCookieName,
  generateVisitorId,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE,
  type Bucket,
} from '../bucketing';
import { isSpaHtml } from '@/lib/phase2/snapshots/browserFetcher';
import { applyModifications } from '../htmlModifier';
import { injectBridgeScript } from './bridgeScript';
import { loadProxyConfig, type ProxyExperiment } from './config';
import { logAssignment } from './assignmentLog';
import { extractSlug } from './host';
import { DEMO_SITE_ID } from '@/lib/demo/constants';

export async function handleProxyRequest(
  req: NextRequest,
  event: NextFetchEvent,
): Promise<NextResponse> {
  const slug = extractSlug(req.nextUrl.hostname);
  if (!slug) return new NextResponse('Not Found', { status: 404 });

  const proxyConfig = await loadProxyConfig(slug, req.url);
  if (!proxyConfig) return new NextResponse('Not Found', { status: 404 });

  const { site, experiments } = proxyConfig;
  const requestPath = req.nextUrl.pathname;
  const userAgent = req.headers.get('user-agent') || '';
  const originUrl = `https://${site.domain}${requestPath}${req.nextUrl.search}`;

  // Most-specific path wins; null targetPath (wildcard) sorts last.
  const matching = experiments
    .filter((exp) => !exp.targetPath || exp.targetPath === requestPath)
    .sort((a, b) => (b.targetPath?.length ?? 0) - (a.targetPath?.length ?? 0));

  if (matching.length === 0) {
    return passthrough(originUrl, userAgent);
  }

  const experiment = matching[0];

  let visitorId = req.cookies.get(VISITOR_COOKIE)?.value;
  const isNewVisitor = !visitorId;
  if (!visitorId) visitorId = generateVisitorId();

  const existingBucket = req.cookies.get(bucketCookieName(experiment.id))?.value;
  // `?_zb_force=control|variant` is the demo-mode bucket override —
  // honored only for the synthetic commitmint demo site so the side-by-side
  // preview can render both buckets without re-rolling visitor cookies.
  // Never trusted for real customer traffic.
  const forceParam = req.nextUrl.searchParams.get('_zb_force');
  const isDemoSite = site.id === DEMO_SITE_ID;
  const forcedBucket: Bucket | null =
    isDemoSite && (forceParam === 'control' || forceParam === 'variant')
      ? forceParam
      : null;
  const bucket: Bucket = forcedBucket
    ? forcedBucket
    : existingBucket === 'control' || existingBucket === 'variant'
      ? existingBucket
      : await assignBucket(visitorId, experiment.id, experiment.controlPct);

  const response = await fetchAndMaybeModify(originUrl, userAgent, bucket, experiment, visitorId);

  if (isNewVisitor) {
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      maxAge: VISITOR_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
    });
  }
  if (!existingBucket && !forcedBucket) {
    response.cookies.set(bucketCookieName(experiment.id), bucket, {
      maxAge: bucketCookieMaxAge(experiment.durationDays),
      sameSite: 'lax',
      path: '/',
    });
  }

  event.waitUntil(
    logAssignment(req.url, {
      experimentId: experiment.id,
      bucket,
      visitorId,
      siteId: site.id,
      path: requestPath,
      timestamp: new Date().toISOString(),
    }),
  );

  return response;
}

const ORIGIN_TIMEOUT_MS = 10_000;

async function fetchOrigin(originUrl: string, userAgent: string): Promise<Response> {
  return fetch(originUrl, {
    headers: { 'User-Agent': userAgent },
    redirect: 'follow',
    signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
  });
}

async function passthrough(originUrl: string, userAgent: string): Promise<NextResponse> {
  try {
    const originRes = await fetchOrigin(originUrl, userAgent);
    return new NextResponse(originRes.body, {
      status: originRes.status,
      headers: originRes.headers,
    });
  } catch {
    return new NextResponse('Origin unreachable', { status: 502 });
  }
}

// Zybit-103: SPA shells won't have the target DOM nodes at request time.
// Log a warning so operators know HTML modifications may not apply.

async function fetchAndMaybeModify(
  originUrl: string,
  userAgent: string,
  bucket: Bucket,
  experiment: ProxyExperiment,
  visitorId: string,
): Promise<NextResponse> {
  let originRes: Response;
  try {
    originRes = await fetchOrigin(originUrl, userAgent);
  } catch {
    // Fail-open on network error or timeout — return 502 rather than a Zybit error.
    return new NextResponse('Origin unreachable', { status: 502 });
  }

  const contentType = originRes.headers.get('content-type') || '';

  // Only HTML responses can carry variant modifications or the PostHog
  // bridge script. Stream anything else (assets, JSON, redirects) untouched.
  if (!contentType.includes('text/html')) {
    return new NextResponse(originRes.body, {
      status: originRes.status,
      headers: originRes.headers,
    });
  }

  let html: string;
  try {
    html = await originRes.text();
  } catch {
    // Body read failure — fail-open with a re-fetch of unmodified origin.
    const fallback = await fetchOrigin(originUrl, userAgent).catch(() => null);
    if (!fallback) return new NextResponse('Origin unreachable', { status: 502 });
    return new NextResponse(fallback.body, { status: fallback.status, headers: fallback.headers });
  }

  // Kill switch: if the experiment was stopped after this config was cached,
  // serve unmodified origin rather than stale variant HTML.
  const shouldModify =
    bucket === 'variant' &&
    experiment.status === 'running' &&
    experiment.modifications.length > 0;

  let body = html;

  if (shouldModify) {
    // Zybit-103: SPA shells won't have the target DOM nodes at request time.
    // Log a warning so operators know HTML modifications won't apply.
    if (isSpaHtml(html)) {
      console.warn('[zybit-proxy] SPA shell detected — modifications may not apply', {
        experimentId: experiment.id,
        originUrl,
      });
    }
    try {
      body = applyModifications(html, experiment.modifications);
    } catch {
      // Modification failed — fail-open by serving the original unmodified HTML.
      body = html;
    }
  }

  // PostHog visitor-ID bridge: inject for BOTH control and variant so
  // conversions from either bucket carry the Zybit visitor ID and the
  // outcome-computation join can match them. Never throws.
  body = injectBridgeScript(body, visitorId);

  // Preserve origin headers (Set-Cookie, Cache-Control, CSP, etc.) but drop
  // the encoding/length headers that no longer match the rewritten body.
  const responseHeaders = new Headers(originRes.headers);
  responseHeaders.set('content-type', contentType);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new NextResponse(body, {
    status: originRes.status,
    headers: responseHeaders,
  });
}

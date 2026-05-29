import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { handleProxyRequest } from '@/lib/experiments/proxy/handler';
import { isProxyHost } from '@/lib/experiments/proxy/host';

const PUBLIC_PREFIXES = [
  '/sign-in',
  '/set-password',
  '/admin/login',
  '/api/auth',
  '/api/admin',
  '/dashboard',
  '/docs',
  '/discovery',
  '/api/intake',
  '/api/discovery',
  '/api/phase1/health',
  '/api/phase2/health',
  '/api/billing/webhook',
  '/api/loader',
  '/api/proxy',
  // Public URL-audit lead magnet
  '/audit',
  '/api/audit',
  // Video-ready demo entry — seeds + signs in the synthetic PM user.
  '/demo',
  '/api/demo',
];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'));
}

function isSegmentWebhookPath(pathname: string): boolean {
  return /^\/api\/phase2\/integrations\/[^/]+\/segment-webhook\/?$/.test(pathname);
}

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  // Experiment proxy — must run before all auth checks
  if (isProxyHost(req.nextUrl.hostname)) {
    return handleProxyRequest(req, event);
  }

  if (pathname.startsWith('/api/proxy/')) {
    return NextResponse.next();
  }

  // Admin pages: presence-check on zb_admin cookie (full HMAC verify in server component)
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login') && !pathname.startsWith('/api/admin/login')) {
    if (!req.cookies.get('zb_admin')) {
      return NextResponse.redirect(new URL('/admin/login', req.url));
    }
    return NextResponse.next();
  }

  // App pages: presence-check on zb_session cookie (full DB verify in layout)
  if (pathname.startsWith('/app')) {
    if (!req.cookies.get('zb_session')) {
      return NextResponse.redirect(new URL('/sign-in', req.url));
    }
    return NextResponse.next();
  }

  // Public paths — no auth needed
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // API routes with their own auth (API keys, segment webhooks, cron)
  if (isSegmentWebhookPath(pathname)) {
    const authz = req.headers.get('authorization');
    const hasBearerCred =
      typeof authz === 'string' &&
      /^Bearer\s+\S+/i.test(authz.trim()) &&
      authz.trim().toLowerCase() !== 'bearer';
    if (!hasBearerCred) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SEGMENT_WEBHOOK_UNAUTHORIZED',
            message: 'Send Authorization: Bearer <token> matching the env var referenced by integration.secretRef.',
          },
        },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  if (pathname === '/api/phase2/cron/sync-posthog') {
    return NextResponse.next();
  }

  const authz = req.headers.get('authorization');
  if (authz?.startsWith('Bearer zybit_sk_')) {
    return NextResponse.next();
  }

  // Everything else: require app session
  if (!req.cookies.get('zb_session')) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

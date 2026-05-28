/**
 * GET /api/demo/enter — signs the synthetic PM into the demo org and
 * redirects to `/app`. Cookies can only be set from a Route Handler (not
 * during a page render), so the `/demo` page redirects here once the seed
 * is `done` rather than minting the session inline.
 *
 * If the synthetic user row isn't in place yet, bounce back to `/demo` so
 * the seeding flow can finish first.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ensureDemoUserAndMintSession } from '@/lib/demo/session';
import { sessionCookieOptions } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = await ensureDemoUserAndMintSession();
  if (!token) {
    return NextResponse.redirect(new URL('/demo', req.nextUrl.origin));
  }
  const res = NextResponse.redirect(new URL('/app', req.nextUrl.origin));
  res.cookies.set({ ...sessionCookieOptions, value: token });
  return res;
}

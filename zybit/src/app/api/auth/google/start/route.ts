import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildGoogleAuthUrl, getGoogleConfig, OAUTH_STATE_COOKIE } from '@/lib/auth/google';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const config = getGoogleConfig();
  if (!config) {
    return NextResponse.redirect(new URL('/sign-in?error=google-unavailable', request.url));
  }

  // CSRF defense: a random state echoed back by Google and compared against a
  // short-lived httpOnly cookie on the callback.
  const state = randomBytes(24).toString('base64url');
  const response = NextResponse.redirect(buildGoogleAuthUrl(config, state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes — the user has to complete the round-trip in time.
  });
  return response;
}

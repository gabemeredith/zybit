import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getGoogleConfig = vi.fn();
const exchangeGoogleCode = vi.fn();
const fetchGoogleUserInfo = vi.fn();
const createSession = vi.fn();

let limitResults: unknown[][] = [];

vi.mock('@/lib/auth/google', () => ({
  OAUTH_STATE_COOKIE: 'zb_oauth_state',
  getGoogleConfig: () => getGoogleConfig(),
  exchangeGoogleCode: (...a: unknown[]) => exchangeGoogleCode(...a),
  fetchGoogleUserInfo: (...a: unknown[]) => fetchGoogleUserInfo(...a),
}));

vi.mock('@/lib/auth/session', () => ({
  createSession: (...a: unknown[]) => createSession(...a),
  sessionCookieOptions: {
    name: 'zb_session', httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 100,
  },
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(limitResults.shift() ?? []) }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  }),
}));

import { GET } from '../route';

function makeRequest(params: Record<string, string>, cookie?: string): NextRequest {
  const url = new URL('https://app.example.com/api/auth/google/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  getGoogleConfig.mockReset();
  exchangeGoogleCode.mockReset();
  fetchGoogleUserInfo.mockReset();
  createSession.mockReset();
  limitResults = [];
  getGoogleConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUrl: 'r' });
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/auth/google/callback', () => {
  it('redirects to google-failed when state does not match the cookie', async () => {
    const res = await GET(makeRequest({ code: 'abc', state: 'x' }, 'zb_oauth_state=y'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in?error=google-failed');
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it('redirects to google-unavailable when OAuth is not configured', async () => {
    getGoogleConfig.mockReturnValueOnce(null);
    const res = await GET(makeRequest({ code: 'abc', state: 's' }, 'zb_oauth_state=s'));
    expect(res.headers.get('location')).toContain('error=google-unavailable');
  });

  it('bounces a pending lead to the pending notice', async () => {
    exchangeGoogleCode.mockResolvedValueOnce('access-token');
    fetchGoogleUserInfo.mockResolvedValueOnce({
      sub: 'g-sub', email: 'lead@co.com', emailVerified: true,
    });
    // appUsers by sub → miss, by email → miss, access_requests → pending hit
    limitResults = [[], [], [{ status: 'pending' }]];

    const res = await GET(makeRequest({ code: 'abc', state: 's' }, 'zb_oauth_state=s'));

    expect(res.headers.get('location')).toContain('/sign-in?notice=pending');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('signs in an approved user matched by google_sub', async () => {
    exchangeGoogleCode.mockResolvedValueOnce('access-token');
    fetchGoogleUserInfo.mockResolvedValueOnce({
      sub: 'g-sub', email: 'user@co.com', emailVerified: true,
    });
    limitResults = [[{ id: 'u1' }]];
    createSession.mockResolvedValueOnce('sess-token');

    const res = await GET(makeRequest({ code: 'abc', state: 's' }, 'zb_oauth_state=s'));

    expect(res.headers.get('location')).toContain('/app');
    expect(res.headers.get('set-cookie')).toContain('zb_session=sess-token');
  });
});

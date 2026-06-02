import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `after` requires a Next.js request context; stub it so tests don't throw.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((fn: () => void) => fn()) };
});

// Resend is imported by the route for the founder notification; no-op in tests.
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));

import { NextRequest } from 'next/server';

const getGoogleConfig = vi.fn();
const exchangeGoogleCode = vi.fn();
const fetchGoogleUserInfo = vi.fn();
const createSession = vi.fn();
const upsertAccessRequest = vi.fn();

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

vi.mock('@/lib/auth/accessRequests', () => ({
  upsertAccessRequest: (...a: unknown[]) => upsertAccessRequest(...a),
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
  upsertAccessRequest.mockReset();
  upsertAccessRequest.mockResolvedValue('req-id');
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

  it('bounces an existing pending lead to the pending notice without re-queueing', async () => {
    exchangeGoogleCode.mockResolvedValueOnce('access-token');
    fetchGoogleUserInfo.mockResolvedValueOnce({
      sub: 'g-sub', email: 'lead@co.com', emailVerified: true,
    });
    // appUsers by sub → miss, by email → miss, access_requests → existing row
    limitResults = [[], [], [{ status: 'pending' }]];

    const res = await GET(makeRequest({ code: 'abc', state: 's' }, 'zb_oauth_state=s'));

    expect(res.headers.get('location')).toContain('/sign-in?notice=pending');
    expect(createSession).not.toHaveBeenCalled();
    expect(upsertAccessRequest).not.toHaveBeenCalled();
  });

  it('queues a brand-new Google sign-in as a google_oauth lead', async () => {
    exchangeGoogleCode.mockResolvedValueOnce('access-token');
    fetchGoogleUserInfo.mockResolvedValueOnce({
      sub: 'g-sub', email: 'newbie@co.com', emailVerified: true, name: 'Newbie',
    });
    // No approved user, no existing access_request row.
    limitResults = [[], [], []];

    const res = await GET(makeRequest({ code: 'abc', state: 's' }, 'zb_oauth_state=s'));

    expect(res.headers.get('location')).toContain('/sign-in?notice=pending');
    expect(createSession).not.toHaveBeenCalled();
    expect(upsertAccessRequest).toHaveBeenCalledWith({
      email: 'newbie@co.com',
      source: 'google_oauth',
    });
  });

  it('rejects when the email is already bound to a different google_sub', async () => {
    exchangeGoogleCode.mockResolvedValueOnce('access-token');
    fetchGoogleUserInfo.mockResolvedValueOnce({
      sub: 'new-sub', email: 'user@co.com', emailVerified: true,
    });
    // sub lookup → miss; email lookup → approved user already linked to OTHER sub
    limitResults = [[], [{ id: 'u1', googleSub: 'old-sub' }]];

    const res = await GET(makeRequest({ code: 'abc', state: 's' }, 'zb_oauth_state=s'));

    expect(res.headers.get('location')).toContain('/sign-in?error=google-mismatch');
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

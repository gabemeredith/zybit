import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkAuthRateLimit = vi.fn();
const verifyPassword = vi.fn();
const createSession = vi.fn();

// Queue of results returned by successive `.limit(1)` calls. The login route
// queries app_users first, then access_requests.
let limitResults: unknown[][] = [];

vi.mock('@/lib/auth/rateLimit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => checkAuthRateLimit(...args),
}));

vi.mock('@/lib/auth/password', () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
}));

vi.mock('@/lib/auth/session', () => ({
  createSession: (...args: unknown[]) => createSession(...args),
  sessionCookieOptions: {
    name: 'zb_session',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 100,
  },
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(limitResults.shift() ?? []),
        }),
      }),
    }),
  }),
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  checkAuthRateLimit.mockReset();
  verifyPassword.mockReset();
  createSession.mockReset();
  limitResults = [];
  checkAuthRateLimit.mockResolvedValue({ allowed: true });
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/auth/login', () => {
  it('rejects a non-string email', async () => {
    const res = await POST(makeRequest({ email: 1, password: 'x' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing password', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com' }));
    expect(res.status).toBe(400);
  });

  it('429s when rate-limited', async () => {
    checkAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'x' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('signs in an approved user with the correct password', async () => {
    limitResults = [[{ id: 'u1', status: 'approved', passwordHash: 'scrypt$1$a$b' }]];
    verifyPassword.mockReturnValueOnce(true);
    createSession.mockResolvedValueOnce('sess-token');

    const res = await POST(makeRequest({ email: 'a@b.com', password: 'good' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('set-cookie')).toContain('zb_session=sess-token');
  });

  it('returns generic 401 for an approved user with the wrong password', async () => {
    limitResults = [[{ id: 'u1', status: 'approved', passwordHash: 'scrypt$1$a$b' }]];
    verifyPassword.mockReturnValueOnce(false);

    const res = await POST(makeRequest({ email: 'a@b.com', password: 'bad' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Incorrect email or password.');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('tells an approved user with no password to use their welcome link', async () => {
    limitResults = [[{ id: 'u1', status: 'approved', passwordHash: null }]];

    const res = await POST(makeRequest({ email: 'a@b.com', password: 'x' }));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('no-password');
  });

  it('returns the humane pending message for a known pending lead', async () => {
    // app_users miss, then access_requests hit
    limitResults = [[], [{ status: 'pending' }]];

    const res = await POST(makeRequest({ email: 'lead@b.com', password: 'x' }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('pending');
    expect(body.error).toMatch(/approved you yet/);
  });

  it('returns a generic 401 for a completely unknown email', async () => {
    limitResults = [[], []];

    const res = await POST(makeRequest({ email: 'nobody@b.com', password: 'x' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Incorrect email or password.');
  });
});

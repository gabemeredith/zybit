import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `after` requires a Next.js request context; stub it so tests don't throw.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((fn: () => void) => fn()) };
});

// Resend is imported by the route for the founder notification; no-op in tests.
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));

const verifySetPasswordToken = vi.fn();
const hashPassword = vi.fn();
const createSession = vi.fn();
const updateSet = vi.fn();
let limitResults: unknown[][] = [];

vi.mock('@/lib/auth/setPasswordToken', () => ({
  verifySetPasswordToken: (...a: unknown[]) => verifySetPasswordToken(...a),
}));

vi.mock('@/lib/auth/password', () => ({
  hashPassword: (...a: unknown[]) => hashPassword(...a),
  isAcceptablePassword: (p: string) => typeof p === 'string' && p.length >= 8 && p.length <= 200,
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
      from: () => ({ where: () => ({ limit: () => Promise.resolve(limitResults.shift() ?? []) }) }),
    }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: () => Promise.resolve() }; } }),
  }),
}));

import { POST } from '../route';

function makeRequest(body: unknown) {
  return new Request('https://app.test/api/auth/set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  verifySetPasswordToken.mockReset();
  hashPassword.mockReset();
  createSession.mockReset();
  updateSet.mockReset();
  limitResults = [];
  hashPassword.mockResolvedValue('scrypt$1$a$b');
  createSession.mockResolvedValue('sess-token');
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/auth/set-password', () => {
  it('rejects a short password before touching the token', async () => {
    const res = await POST(makeRequest({ token: 't', password: 'short' }));
    expect(res.status).toBe(400);
    expect(verifySetPasswordToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired token', async () => {
    verifySetPasswordToken.mockReturnValueOnce(null);
    const res = await POST(makeRequest({ token: 'bad', password: 'GoodPassw0rd' }));
    expect(res.status).toBe(400);
  });

  it('sets the password and signs in a first-time user (no existing hash)', async () => {
    verifySetPasswordToken.mockReturnValueOnce('jane@co.com');
    limitResults = [[{ id: 'u1', passwordHash: null }]];
    const res = await POST(makeRequest({ token: 'ok', password: 'GoodPassw0rd' }));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ authProvider: 'password' }));
    expect(res.headers.get('set-cookie')).toContain('zb_session=sess-token');
  });

  it('refuses to reset once a password already exists (first-set-only, 409)', async () => {
    verifySetPasswordToken.mockReturnValueOnce('jane@co.com');
    limitResults = [[{ id: 'u1', passwordHash: 'scrypt$32768$aa$bb' }]];
    const res = await POST(makeRequest({ token: 'ok', password: 'GoodPassw0rd' }));
    expect(res.status).toBe(409);
    expect(updateSet).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});

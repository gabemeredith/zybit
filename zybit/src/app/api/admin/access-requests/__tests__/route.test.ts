import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAdminCookie = vi.fn();
const sendWelcomeEmail = vi.fn();
const signSetPasswordToken = vi.fn();
const cookieGet = vi.fn();

// Queue of `.limit(1)` results: the route looks up the access_request, then
// (on approve) the existing app_user.
let limitResults: unknown[][] = [];
const updateSet = vi.fn();
const batch = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (...a: unknown[]) => cookieGet(...a) }),
}));

vi.mock('@/lib/auth/adminSession', () => ({
  ADMIN_COOKIE: 'zb_admin',
  verifyAdminCookie: (...a: unknown[]) => verifyAdminCookie(...a),
}));

vi.mock('@/lib/auth/setPasswordToken', () => ({
  signSetPasswordToken: (...a: unknown[]) => signSetPasswordToken(...a),
}));

vi.mock('@/lib/email/welcomeEmail', () => ({
  sendWelcomeEmail: (...a: unknown[]) => sendWelcomeEmail(...a),
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(limitResults.shift() ?? []) }),
        orderBy: () => Promise.resolve([]),
      }),
    }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: () => Promise.resolve() }; } }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({}) }) }),
    batch: (...a: unknown[]) => { batch(...a); return Promise.resolve(); },
  }),
}));

import { POST } from '../route';

function makeRequest(body: unknown) {
  return new Request('https://app.test/api/admin/access-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  verifyAdminCookie.mockReset();
  sendWelcomeEmail.mockReset();
  signSetPasswordToken.mockReset();
  cookieGet.mockReset();
  updateSet.mockReset();
  batch.mockReset();
  limitResults = [];
  verifyAdminCookie.mockReturnValue(true);
  cookieGet.mockReturnValue({ value: 'cookie' });
  signSetPasswordToken.mockReturnValue('signed-token');
  sendWelcomeEmail.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/admin/access-requests', () => {
  it('401s when not an admin', async () => {
    verifyAdminCookie.mockReturnValueOnce(false);
    const res = await POST(makeRequest({ id: 'r1', action: 'approve' }));
    expect(res.status).toBe(401);
  });

  it('400s on an unknown action', async () => {
    const res = await POST(makeRequest({ id: 'r1', action: 'frobnicate' }));
    expect(res.status).toBe(400);
  });

  it('404s when the request does not exist', async () => {
    limitResults = [[]];
    const res = await POST(makeRequest({ id: 'missing', action: 'approve' }));
    expect(res.status).toBe(404);
  });

  it('approve mints a user (batch), marks invited, and sends the welcome email', async () => {
    // access_request lookup, then existing-user lookup (miss → provision)
    limitResults = [
      [{ id: 'r1', email: 'lead@co.com', domain: 'co.com', roleTitle: 'PM', source: 'request_form', status: 'pending' }],
      [],
    ];
    const res = await POST(makeRequest({ id: 'r1', action: 'approve', orgName: 'Co' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('invited');
    expect(batch).toHaveBeenCalledTimes(1);
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    const sentTo = (sendWelcomeEmail.mock.calls[0][0] as { email: string }).email;
    expect(sentTo).toBe('lead@co.com');
    // request marked invited
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'invited' }));
  });

  it('approve is idempotent for an existing user (no batch insert)', async () => {
    limitResults = [
      [{ id: 'r1', email: 'dup@co.com', domain: 'co.com', roleTitle: null, source: 'public_audit', status: 'pending' }],
      [{ id: 'existing-user' }],
    ];
    const res = await POST(makeRequest({ id: 'r1', action: 'approve' }));
    expect(res.status).toBe(200);
    expect(batch).not.toHaveBeenCalled();
    // still re-approves to status approved + sends welcome
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('reject marks the request rejected without sending email', async () => {
    limitResults = [[{ id: 'r1', email: 'no@co.com', domain: null, roleTitle: null, source: 'request_form', status: 'pending' }]];
    const res = await POST(makeRequest({ id: 'r1', action: 'reject' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('rejected');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('save-payment-link stores the link without provisioning', async () => {
    limitResults = [[{ id: 'r1', email: 'p@co.com', domain: null, roleTitle: null, source: 'request_form', status: 'pending' }]];
    const res = await POST(makeRequest({ id: 'r1', action: 'save-payment-link', stripePaymentLink: 'https://buy.stripe.com/x' }));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ stripePaymentLink: 'https://buy.stripe.com/x' }));
    expect(batch).not.toHaveBeenCalled();
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

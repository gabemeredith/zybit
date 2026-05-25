import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveZybitActor = vi.fn();
const assertSiteInOrganization = vi.fn();
const checkPlanLimit = vi.fn();
const insertReturning = vi.fn();
const updateSet = vi.fn();

vi.mock('@/lib/auth/actor', () => ({
  resolveZybitActor: (...args: unknown[]) => resolveZybitActor(...args),
  assertApiKeyHasScope: () => null,
  assertApiKeyHasAnyScope: () => null,
}));

vi.mock('@/lib/auth/tenantScope', () => ({
  assertSiteInOrganization: (...args: unknown[]) => assertSiteInOrganization(...args),
}));

vi.mock('@/lib/billing/checkPlanLimit', () => ({
  checkPlanLimit: (...args: unknown[]) => checkPlanLimit(...args),
}));

vi.mock('@/lib/phase1', () => ({
  createPhase1Repository: () => ({}),
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: () => insertReturning(),
      }),
    }),
    update: () => ({
      set: (vals: unknown) => {
        updateSet(vals);
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
  }),
}));

import { POST } from '../route';

const ORG_ID = 'org-1';
const SITE_ID = 'site-1';

function makeRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/dashboard/experiments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveZybitActor.mockReset();
  assertSiteInOrganization.mockReset();
  checkPlanLimit.mockReset();
  insertReturning.mockReset();
  updateSet.mockReset();

  resolveZybitActor.mockResolvedValue({
    ok: true,
    actor: { kind: 'session', organizationId: ORG_ID, userId: 'user-1' },
  });
  assertSiteInOrganization.mockResolvedValue({ ok: true });
  checkPlanLimit.mockResolvedValue({ allowed: true, current: 0, limit: 3, plan: 'starter' });
  insertReturning.mockResolvedValue([{ id: 'exp-new', organizationId: ORG_ID, status: 'draft' }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseBody = {
  siteId: SITE_ID,
  hypothesis: 'Bigger CTA increases sign-ups',
  primaryMetric: 'signup_completed',
};

describe('POST /api/dashboard/experiments', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await POST(makeRequest({ hypothesis: 'h', primaryMetric: 'm' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when hypothesis is missing', async () => {
    const res = await POST(makeRequest({ siteId: SITE_ID, primaryMetric: 'm' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when primaryMetric is missing', async () => {
    const res = await POST(makeRequest({ siteId: SITE_ID, hypothesis: 'h' }));
    expect(res.status).toBe(400);
  });

  it('does NOT check plan limit when startImmediately is false (draft creation)', async () => {
    const res = await POST(makeRequest({ ...baseBody }));

    expect(res.status).toBe(201);
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(insertReturning).toHaveBeenCalled();
  });

  it('returns 402 PLAN_LIMIT_EXCEEDED when startImmediately=true and concurrent-experiments cap is hit', async () => {
    checkPlanLimit.mockResolvedValueOnce({
      allowed: false,
      current: 3,
      limit: 3,
      plan: 'starter',
    });

    const res = await POST(makeRequest({ ...baseBody, startImmediately: true }));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(body.error.message).toContain('concurrent experiments');
    expect(checkPlanLimit).toHaveBeenCalledWith(ORG_ID, 'experiments');
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it('creates a running experiment when startImmediately=true and the plan allows', async () => {
    const res = await POST(makeRequest({ ...baseBody, startImmediately: true }));

    expect(res.status).toBe(201);
    expect(checkPlanLimit).toHaveBeenCalledWith(ORG_ID, 'experiments');
    expect(insertReturning).toHaveBeenCalled();
  });

  it('returns the site-scope failure response without inserting when site is not in org', async () => {
    const forbidden = new Response(
      JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }),
      { status: 403 },
    );
    assertSiteInOrganization.mockResolvedValueOnce({ ok: false, response: forbidden });

    const res = await POST(makeRequest({ ...baseBody }));

    expect(res.status).toBe(403);
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it('rejects an invalid modifications array with 400 before any DB write', async () => {
    const res = await POST(
      makeRequest({
        ...baseBody,
        modifications: [{ type: 'bogus-type' }],
      }),
    );

    expect(res.status).toBe(400);
    expect(insertReturning).not.toHaveBeenCalled();
  });
});

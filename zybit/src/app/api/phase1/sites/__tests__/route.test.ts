import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveZybitActor = vi.fn();
const assertApiKeyHasScope = vi.fn();
const assertApiKeyHasAnyScope = vi.fn();
const checkPlanLimit = vi.fn();
const createSite = vi.fn();
const listSites = vi.fn();

vi.mock('@/lib/auth/actor', () => ({
  resolveZybitActor: (...args: unknown[]) => resolveZybitActor(...args),
  assertApiKeyHasScope: (...args: unknown[]) => assertApiKeyHasScope(...args),
  assertApiKeyHasAnyScope: (...args: unknown[]) => assertApiKeyHasAnyScope(...args),
}));

vi.mock('@/lib/billing/checkPlanLimit', () => ({
  checkPlanLimit: (...args: unknown[]) => checkPlanLimit(...args),
}));

vi.mock('@/lib/phase1', () => ({
  createPhase1Repository: () => ({
    createSite: (...args: unknown[]) => createSite(...args),
    listSites: (...args: unknown[]) => listSites(...args),
  }),
}));

import { GET, POST } from '../route';

function makeRequest(
  init: { method?: string; body?: unknown; url?: string; headers?: Record<string, string> } = {},
): Request {
  const url = init.url ?? 'https://app.example.com/api/phase1/sites';
  return new Request(url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body:
      init.body === undefined
        ? null
        : typeof init.body === 'string'
          ? init.body
          : JSON.stringify(init.body),
  });
}

const ORG_ID = 'org-test-1';

beforeEach(() => {
  resolveZybitActor.mockReset();
  assertApiKeyHasScope.mockReset();
  assertApiKeyHasAnyScope.mockReset();
  checkPlanLimit.mockReset();
  createSite.mockReset();
  listSites.mockReset();

  resolveZybitActor.mockResolvedValue({
    ok: true,
    actor: { kind: 'session', organizationId: ORG_ID, userId: 'user-1' },
  });
  assertApiKeyHasScope.mockReturnValue(null);
  assertApiKeyHasAnyScope.mockReturnValue(null);
  checkPlanLimit.mockResolvedValue({ allowed: true, current: 0, limit: 5, plan: 'starter' });
  createSite.mockImplementation(async (site: Record<string, unknown>) => site);
  listSites.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/phase1/sites', () => {
  it('returns 400 when name is missing', async () => {
    const res = await POST(makeRequest({ body: { domain: 'acme.com' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when domain is missing', async () => {
    const res = await POST(makeRequest({ body: { name: 'Acme' } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on a non-JSON body', async () => {
    const res = await POST(makeRequest({ body: 'not-json' }));
    expect(res.status).toBe(400);
  });

  it('returns 402 PLAN_LIMIT_EXCEEDED when the plan cap is hit', async () => {
    checkPlanLimit.mockResolvedValueOnce({ allowed: false, current: 5, limit: 5, plan: 'starter' });

    const res = await POST(makeRequest({ body: { name: 'Acme', domain: 'acme.com' } }));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(body.error.message).toContain('starter');
    expect(body.error.message).toContain('5');
    expect(createSite).not.toHaveBeenCalled();
  });

  it('checks plan limit against the resolved org id', async () => {
    await POST(makeRequest({ body: { name: 'Acme', domain: 'acme.com' } }));
    expect(checkPlanLimit).toHaveBeenCalledWith(ORG_ID, 'sites');
  });

  it('returns 201 and lowercases the domain on success', async () => {
    const res = await POST(makeRequest({ body: { name: 'Acme', domain: 'Acme.COM' } }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.domain).toBe('acme.com');
    expect(body.data.organizationId).toBe(ORG_ID);
    expect(createSite).toHaveBeenCalledTimes(1);
  });

  it('propagates the actor-resolution failure response without creating a site', async () => {
    const unauthorized = new Response(
      JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'no' } }),
      { status: 401 },
    );
    resolveZybitActor.mockResolvedValueOnce({ ok: false, response: unauthorized });

    const res = await POST(makeRequest({ body: { name: 'Acme', domain: 'acme.com' } }));

    expect(res.status).toBe(401);
    expect(createSite).not.toHaveBeenCalled();
    expect(checkPlanLimit).not.toHaveBeenCalled();
  });

  it('returns the scope-error response without checking plan limit when API key lacks scope', async () => {
    const forbidden = new Response(
      JSON.stringify({ success: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'no' } }),
      { status: 401 },
    );
    assertApiKeyHasScope.mockReturnValueOnce(forbidden);

    const res = await POST(makeRequest({ body: { name: 'Acme', domain: 'acme.com' } }));

    expect(res.status).toBe(401);
    expect(checkPlanLimit).not.toHaveBeenCalled();
    expect(createSite).not.toHaveBeenCalled();
  });
});

describe('GET /api/phase1/sites', () => {
  it('returns 200 with the listed sites', async () => {
    listSites.mockResolvedValueOnce([{ id: 's1', name: 'Acme', domain: 'acme.com' }]);

    const res = await GET(makeRequest({ method: 'GET', body: undefined }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(listSites).toHaveBeenCalledWith({ organizationId: ORG_ID, limit: 50 });
  });

  it('respects the `limit` query param, capped at 200', async () => {
    await GET(
      makeRequest({
        method: 'GET',
        body: undefined,
        url: 'https://app.example.com/api/phase1/sites?limit=9999',
      }),
    );
    expect(listSites).toHaveBeenCalledWith({ organizationId: ORG_ID, limit: 200 });
  });
});

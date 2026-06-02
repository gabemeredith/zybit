import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructEvent = vi.fn();
const planIdFromStripePriceId = vi.fn();
const isValidPlanId = vi.fn();
const dbSelectLimit = vi.fn();
const dbUpdateSet = vi.fn();

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...args: unknown[]) => constructEvent(...args) },
  }),
}));

vi.mock('@/lib/billing/plans', () => ({
  planIdFromStripePriceId: (...args: unknown[]) => planIdFromStripePriceId(...args),
  isValidPlanId: (...args: unknown[]) => isValidPlanId(...args),
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => dbSelectLimit(),
        }),
      }),
    }),
    update: () => ({
      set: (vals: unknown) => {
        dbUpdateSet(vals);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
}));

import { POST } from '../route';

function makeRequest(
  rawBody: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://app.example.com/api/billing/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

const ORG_ID = 'org-1';

beforeEach(() => {
  constructEvent.mockReset();
  planIdFromStripePriceId.mockReset();
  isValidPlanId.mockReset();
  dbSelectLimit.mockReset();
  dbUpdateSet.mockReset();

  isValidPlanId.mockReturnValue(true);
  dbSelectLimit.mockResolvedValue([{ id: ORG_ID }]);
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('POST /api/billing/webhook', () => {
  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(500);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when the stripe-signature header is missing', async () => {
    const res = await POST(makeRequest('{}'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('stripe-signature');
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when signature verification throws', async () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'bogus-sig' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No signatures');
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it('persists the plan + customer id on checkout.session.completed', async () => {
    constructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { orgId: ORG_ID, planId: 'growth' },
        },
      },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    expect(dbUpdateSet).toHaveBeenCalledTimes(1);
    const setArgs = dbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.plan).toBe('growth');
    expect(setArgs.stripeCustomerId).toBe('cus_123');
    expect(setArgs.stripeSubscriptionId).toBe('sub_123');
    expect(setArgs.planUpdatedAt).toBeInstanceOf(Date);
  });

  it('does NOT persist when checkout metadata has an invalid planId', async () => {
    isValidPlanId.mockReturnValueOnce(false);
    constructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { orgId: ORG_ID, planId: 'enterprise' },
        },
      },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it('updates the plan on customer.subscription.updated when the price maps to a known plan', async () => {
    planIdFromStripePriceId.mockReturnValueOnce('scale');
    constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_123',
          items: { data: [{ price: { id: 'price_scale_monthly' } }] },
        },
      },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    expect(planIdFromStripePriceId).toHaveBeenCalledWith('price_scale_monthly');
    expect(dbUpdateSet).toHaveBeenCalledTimes(1);
    const setArgs = dbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.plan).toBe('scale');
    expect(setArgs.stripePriceId).toBe('price_scale_monthly');
    expect(setArgs.stripeSubscriptionId).toBe('sub_abc');
  });

  it('skips the write on customer.subscription.updated when the price does not map to a known plan', async () => {
    planIdFromStripePriceId.mockReturnValueOnce(null);
    constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_123',
          items: { data: [{ price: { id: 'price_unknown' } }] },
        },
      },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it('downgrades to starter and clears subscription ids on customer.subscription.deleted', async () => {
    constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_123',
        },
      },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    expect(dbUpdateSet).toHaveBeenCalledTimes(1);
    const setArgs = dbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.plan).toBe('starter');
    expect(setArgs.stripeSubscriptionId).toBeNull();
    expect(setArgs.stripePriceId).toBeNull();
  });

  it('returns 200 received:true and writes nothing for unhandled event types', async () => {
    constructEvent.mockReturnValueOnce({
      type: 'invoice.payment_succeeded',
      data: { object: {} },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });

  it('no-ops when the org for the customer id is not found', async () => {
    dbSelectLimit.mockResolvedValueOnce([]);
    constructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_abc', customer: 'cus_unknown' } },
    });

    const res = await POST(makeRequest('{}', { 'stripe-signature': 'sig' }));

    expect(res.status).toBe(200);
    expect(dbUpdateSet).not.toHaveBeenCalled();
  });
});

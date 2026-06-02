import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveZybitActor = vi.fn();
const getOrCreateStripeCustomer = vi.fn();
const stripeCheckoutCreate = vi.fn();
const stripePriceIdForPlan = vi.fn();

vi.mock('@/lib/auth/actor', () => ({
  resolveZybitActor: (...args: unknown[]) => resolveZybitActor(...args),
}));

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: (...args: unknown[]) => stripeCheckoutCreate(...args) } },
  }),
  getOrCreateStripeCustomer: (...args: unknown[]) => getOrCreateStripeCustomer(...args),
}));

vi.mock('@/lib/billing/plans', () => ({
  stripePriceIdForPlan: (...args: unknown[]) => stripePriceIdForPlan(...args),
}));

process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

import { POST } from '../route';

const ORG_ID = 'org-1';

function makeRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveZybitActor.mockReset();
  getOrCreateStripeCustomer.mockReset();
  stripeCheckoutCreate.mockReset();
  stripePriceIdForPlan.mockReset();

  resolveZybitActor.mockResolvedValue({
    ok: true,
    actor: { kind: 'session', organizationId: ORG_ID, userId: 'user-1' },
  });
  getOrCreateStripeCustomer.mockResolvedValue('cus_test_123');
  stripePriceIdForPlan.mockReturnValue('price_test_growth');
  stripeCheckoutCreate.mockResolvedValue({ url: 'https://stripe.example/checkout/abc' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/billing/checkout', () => {
  it('returns 400 on a non-JSON body', async () => {
    const res = await POST(makeRequest('not-json'));
    expect(res.status).toBe(400);
    expect(stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when planId is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when planId is not in the allowed enum', async () => {
    const res = await POST(makeRequest({ planId: 'enterprise' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/starter, growth, scale/);
    expect(stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it('accepts the three valid plan ids', async () => {
    for (const planId of ['starter', 'growth', 'scale'] as const) {
      const res = await POST(makeRequest({ planId }));
      expect(res.status).toBe(200);
    }
    expect(stripeCheckoutCreate).toHaveBeenCalledTimes(3);
  });

  it('returns 400 when no Stripe price is configured for the requested plan', async () => {
    stripePriceIdForPlan.mockReturnValueOnce(null);

    const res = await POST(makeRequest({ planId: 'growth' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('No Stripe price configured');
    expect(stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it('forwards the actor-resolution failure response without contacting Stripe', async () => {
    const unauthorized = new Response(
      JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'no' } }),
      { status: 401 },
    );
    resolveZybitActor.mockResolvedValueOnce({ ok: false, response: unauthorized });

    const res = await POST(makeRequest({ planId: 'growth' }));

    expect(res.status).toBe(401);
    expect(getOrCreateStripeCustomer).not.toHaveBeenCalled();
    expect(stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it('creates a subscription Checkout session with org-scoped metadata and returns the URL', async () => {
    const res = await POST(makeRequest({ planId: 'growth' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toBe('https://stripe.example/checkout/abc');

    expect(stripeCheckoutCreate).toHaveBeenCalledTimes(1);
    const args = stripeCheckoutCreate.mock.calls[0][0] as {
      customer: string;
      mode: string;
      line_items: { price: string; quantity: number }[];
      success_url: string;
      cancel_url: string;
      metadata: { orgId: string; planId: string };
    };
    expect(args.customer).toBe('cus_test_123');
    expect(args.mode).toBe('subscription');
    expect(args.line_items).toEqual([{ price: 'price_test_growth', quantity: 1 }]);
    expect(args.success_url).toBe('https://app.example.com/app/settings?checkout=success');
    expect(args.cancel_url).toBe('https://app.example.com/app/settings?checkout=cancel');
    expect(args.metadata).toEqual({ orgId: ORG_ID, planId: 'growth' });
  });
});

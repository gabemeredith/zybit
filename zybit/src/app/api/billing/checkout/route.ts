/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout session for the requested plan.
 * Returns { url } the client can redirect to.
 */

import { z } from 'zod';
import { resolveZybitActor } from '@/lib/auth/actor';
import { getStripe, getOrCreateStripeCustomer } from '@/lib/billing/stripe';
import { stripePriceIdForPlan } from '@/lib/billing/plans';
import { badRequest, mapRouteError, success } from '@/app/api/phase1/_shared';

const bodySchema = z.object({
  planId: z.enum(['starter', 'growth', 'scale']),
});

export async function POST(request: Request) {
  try {
    const actorResult = await resolveZybitActor(request);
    if (!actorResult.ok) return actorResult.response;

    const orgId = actorResult.actor.organizationId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Request body must be valid JSON.');
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(`Invalid planId. Must be one of: starter, growth, scale.`);
    }

    const { planId } = parsed.data;
    const priceId = stripePriceIdForPlan(planId);
    if (!priceId) {
      return badRequest(`No Stripe price configured for plan "${planId}". Check environment variables.`);
    }

    const customerId = await getOrCreateStripeCustomer(orgId);
    const stripe = getStripe();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      throw new Error('NEXT_PUBLIC_APP_URL is not set in the environment');
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/settings?checkout=success`,
      cancel_url: `${appUrl}/app/settings?checkout=cancel`,
      metadata: { orgId, planId },
    });

    return success({ url: session.url });
  } catch (error) {
    return mapRouteError(error);
  }
}

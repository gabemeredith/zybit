/**
 * POST /api/billing/webhook
 *
 * Stripe webhook handler. NO Clerk auth — uses Stripe signature verification.
 * Handles subscription lifecycle events and keeps org plan in sync.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getStripe } from '@/lib/billing/stripe';
import { planIdFromStripePriceId, isValidPlanId } from '@/lib/billing/plans';
import { getDb } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import type Stripe from 'stripe';

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Webhook secret not configured.' },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const db = getDb();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id;
      const planId = session.metadata?.planId;
      const orgId = session.metadata?.orgId;

      if (orgId && planId && isValidPlanId(planId) && customerId) {
        const [org] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (org) {
          const subscriptionId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id ?? null;

          await db
            .update(organizations)
            .set({
              plan: planId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              planUpdatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;

      if (customerId) {
        const priceId = subscription.items.data[0]?.price?.id;
        const newPlan = priceId ? planIdFromStripePriceId(priceId) : null;

        if (newPlan) {
          const [org] = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.stripeCustomerId, customerId))
            .limit(1);

          if (org) {
            await db
              .update(organizations)
              .set({
                plan: newPlan,
                stripePriceId: priceId,
                stripeSubscriptionId: subscription.id,
                planUpdatedAt: new Date(),
              })
              .where(eq(organizations.id, org.id));
          }
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;

      if (customerId) {
        const [org] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.stripeCustomerId, customerId))
          .limit(1);

        if (org) {
          await db
            .update(organizations)
            .set({
              plan: 'starter',
              stripeSubscriptionId: null,
              stripePriceId: null,
              planUpdatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));
        }
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}

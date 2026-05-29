/**
 * Free-experiment gate — the "one experiment per company, then a wall" rule
 * (docs/sprints/free-experiment-loop.md §6).
 *
 * This is the pure decision: given whether an org has paid and whether it has
 * already claimed its free experiment, may it launch one now? It deliberately
 * holds NO database or Stripe access so it can be unit-tested in isolation and
 * reused from any call site.
 *
 * Model:
 *   - A *paid* org (active Stripe subscription) is governed by the normal plan
 *     limits in `checkPlanLimit`, not by this gate — it returns `allowed: true`
 *     with reason `paid` so the caller falls through to plan enforcement.
 *   - An *unpaid* org (the free on-ramp) gets exactly ONE experiment. Before it
 *     has claimed it (`freeExperimentUsedAt` null) the slot is available; once
 *     claimed, a second launch is blocked and the caller shows the upgrade
 *     moment.
 *
 * Paid is detected by the presence of a Stripe subscription
 * (`organizations.stripe_subscription_id`); see `loadFreeExperimentGate`.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';

export interface FreeExperimentGateInput {
  /**
   * True when the org has a live paid subscription. The caller computes this;
   * the natural signal is `organizations.stripe_subscription_id != null`, but
   * that is the open billing-model question (today every org defaults to
   * plan `starter` with no subscription, so plan alone cannot distinguish a
   * free on-ramp org from a paying one — the subscription id can).
   */
  hasActiveSubscription: boolean;
  /** When the org claimed its single free experiment, or null if never. */
  freeExperimentUsedAt: Date | null;
}

export type FreeExperimentGateReason =
  | 'paid' // active subscription — this gate doesn't apply, plan limits do
  | 'free-slot-available' // unpaid, hasn't used its free experiment yet
  | 'free-slot-used'; // unpaid, already used its one free experiment → upgrade

export interface FreeExperimentGateResult {
  allowed: boolean;
  reason: FreeExperimentGateReason;
}

export function checkFreeExperimentGate(
  input: FreeExperimentGateInput,
): FreeExperimentGateResult {
  if (input.hasActiveSubscription) {
    return { allowed: true, reason: 'paid' };
  }
  if (input.freeExperimentUsedAt === null) {
    return { allowed: true, reason: 'free-slot-available' };
  }
  return { allowed: false, reason: 'free-slot-used' };
}

/**
 * Read an org's payment + free-slot state and evaluate the gate. "Paid" = the
 * org has a Stripe subscription id (written by the billing webhook). A missing
 * org row fails open to unpaid/available so a data glitch never hard-blocks a
 * launch. No side effects — call before claiming.
 */
export async function loadFreeExperimentGate(
  orgId: string,
): Promise<FreeExperimentGateResult> {
  const db = getDb();
  const [org] = await db
    .select({
      stripeSubscriptionId: organizations.stripeSubscriptionId,
      freeExperimentUsedAt: organizations.freeExperimentUsedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return checkFreeExperimentGate({
    hasActiveSubscription: Boolean(org?.stripeSubscriptionId),
    freeExperimentUsedAt: org?.freeExperimentUsedAt ?? null,
  });
}

/**
 * Atomically claim the org's single free-experiment slot. Returns true iff THIS
 * call won the claim. The `IS NULL` guard makes concurrent launches race-safe:
 * only the first UPDATE flips the column; the rest match 0 rows and return
 * false. Only call for an unpaid org whose gate reason is 'free-slot-available'
 * — a paid org must never have its slot consumed.
 */
export async function claimFreeExperimentSlot(orgId: string, at: Date): Promise<boolean> {
  const db = getDb();
  const claimed = await db
    .update(organizations)
    .set({ freeExperimentUsedAt: at })
    .where(and(eq(organizations.id, orgId), isNull(organizations.freeExperimentUsedAt)))
    .returning({ id: organizations.id });
  return claimed.length > 0;
}

/**
 * Plan limit enforcement — checks whether an org can use a resource.
 */

import { eq, and, count } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { organizations, phase1Sites, zybitExperiments, zybitUsage } from '@/lib/db/schema';
import { PLAN_LIMITS, type PlanId, isValidPlanId } from './plans';

export interface PlanLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  plan: string;
}

/**
 * Read the org's current plan from Postgres. Deliberately uncached: the
 * Stripe webhook that writes `organizations.plan` runs in a different
 * serverless instance than the request that enforces the limit, so an
 * in-process cache would serve a stale plan for minutes after an
 * upgrade/downgrade. This is a single indexed PK lookup, hit only at
 * enforcement boundaries (site/experiment creation, the usage endpoint),
 * not a hot path. Unknown/garbage plan values fail safe to `starter`
 * (the most restrictive tier).
 */
async function getOrgPlan(orgId: string): Promise<PlanId> {
  const db = getDb();
  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return org && isValidPlanId(org.plan) ? org.plan : 'starter';
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function checkPlanLimit(
  orgId: string,
  resource: 'sites' | 'events' | 'experiments'
): Promise<PlanLimitResult> {
  const plan = await getOrgPlan(orgId);
  const limits = PLAN_LIMITS[plan];

  const db = getDb();

  switch (resource) {
    case 'sites': {
      const [result] = await db
        .select({ total: count() })
        .from(phase1Sites)
        .where(eq(phase1Sites.organizationId, orgId));
      const current = result?.total ?? 0;
      return {
        allowed: current < limits.sites,
        current,
        limit: limits.sites,
        plan,
      };
    }

    case 'events': {
      const period = currentPeriod();
      const [result] = await db
        .select({ total: zybitUsage.eventsIngested })
        .from(zybitUsage)
        .where(
          and(
            eq(zybitUsage.organizationId, orgId),
            eq(zybitUsage.period, period)
          )
        )
        .limit(1);
      const current = result?.total ?? 0;
      return {
        allowed: current < limits.eventsPerMonth,
        current,
        limit: limits.eventsPerMonth,
        plan,
      };
    }

    case 'experiments': {
      const [result] = await db
        .select({ total: count() })
        .from(zybitExperiments)
        .where(
          and(
            eq(zybitExperiments.organizationId, orgId),
            eq(zybitExperiments.status, 'running')
          )
        );
      const current = result?.total ?? 0;
      return {
        allowed: current < limits.concurrentExperiments,
        current,
        limit: limits.concurrentExperiments,
        plan,
      };
    }
  }
}

/**
 * Provision a lighthouse_*-prefixed organization, site, site config, and
 * (optionally) a PostHog integration row.
 *
 * Idempotent: re-running with the same slug is safe.
 *  - organization + site rows: onConflictDoNothing (preserve original
 *    createdAt).
 *  - site config: onConflictDoUpdate so the latest manifest config wins
 *    on re-seed (it's effectively the "current" config).
 *  - integration: upsert by (siteId, provider).
 *
 * Imports Zybit's `getDb()` and Drizzle schema directly. No code is
 * duplicated from Zybit.
 */

import { getDb } from '@/lib/db/client';
import {
  organizations,
  phase1Sites,
  phase2Integrations,
  phase2SiteConfigs,
} from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import type {
  CohortDimensionConfig,
  CtaConfig,
  GoalConfig,
  GoalType,
  NarrativeConfig,
  OnboardingStepConfig,
} from '@/lib/phase2/types';

export interface LighthouseSiteInput {
  slug: string;
  displayName: string;
  domain: string;
  plan?: string;
  config?: {
    cohortDimensions?: CohortDimensionConfig[];
    onboardingSteps?: OnboardingStepConfig[];
    ctas?: CtaConfig[];
    narratives?: NarrativeConfig[];
    conversionEventTypes?: string[];
    goalType?: GoalType;
    goalConfig?: GoalConfig;
  };
  integration?: {
    provider: 'posthog' | 'segment' | 'ga4';
    config?: Record<string, unknown>;
    secretRef?: string;
  };
}

export interface ProvisionResult {
  organizationId: string;
  siteId: string;
}

export function orgIdFor(slug: string): string {
  return `lighthouse_org_${slug}`;
}
export function siteIdFor(slug: string): string {
  return `lighthouse_site_${slug}`;
}

export async function provisionLighthouseSite(
  input: LighthouseSiteInput,
): Promise<ProvisionResult> {
  const db = getDb();
  const organizationId = orgIdFor(input.slug);
  const siteId = siteIdFor(input.slug);

  await db
    .insert(organizations)
    .values({
      id: organizationId,
      name: `Lighthouse — ${input.displayName}`,
      plan: input.plan ?? 'starter',
    })
    .onConflictDoNothing({ target: organizations.id });

  await db
    .insert(phase1Sites)
    .values({
      id: siteId,
      organizationId,
      name: input.displayName,
      domain: input.domain,
    })
    .onConflictDoNothing({ target: phase1Sites.id });

  const cfg = input.config ?? {};
  await db
    .insert(phase2SiteConfigs)
    .values({
      siteId,
      organizationId,
      cohortDimensions: cfg.cohortDimensions ?? [],
      onboardingSteps: cfg.onboardingSteps ?? [],
      ctas: cfg.ctas ?? [],
      narratives: cfg.narratives ?? [],
      conversionEventTypes: cfg.conversionEventTypes ?? null,
    })
    .onConflictDoUpdate({
      target: phase2SiteConfigs.siteId,
      set: {
        cohortDimensions: cfg.cohortDimensions ?? [],
        onboardingSteps: cfg.onboardingSteps ?? [],
        ctas: cfg.ctas ?? [],
        narratives: cfg.narratives ?? [],
        conversionEventTypes: cfg.conversionEventTypes ?? null,
        updatedAt: sql`now()`,
      },
    });

  if (input.integration) {
    await db
      .insert(phase2Integrations)
      .values({
        id: `lighthouse_integration_${input.slug}_${input.integration.provider}`,
        organizationId,
        siteId,
        provider: input.integration.provider,
        status: 'connected',
        config: input.integration.config ?? {},
        secretRef: input.integration.secretRef ?? null,
      })
      .onConflictDoUpdate({
        target: [phase2Integrations.siteId, phase2Integrations.provider],
        set: {
          status: 'connected',
          config: input.integration.config ?? {},
          secretRef: input.integration.secretRef ?? null,
          updatedAt: sql`now()`,
        },
      });
  }

  return { organizationId, siteId };
}

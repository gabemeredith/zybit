"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import { encryptSecret } from "@/lib/crypto/secrets";
import { getDb } from "@/lib/db/client";
import { zybitSiteMeta } from "@/lib/db/schema";
import type { Phase1SiteRecord } from "@/lib/phase1";
import type { ConnectorProvider, IntegrationRecord } from "@/lib/phase2/connectors/types";
import { computeFlowPreflight } from "@/lib/phase2/flow";
import type { PreflightReport } from "@/lib/phase2/flow";

// ---------------------------------------------------------------------------
// Step 1: Create (or return existing) site
// ---------------------------------------------------------------------------

export async function createSiteAction(
  domain: string,
  name: string,
): Promise<{ ok: true; site: Phase1SiteRecord } | { ok: false; error: string }> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const normalizedDomain = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!normalizedDomain) return { ok: false, error: "Enter a valid domain." };

  const repository = createPhase1Repository();

  // One org = one site for pilots: return existing if present
  const existing = await repository.listSites({ organizationId: auth.orgId, limit: 1 });
  if (existing[0]) return { ok: true, site: existing[0] };

  const site = await repository.createSite({
    id: randomUUID(),
    organizationId: auth.orgId,
    name: name.trim() || normalizedDomain,
    domain: normalizedDomain,
    createdAt: new Date().toISOString(),
  });

  return { ok: true, site };
}

// ---------------------------------------------------------------------------
// Step 2 (proxy slug + DNS) lives in proxyActions.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 3: Connect analytics integration
// ---------------------------------------------------------------------------

export interface CreateIntegrationPayload {
  siteId: string;
  provider: ConnectorProvider;
  /** For PostHog: full URL e.g. https://app.posthog.com */
  host?: string;
  /** For PostHog: project ID */
  projectId?: string;
  /** Plain-text API key — will be encrypted before storage */
  apiKey: string;
}

export async function createIntegrationAction(
  payload: CreateIntegrationPayload,
): Promise<{ ok: true; integration: IntegrationRecord } | { ok: false; error: string }> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  let apiKeyEncrypted: string;
  try {
    apiKeyEncrypted = encryptSecret(payload.apiKey);
  } catch {
    return {
      ok: false,
      error: "Server is not configured for encrypted key storage. Contact support.",
    };
  }

  const config: Record<string, unknown> = { apiKeyEncrypted };
  if (payload.host) config.host = payload.host;
  if (payload.projectId) config.projectId = payload.projectId;

  const repository = createPhase1Repository();

  // Delete any existing integration for this provider (idempotent re-connect)
  const existing = await repository.listIntegrations({
    organizationId: auth.orgId,
    siteId: payload.siteId,
    provider: payload.provider,
  });

  const integration = existing[0]
    ? existing[0]
    : await repository.createIntegration({
        id: randomUUID(),
        organizationId: auth.orgId,
        siteId: payload.siteId,
        provider: payload.provider,
        config,
        secretRef: null,
        createdAt: new Date().toISOString(),
      });

  return { ok: true, integration };
}

// ---------------------------------------------------------------------------
// Post-connect verification: does the connected analytics already carry enough
// signal to render an informative flow graph? PRD §5's one hard dependency.
// ---------------------------------------------------------------------------

const PREFLIGHT_WINDOW_DAYS = 7;
const PREFLIGHT_EVENT_LIMIT = 20_000;

export async function runFlowPreflightAction(
  siteId: string,
): Promise<{ ok: true; report: PreflightReport } | { ok: false; error: string }> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const end = new Date();
  const start = new Date(end.getTime() - PREFLIGHT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowStart = start.toISOString();
  const windowEnd = end.toISOString();

  try {
    const repository = createPhase1Repository();
    const events = await repository.listEventsInWindow({
      organizationId: auth.orgId,
      siteId,
      window: { start: windowStart, end: windowEnd },
      limit: PREFLIGHT_EVENT_LIMIT,
    });
    const report = computeFlowPreflight({ events, windowStart, windowEnd });
    return { ok: true, report };
  } catch {
    return { ok: false, error: "Could not read events for this site. Try again in a moment." };
  }
}

// ---------------------------------------------------------------------------
// Step 4: Save revenue context (unlock dollar-impact findings)
// ---------------------------------------------------------------------------

export async function saveSiteMetaAction(
  siteId: string,
  monthlyRevenueCents: number | null,
  avgOrderValueCents: number | null,
): Promise<void> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const db = getDb();
  await db
    .insert(zybitSiteMeta)
    .values({
      siteId,
      organizationId: auth.orgId,
      monthlyRevenueCents,
      avgOrderValueCents,
    })
    .onConflictDoUpdate({
      target: zybitSiteMeta.siteId,
      set: {
        monthlyRevenueCents,
        avgOrderValueCents,
        updatedAt: new Date(),
      },
    });
}

"use server";

import { promises as dns } from "node:dns";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Resend } from "resend";

import { getServerAuth } from "@/lib/auth/serverAuth";
import { getDb } from "@/lib/db/client";
import { phase1Sites } from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { isValidSlug, suggestAlternativeSlug } from "@/lib/experiments/proxy/slug";
import { addCustomerDomain } from "@/lib/experiments/proxy/vercelDomains";

const SERVICE = "proxy" as const;

// ---------------------------------------------------------------------------
// saveProxySetupAction
// ---------------------------------------------------------------------------

export type SaveProxySetupResult =
  | { ok: true }
  | { ok: false; error: "invalid_slug" | "slug_taken" | "not_found" | "internal"; reason?: string; suggestion?: string };

/**
 * Set proxy_slug + customer_subdomain on a site row. Returns a structured error
 * with a suggested alternative slug on uniqueness collision. Fires a Resend
 * email to the founder so they can add the customer subdomain in Vercel.
 */
export async function saveProxySetupAction(
  siteId: string,
  proxySlug: string,
  customerSubdomain: string,
): Promise<SaveProxySetupResult> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const slug = proxySlug.trim().toLowerCase();
  const subdomain = customerSubdomain.trim().toLowerCase();

  const validation = isValidSlug(slug);
  if (!validation.ok) {
    return { ok: false, error: "invalid_slug", reason: validation.reason };
  }
  if (!subdomain || !subdomain.includes(".")) {
    return { ok: false, error: "invalid_slug", reason: "Enter the full customer subdomain (e.g. experiments.acme.com)." };
  }

  const db = getDb();

  try {
    const updated = await db
      .update(phase1Sites)
      .set({ proxySlug: slug, customerSubdomain: subdomain })
      .where(
        and(eq(phase1Sites.id, siteId), eq(phase1Sites.organizationId, auth.orgId)),
      )
      .returning({ id: phase1Sites.id, domain: phase1Sites.domain });

    if (updated.length === 0) {
      return { ok: false, error: "not_found" };
    }

    const vercelResult = await addCustomerDomain(subdomain);
    if (!vercelResult.ok) {
      logger.warn("Vercel domain auto-provision failed — falling back to manual email", {
        service: SERVICE,
        customerSubdomain: subdomain,
        error: vercelResult.error,
      });
    } else {
      logger.info("Vercel domain auto-provision succeeded", {
        service: SERVICE,
        customerSubdomain: subdomain,
      });
    }

    await sendProxySetupAlert({
      customerDomain: updated[0].domain,
      customerSubdomain: subdomain,
      proxySlug: slug,
      orgId: auth.orgId,
    });

    return { ok: true };
  } catch (err) {
    // Postgres unique-constraint violation on phase1_sites_proxy_slug_idx.
    const code = (err as { code?: string } | undefined)?.code;
    if (code === "23505") {
      const suggestion = await pickFreeSlug(slug);
      return { ok: false, error: "slug_taken", suggestion };
    }
    logger.error("saveProxySetupAction failed", {
      service: SERVICE,
      siteId,
      organizationId: auth.orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "internal" };
  }
}

/**
 * Query existing slugs that start with the same base and pick the next free one.
 * O(1) round-trip — we only need the small set that could possibly collide.
 */
async function pickFreeSlug(requested: string): Promise<string> {
  const db = getDb();
  const candidates: string[] = [requested];
  for (let i = 2; i < 100; i += 1) candidates.push(`${requested}-${i}`);

  const rows = await db
    .select({ proxySlug: phase1Sites.proxySlug })
    .from(phase1Sites)
    .where(inArray(phase1Sites.proxySlug, candidates));

  const taken = new Set<string>();
  for (const row of rows) {
    if (row.proxySlug) taken.add(row.proxySlug);
  }
  return suggestAlternativeSlug(requested, taken);
}

// ---------------------------------------------------------------------------
// verifyProxyDnsAction
// ---------------------------------------------------------------------------

export type VerifyProxyDnsResult = {
  resolved: boolean;
  expected: string;
  target?: string;
  error?: "not_configured" | "timeout" | "nxdomain" | "mismatch";
  /** True when an HTTPS HEAD to the customer subdomain returned a non-error status. */
  proxyLive?: boolean;
};

/** HEAD `https://{host}` with a 5 s timeout. Returns true if status < 500. */
async function probeHttps(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}`, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Resolve the customer's CNAME and compare to <proxy_slug>.zybit.run. Returns
 * structured outcome so the UI can render a precise failure message.
 *
 * Runs server-side in the Node runtime (server actions default to Node).
 */
export async function verifyProxyDnsAction(siteId: string): Promise<VerifyProxyDnsResult> {
  const auth = await getServerAuth();
  if (!auth.ok) redirect("/sign-in");

  const db = getDb();
  const [site] = await db
    .select({
      proxySlug: phase1Sites.proxySlug,
      customerSubdomain: phase1Sites.customerSubdomain,
    })
    .from(phase1Sites)
    .where(and(eq(phase1Sites.id, siteId), eq(phase1Sites.organizationId, auth.orgId)))
    .limit(1);

  const expected = site?.proxySlug ? `${site.proxySlug}.zybit.run` : "";
  if (!site || !site.proxySlug || !site.customerSubdomain) {
    return { resolved: false, expected, error: "not_configured" };
  }

  try {
    const records = await Promise.race<string[]>([
      dns.resolveCname(site.customerSubdomain),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000),
      ),
    ]);
    const target = records[0]?.toLowerCase().replace(/\.$/, "");
    if (!target) {
      return { resolved: false, expected, error: "nxdomain" };
    }
    if (target !== expected.toLowerCase()) {
      return { resolved: false, expected, target, error: "mismatch" };
    }

    // CNAME is correct — probe HTTPS to confirm TLS cert is provisioned and proxy is live.
    const proxyLive = await probeHttps(site.customerSubdomain);
    return { resolved: true, expected, target, proxyLive };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "timeout") return { resolved: false, expected, error: "timeout" };
    // dns.resolveCname throws on NXDOMAIN / no CNAME records.
    return { resolved: false, expected, error: "nxdomain" };
  }
}

// ---------------------------------------------------------------------------
// Founder alert email
// ---------------------------------------------------------------------------

interface ProxyAlertArgs {
  customerDomain: string;
  customerSubdomain: string;
  proxySlug: string;
  orgId: string;
}

async function sendProxySetupAlert(args: ProxyAlertArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const alertTo = process.env.ALERT_EMAIL_TO;
  if (!apiKey || !alertTo) {
    logger.warn("Skipping proxy setup alert — RESEND_API_KEY or ALERT_EMAIL_TO not set", {
      service: SERVICE,
      customerSubdomain: args.customerSubdomain,
    });
    return;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "Asad at Zybit <asad@getzybit.com>",
      to: alertTo,
      subject: `[Zybit] Add Vercel domain: ${args.customerSubdomain}`,
      text: [
        `A customer just completed proxy DNS setup. Add their subdomain to the Vercel project so we can issue a TLS cert.`,
        ``,
        `Customer apex:       ${args.customerDomain}`,
        `Customer subdomain:  ${args.customerSubdomain}     <-- add this in Vercel`,
        `Proxy slug:          ${args.proxySlug}`,
        `CNAME target:        ${args.proxySlug}.zybit.run`,
        `Organization:        ${args.orgId}`,
        ``,
        `Action: Vercel → Project → Domains → Add → ${args.customerSubdomain}`,
        `Once Vercel verifies the CNAME and issues the cert, the customer's traffic will route through our proxy.`,
      ].join("\n"),
    });
    logger.info("Proxy setup alert email sent", {
      service: SERVICE,
      customerSubdomain: args.customerSubdomain,
      proxySlug: args.proxySlug,
    });
  } catch (err) {
    logger.error("Failed to send proxy setup alert email", {
      service: SERVICE,
      customerSubdomain: args.customerSubdomain,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

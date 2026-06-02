/**
 * Vercel Domains API — automatically add a customer's subdomain to the Vercel
 * project so Vercel issues a TLS certificate. Runs after DNS verify passes.
 *
 * This makes the proxy work for ALL registrars (Cloudflare, GoDaddy, Route 53,
 * Namecheap, etc.) — the customer only needs to add a CNAME record. Vercel handles
 * the rest of the TLS provisioning automatically.
 *
 * Requires env vars (graceful no-op if absent — falls back to manual email):
 *   VERCEL_API_TOKEN    — Vercel API bearer token (from vercel.com/settings/tokens)
 *   VERCEL_PROJECT_ID   — Project ID for the proxy domain (from project settings)
 */

export interface AddDomainResult {
  ok: boolean;
  domain?: string;
  error?: string;
}

export async function addCustomerDomain(customerSubdomain: string): Promise<AddDomainResult> {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    return { ok: false, error: 'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set — skipping auto-provisioning' };
  }

  try {
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: customerSubdomain }),
    });

    const data = (await res.json()) as { error?: { code: string; message: string } };

    if (!res.ok) {
      const code = data.error?.code ?? 'UNKNOWN';
      const message = data.error?.message ?? res.statusText;
if (code === 'DOMAIN_ALREADY_EXISTS') {
         return { ok: true, domain: customerSubdomain };
       }
       return { ok: false, error: `[${code}] ${message}` };
    }

    return { ok: true, domain: customerSubdomain };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `fetch failed: ${message}` };
  }
}
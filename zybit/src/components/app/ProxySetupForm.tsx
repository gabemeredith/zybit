"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deriveSlugFromDomain } from "@/lib/experiments/proxy/slug";
import {
  saveProxySetupAction,
  verifyProxyDnsAction,
  type SaveProxySetupResult,
  type VerifyProxyDnsResult,
} from "@/app/app/onboarding/proxyActions";
import {
  PrimaryButton,
  SkipLink,
  FieldLabel,
  Input,
  CopyButton,
} from "./onboardingPrimitives";

/**
 * Quick-links to popular DNS providers' record-management pages. Each opens
 * the registrar's dashboard root (we can't deep-link without their account/zone
 * ID), but it gets the PM one click away from where they need to be.
 */
const REGISTRAR_LINKS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Cloudflare", url: "https://dash.cloudflare.com/" },
  { name: "GoDaddy", url: "https://dcc.godaddy.com/manage/dns" },
  { name: "Namecheap", url: "https://ap.www.namecheap.com/domains/list/" },
  { name: "Squarespace", url: "https://account.squarespace.com/domains/managed" },
  { name: "Vercel", url: "https://vercel.com/dashboard/domains" },
  { name: "Route 53", url: "https://console.aws.amazon.com/route53/v2/hostedzones" },
  { name: "Porkbun", url: "https://porkbun.com/account/domainsSpeedy" },
];

type Phase = "edit" | "saved" | "verifying" | "verified" | "verify_failed";

interface ProxySetupFormProps {
  siteId: string;
  /** The customer's apex domain, e.g. "acme.com". */
  domain: string;
  initialSlug?: string | null;
  initialSubdomain?: string | null;
  /** "wizard" shows the step header + skip link; "settings" omits both. */
  variant: "wizard" | "settings";
  /** Called after a successful save. Wizard advances; settings refreshes. */
  onSaved?: () => void;
  /** Wizard-only: skip the step without saving. */
  onSkip?: () => void;
}

export default function ProxySetupForm({
  siteId,
  domain,
  initialSlug,
  initialSubdomain,
  variant,
  onSaved,
  onSkip,
}: ProxySetupFormProps) {
  const [slug, setSlug] = useState(initialSlug ?? deriveSlugFromDomain(domain));
  const [customerSubdomain, setCustomerSubdomain] = useState(
    initialSubdomain ?? `experiments.${domain}`,
  );
  const [phase, setPhase] = useState<Phase>(initialSlug ? "saved" : "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ reason: string; suggestion?: string } | null>(null);
  const [dnsResult, setDnsResult] = useState<VerifyProxyDnsResult | null>(null);
  const router = useRouter();

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const result: SaveProxySetupResult = await saveProxySetupAction(
        siteId,
        slug.trim().toLowerCase(),
        customerSubdomain.trim().toLowerCase(),
      );
      if (!result.ok) {
        if (result.error === "slug_taken") {
          setError({
            reason: `"${slug}" is taken.`,
            suggestion: result.suggestion,
          });
        } else if (result.error === "invalid_slug") {
          setError({ reason: result.reason ?? "Invalid slug or subdomain." });
        } else if (result.error === "not_found") {
          setError({ reason: "Site not found. Refresh and try again." });
        } else {
          setError({ reason: "Something went wrong. Try again." });
        }
        return;
      }
      setPhase("saved");
      if (variant === "settings") router.refresh();
      // wizard advances via onSaved
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setPhase("verifying");
    const result = await verifyProxyDnsAction(siteId);
    setDnsResult(result);
    setPhase(result.resolved ? "verified" : "verify_failed");
  }

  function applySuggestion() {
    if (!error?.suggestion) return;
    setSlug(error.suggestion);
    setError(null);
  }

  const cnameHost = customerSubdomain.split(".")[0] || "experiments";
  const cnameValue = `${slug || "<slug>"}.zybit.run`;
  const cnameSnippet =
    `Type: CNAME    Host: ${cnameHost}    Value: ${cnameValue}`;

  return (
    <div>
      {variant === "wizard" && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-2">
            Step 2 of 4
          </div>
          <h1 className="text-4xl font-bold tracking-tighter text-[#111] mb-2 leading-[0.95]">
            Connect your<br />domain.
          </h1>
        </>
      )}
      <p className="text-[#6B6B6B] text-sm mb-10 leading-relaxed max-w-lg">
        Zybit deploys experiments through a reverse proxy at{" "}
        <code className="font-mono text-xs bg-black/[0.05] px-1.5 py-0.5 rounded">
          {slug || "<slug>"}.zybit.run
        </code>
        . Point a CNAME from your domain so visitors hit Zybit transparently — no code change to your site.
      </p>

      <div className="space-y-8 max-w-lg">
        {/* Slug field */}
        <div>
          <FieldLabel label="Proxy slug" />
          <div className="flex items-stretch">
            <div className="flex-1">
              <Input
                value={slug}
                onChange={(v) => { setSlug(v); setError(null); }}
                placeholder="acme"
              />
            </div>
            <div className="ml-2 self-stretch flex items-center text-sm text-[#6B6B6B] font-mono px-3 border border-black/[0.08] rounded-lg bg-black/[0.02]">
              .zybit.run
            </div>
          </div>
          {error && (
            <div className="mt-2 text-sm text-red-600">
              {error.reason}
              {error.suggestion && (
                <>
                  {" "}Use{" "}
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="font-bold underline underline-offset-2 hover:text-red-800"
                  >
                    {error.suggestion}
                  </button>
                  ?
                </>
              )}
            </div>
          )}
        </div>

        {/* Customer subdomain field */}
        <div>
          <FieldLabel label="Customer subdomain (the URL visitors will hit)" />
          <Input
            value={customerSubdomain}
            onChange={setCustomerSubdomain}
            placeholder={`experiments.${domain}`}
          />
          <p className="text-xs text-[#9B9B9B] mt-2">
            Recommended: <code className="font-mono">experiments.{domain}</code>. Pick anything you can configure DNS for.
          </p>
        </div>

        {/* CNAME instruction */}
        <div>
          <FieldLabel label="DNS record to add at your registrar" />

          {/* Field-by-field record display, easier to map onto any registrar's DNS form */}
          <div className="bg-[#F5F5F3] border border-black/[0.08] rounded-xl overflow-hidden">
            <div className="flex justify-end px-3 pt-3">
              <CopyButton text={cnameSnippet} />
            </div>
            <div className="grid grid-cols-3 divide-x divide-black/[0.06]">
              <div className="px-5 pt-3 pb-5">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#9B9B9B] mb-2">Type</div>
                <div className="font-mono text-sm text-[#111]">CNAME</div>
              </div>
              <div className="px-5 pt-3 pb-5">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#9B9B9B] mb-2">Host / Name</div>
                <div className="font-mono text-sm text-[#111] break-all">{cnameHost}</div>
              </div>
              <div className="px-5 pt-3 pb-5">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#9B9B9B] mb-2">Value / Target</div>
                <div className="font-mono text-sm text-[#111] break-all">{cnameValue}</div>
              </div>
            </div>
          </div>

          {/* Numbered steps — generic, applies to any registrar */}
          <div className="mt-8 text-sm text-[#444] leading-relaxed">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">How to add this</p>
            <ol className="list-decimal list-inside space-y-3 text-[#444]">
              <li>Open your domain registrar (where you bought {domain}).</li>
              <li>
                Find the DNS / DNS Records / DNS Management page for{" "}
                <span className="font-mono text-[13px] text-[#111]">{domain}</span>.
              </li>
              <li>
                Add a new record with the values above:{" "}
                <span className="font-mono text-[13px] text-[#111]">CNAME</span>,{" "}
                <span className="font-mono text-[13px] text-[#111]">{cnameHost}</span>,{" "}
                <span className="font-mono text-[13px] text-[#111]">{cnameValue}</span>.
              </li>
              <li>Save. Then come back and click <span className="font-bold">Save &amp; continue</span> below.</li>
            </ol>
          </div>

          {/* Registrar quick-links */}
          <div className="mt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-3">Open your registrar&rsquo;s DNS panel</p>
            <div className="flex flex-wrap gap-3">
              {REGISTRAR_LINKS.map((r) => (
                <a
                  key={r.name}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-white border border-black/[0.1] rounded-lg px-3.5 py-2 text-xs font-medium text-[#111] hover:bg-black/[0.02] hover:border-black/[0.2] transition-colors"
                >
                  {r.name}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M3 1h6v6M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              ))}
            </div>
            <p className="text-xs text-[#9B9B9B] mt-3">
              Not sure who hosts your DNS? Try <a href="https://www.whois.com/whois/" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#111]">whois.com</a> — the &ldquo;Registrar&rdquo; field tells you.
            </p>
          </div>

          <p className="text-xs text-[#9B9B9B] mt-8">
            DNS changes can take a few minutes to propagate. We&rsquo;ll issue a TLS cert for your subdomain once the CNAME resolves.
          </p>
        </div>

        {/* Primary actions */}
        <div className="flex items-center gap-4 pt-4">
          {phase === "edit" && (
            <>
              <PrimaryButton
                onClick={handleSave}
                loading={saving}
                disabled={!slug.trim() || !customerSubdomain.includes(".")}
              >
                {variant === "wizard" ? "Save & continue" : "Save"}
              </PrimaryButton>
              {variant === "wizard" && onSkip && <SkipLink onClick={onSkip} />}
            </>
          )}

          {phase === "saved" && (
            <>
              <PrimaryButton onClick={handleVerify}>Verify DNS</PrimaryButton>
              {variant === "wizard" && onSaved && (
                <SkipLink onClick={onSaved} label="Continue →" />
              )}
              <SkipLink
                onClick={() => { setPhase("edit"); setDnsResult(null); }}
                label="Edit"
              />
            </>
          )}

          {phase === "verifying" && (
            <div className="inline-flex items-center gap-2 text-sm text-[#6B6B6B]">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Checking DNS…
            </div>
          )}

          {phase === "verified" && (
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                CNAME resolves correctly.
              </div>
              {dnsResult?.proxyLive ? (
                <div className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Proxy live — HTTPS responding.
                </div>
              ) : (
                <div className="text-xs text-[#6B6B6B] ml-6">
                  TLS cert provisioning (may take a few minutes after first CNAME).
                </div>
              )}
            </div>
          )}

          {phase === "verify_failed" && (
            <div className="space-y-3 w-full">
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-900 leading-relaxed">
                <p className="font-bold mb-1">DNS hasn&rsquo;t resolved yet.</p>
                {dnsResult?.error === "nxdomain" && (
                  <p>No CNAME found at <code className="font-mono">{customerSubdomain}</code>. Add the record above and try again in a few minutes.</p>
                )}
                {dnsResult?.error === "mismatch" && (
                  <p>
                    Found <code className="font-mono">{dnsResult.target}</code>, expected{" "}
                    <code className="font-mono">{dnsResult.expected}</code>.
                  </p>
                )}
                {dnsResult?.error === "timeout" && (
                  <p>DNS lookup timed out after 5s. Try again.</p>
                )}
                {dnsResult?.error === "not_configured" && (
                  <p>Save your slug + subdomain first.</p>
                )}
              </div>
              <PrimaryButton onClick={handleVerify}>Try again</PrimaryButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

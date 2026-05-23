"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Phase1SiteRecord } from "@/lib/phase1";
import type { IntegrationRecord } from "@/lib/phase2/connectors/types";
import { saveSiteMetaAction } from "@/app/app/onboarding/actions";
import ProxySetupForm from "./ProxySetupForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4">
      {children}
    </h2>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-black/[0.05] rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrations section
// ---------------------------------------------------------------------------

function IntegrationRow({ integration }: { integration: IntegrationRecord }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-black/[0.04] last:border-0">
      <div className="flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            integration.lastErrorCode ? "bg-red-400" : "bg-emerald-400"
          }`}
        />
        <div>
          <span className="text-sm font-medium text-[#111] capitalize">{integration.provider}</span>
          {integration.lastErrorCode && (
            <span className="ml-2 text-xs text-red-600 font-medium">{integration.lastErrorCode}</span>
          )}
        </div>
      </div>
      <div className="text-xs text-[#6B6B6B]">
        {integration.lastSyncedAt
          ? `Synced ${timeAgo(integration.lastSyncedAt)}`
          : "Never synced"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue context section
// ---------------------------------------------------------------------------

function RevenueSection({
  siteId,
  initialMrrCents,
  initialAovCents,
}: {
  siteId: string;
  initialMrrCents: number | null;
  initialAovCents: number | null;
}) {
  const toDisplay = (cents: number | null) =>
    cents !== null ? String(Math.round(cents / 100)) : "";

  const [mrr, setMrr] = useState(toDisplay(initialMrrCents));
  const [aov, setAov] = useState(toDisplay(initialAovCents));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function handleSave() {
    setSaving(true);
    try {
      const mrrCents = mrr ? Math.round(parseFloat(mrr) * 100) : null;
      const aovCents = aov ? Math.round(parseFloat(aov) * 100) : null;
      await saveSiteMetaAction(siteId, mrrCents, aovCents);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <SectionHeading>Revenue context</SectionHeading>
      <p className="text-sm text-[#6B6B6B] mb-5 max-w-sm leading-relaxed">
        Used to calculate dollar-impact estimates on findings. Rough estimates are fine.
      </p>
      <div className="space-y-4 max-w-xs">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1.5">
            Monthly revenue (MRR or GMV)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B6B6B]">$</span>
            <input
              type="number"
              value={mrr}
              onChange={(e) => { setMrr(e.target.value); setSaved(false); }}
              placeholder="50,000"
              min="0"
              className="w-full border border-black/[0.12] rounded-lg pl-7 pr-3 py-2.5 text-sm text-[#111] placeholder:text-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#111]/20 focus:border-[#111]/30 transition-all"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1.5">
            Average order / conversion value
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B6B6B]">$</span>
            <input
              type="number"
              value={aov}
              onChange={(e) => { setAov(e.target.value); setSaved(false); }}
              placeholder="120"
              min="0"
              className="w-full border border-black/[0.12] rounded-lg pl-7 pr-3 py-2.5 text-sm text-[#111] placeholder:text-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#111]/20 focus:border-[#111]/30 transition-all"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-[#111] text-[#FAFAF8] px-5 py-2.5 font-bold text-sm uppercase tracking-[0.08em] hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

interface SettingsViewProps {
  site: Phase1SiteRecord | null;
  integrations: IntegrationRecord[];
  mrrCents: number | null;
  aovCents: number | null;
}

export default function SettingsView({
  site,
  integrations,
  mrrCents,
  aovCents,
}: SettingsViewProps) {
  if (!site) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-1">
          Settings
        </div>
        <h1 className="text-3xl font-bold tracking-tighter text-[#111] mb-8">Settings</h1>
        <div className="bg-white border border-black/[0.05] rounded-2xl p-8 text-center">
          <p className="text-[#6B6B6B] mb-4">No site connected yet.</p>
          <Link
            href="/app/onboarding"
            className="inline-flex items-center gap-2 bg-[#111] text-[#FAFAF8] px-6 py-3 font-bold text-sm uppercase tracking-[0.08em] hover:opacity-80 transition-opacity"
          >
            Set up your site
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-1">
          Settings
        </div>
        <h1 className="text-3xl font-bold tracking-tighter text-[#111]">{site.domain}</h1>
        <p className="text-xs text-[#9B9B9B] mt-1 font-mono">site ID: {site.id}</p>
      </div>

      {/* Proxy & DNS */}
      <Card>
        <a id="proxy" />
        <SectionHeading>Proxy & DNS</SectionHeading>
        <ProxySetupForm
          siteId={site.id}
          domain={site.domain}
          initialSlug={site.proxySlug ?? null}
          initialSubdomain={site.customerSubdomain ?? null}
          variant="settings"
        />
      </Card>

      {/* Integrations */}
      <Card>
        <SectionHeading>Connected integrations</SectionHeading>
        {integrations.length === 0 ? (
          <div className="py-2">
            <p className="text-sm text-[#6B6B6B] mb-3">No analytics connected yet.</p>
            <Link
              href="/app/onboarding"
              className="text-sm font-medium text-[#111] underline underline-offset-2"
            >
              Connect PostHog or Segment →
            </Link>
          </div>
        ) : (
          <div>
            {integrations.map((integration) => (
              <IntegrationRow key={integration.id} integration={integration} />
            ))}
            <div className="mt-4">
              <Link
                href="/app/onboarding"
                className="text-sm text-[#6B6B6B] hover:text-[#111] transition-colors underline underline-offset-2"
              >
                Add or reconnect an integration →
              </Link>
            </div>
          </div>
        )}
      </Card>

      {/* Revenue context */}
      <RevenueSection
        siteId={site.id}
        initialMrrCents={mrrCents}
        initialAovCents={aovCents}
      />
    </div>
  );
}

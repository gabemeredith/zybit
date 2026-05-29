"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RunInsightsButtonProps {
  siteId: string;
  orgId: string;
}

type Result = { synced: number } | null;

export default function RunInsightsButton({ siteId, orgId }: RunInsightsButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dashboard/findings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId, organizationId: orgId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "Insights run failed.");
        return;
      }
      setResult({ synced: json?.data?.synced ?? 0 });
      router.refresh();
      // Clear result toast after 4s
      setTimeout(() => setResult(null), 4000);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button onClick={run} disabled={loading} className="brut-action">
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Running…
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.93 2.93l2.12 2.12M8.95 8.95l2.12 2.12M2.93 11.07l2.12-2.12M8.95 5.05l2.12-2.12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Run insights
          </>
        )}
      </button>
      {result && (
        <p className="text-xs font-medium text-emerald-600">
          {result.synced > 0
            ? `${result.synced} finding${result.synced !== 1 ? "s" : ""} synced`
            : "Up to date, no new findings"}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

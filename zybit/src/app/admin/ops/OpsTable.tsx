"use client";

import { useMemo, useState } from "react";
import {
  connectorHealth,
  formatTimeAgo,
  siteHealth,
  type OpsRow,
  type SiteHealth,
} from "@/lib/admin/opsQueries";

const HEALTH_TONE: Record<SiteHealth, { dot: string; label: string }> = {
  green: { dot: "bg-emerald-500", label: "healthy" },
  amber: { dot: "bg-amber-500", label: "degraded" },
  red: { dot: "bg-rose-500", label: "broken" },
  inactive: { dot: "bg-zinc-300", label: "no connector" },
};

const HEALTH_ORDER: Record<SiteHealth, number> = {
  red: 0,
  amber: 1,
  inactive: 2,
  green: 3,
};

type SortKey = "health" | "lastEvent" | "org";

export default function OpsTable({ rows, generatedAt }: { rows: OpsRow[]; generatedAt: string }) {
  const [sort, setSort] = useState<SortKey>("health");
  const [filter, setFilter] = useState("");
  const now = Date.parse(generatedAt);

  const view = useMemo(() => {
    const filterLc = filter.trim().toLowerCase();
    // Pre-compute siteHealth once per row — it's O(connectors) + Date.parse
    // per call, and the comparator would call it twice per pair otherwise.
    const withHealth = rows
      .filter((r) => {
        if (!filterLc) return true;
        return (
          r.organizationName.toLowerCase().includes(filterLc) ||
          r.siteDomain.toLowerCase().includes(filterLc) ||
          r.organizationId.toLowerCase().includes(filterLc)
        );
      })
      .map((r) => ({ row: r, health: siteHealth(r, now) }));

    withHealth.sort((a, b) => {
      if (sort === "org") return a.row.organizationName.localeCompare(b.row.organizationName);
      if (sort === "lastEvent") {
        const ta = a.row.lastEventAt ? Date.parse(a.row.lastEventAt) : 0;
        const tb = b.row.lastEventAt ? Date.parse(b.row.lastEventAt) : 0;
        return tb - ta;
      }
      const ha = HEALTH_ORDER[a.health];
      const hb = HEALTH_ORDER[b.health];
      if (ha !== hb) return ha - hb;
      return a.row.organizationName.localeCompare(b.row.organizationName);
    });

    return withHealth;
  }, [rows, sort, filter, now]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operator ops</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {rows.length} site{rows.length === 1 ? "" : "s"} · generated {new Date(generatedAt).toUTCString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter org or domain"
            className="border border-zinc-300 rounded-md px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="border border-zinc-300 rounded-md px-2 py-1.5 text-sm"
          >
            <option value="health">Sort: urgency</option>
            <option value="lastEvent">Sort: last event</option>
            <option value="org">Sort: org</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto border border-zinc-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wider">
            <tr>
              <Th>Health</Th>
              <Th>Org / Site</Th>
              <Th>Plan</Th>
              <Th>Connectors</Th>
              <Th>Last event</Th>
              <Th>Snapshots</Th>
              <Th>Open findings</Th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                  No sites match.
                </td>
              </tr>
            )}
            {view.map(({ row, health: h }) => {
              const tone = HEALTH_TONE[h];
              return (
                <tr key={row.siteId} className="border-t border-zinc-100">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${tone.dot}`} aria-label={tone.label} />
                      <span className="text-xs text-zinc-600">{tone.label}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="font-medium text-zinc-900">{row.organizationName}</div>
                    <div className="text-xs text-zinc-500">{row.siteDomain}</div>
                    <div className="text-[10px] text-zinc-400 font-mono">{row.siteId}</div>
                  </Td>
                  <Td>
                    <span className="inline-block bg-zinc-100 text-zinc-700 text-xs px-2 py-0.5 rounded uppercase tracking-wider">
                      {row.plan}
                    </span>
                  </Td>
                  <Td>
                    {row.connectors.length === 0 ? (
                      <span className="text-xs text-zinc-400">none</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {row.connectors.map((c) => {
                          const health = connectorHealth(c);
                          const dot =
                            health === "healthy"
                              ? "bg-emerald-500"
                              : health === "degraded"
                                ? "bg-amber-500"
                                : health === "disconnected"
                                  ? "bg-rose-500"
                                  : "bg-zinc-300";
                          return (
                            <div key={c.provider} className="flex items-center gap-1.5 text-xs">
                              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                              <span className="capitalize">{c.provider}</span>
                              {c.consecutiveFailures > 0 && (
                                <span className="text-rose-600">×{c.consecutiveFailures}</span>
                              )}
                              {c.lastErrorCode && (
                                <span className="text-rose-500 font-mono text-[10px]">
                                  {c.lastErrorCode}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span className={row.lastEventAt ? "text-zinc-700" : "text-zinc-400"}>
                      {formatTimeAgo(row.lastEventAt, now)}
                    </span>
                  </Td>
                  <Td>
                    {row.snapshotCount === 0 ? (
                      <span className="text-xs text-zinc-400">none</span>
                    ) : (
                      <span className="text-zinc-700">
                        {row.snapshotCount}
                        {row.snapshotAgeDays !== null && (
                          <span className="text-zinc-500 text-xs ml-1">
                            ({row.snapshotAgeDays}d old)
                          </span>
                        )}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={
                        row.openFindings > 0 ? "text-zinc-900 font-medium" : "text-zinc-400"
                      }
                    >
                      {row.openFindings}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}

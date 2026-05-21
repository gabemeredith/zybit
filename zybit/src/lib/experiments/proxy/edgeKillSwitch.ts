/**
 * Edge Config kill-switch (Zybit-116).
 *
 * The proxy reads `proxyConfigs` from Vercel Edge Config at the edge. That map
 * is only as fresh as the last publish, so an experiment stopped or concluded
 * in the DB can keep running at the edge until the config is rebuilt. To fail
 * *closed* immediately, we maintain a separate `disabledExperiments` key —
 * a list of experiment ids the proxy must never apply, checked on every edge
 * read with no DB round-trip.
 *
 * Writing Edge Config is a Vercel REST call (the `@vercel/edge-config` SDK is
 * read-only). It needs `VERCEL_API_TOKEN` plus the Edge Config id (from
 * `EDGE_CONFIG_ID`, or parsed from the `EDGE_CONFIG` connection string) and an
 * optional `VERCEL_TEAM_ID`. When those aren't set (local/dev/CI) this is a
 * no-op — the proxy still fails open on status, just without the instant edge
 * kill. Never throws: a kill-switch write must not break the stop flow.
 */

import { get } from '@vercel/edge-config';

export const DISABLED_KEY = 'disabledExperiments';

/** Pure: union the id into the current kill-list (delete is never needed). */
export function nextDisabledList(current: readonly string[] | undefined, id: string): string[] {
  const set = new Set(current ?? []);
  set.add(id);
  return [...set];
}

/** Resolve the Edge Config id from EDGE_CONFIG_ID or the EDGE_CONFIG URL. */
export function resolveEdgeConfigId(env: Record<string, string | undefined> = process.env): string | null {
  if (env.EDGE_CONFIG_ID) return env.EDGE_CONFIG_ID;
  const conn = env.EDGE_CONFIG;
  if (!conn) return null;
  // https://edge-config.vercel.com/ecfg_xxx?token=yyy
  const m = conn.match(/edge-config\.vercel\.com\/(ecfg_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export interface KillSwitchResult {
  ok: boolean;
  reason?: 'not-configured' | 'write-failed';
}

/**
 * Add an experiment to the edge kill-list. Best-effort and never throws.
 *
 * Note: the read-modify-write here is not atomic. If two stops happen inside
 * the same ~200ms window, both can read the list before either has written
 * back, and the later write overwrites the earlier one. Accepted because: (1)
 * concurrent stops do not occur at current product scale; (2) the DB `status`
 * write is the source of truth, and the in-handler kill switch
 * (`experiment.status === 'running'`) catches any experiment the edge list
 * misses on the next config refresh; (3) Vercel Edge Config has no atomic
 * append. Revisit if a bulk-stop operation ships.
 */
export async function disableExperimentAtEdge(
  experimentId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<KillSwitchResult> {
  const id = resolveEdgeConfigId(env);
  const token = env.VERCEL_API_TOKEN;
  if (!id || !token) return { ok: false, reason: 'not-configured' };

  try {
    const current = (await get<string[]>(DISABLED_KEY)) ?? [];
    if (current.includes(experimentId)) return { ok: true };
    const value = nextDisabledList(current, experimentId);

    const url = new URL(`https://api.vercel.com/v1/edge-config/${id}/items`);
    if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId', env.VERCEL_TEAM_ID);

    const res = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [{ operation: 'upsert', key: DISABLED_KEY, value }] }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'write-failed' };
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
}

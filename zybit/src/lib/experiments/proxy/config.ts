import { get } from '@vercel/edge-config';
import type { VariantModification } from '../types';
import { DISABLED_KEY } from './edgeKillSwitch';

export interface ProxyExperiment {
  id: string;
  targetPath: string | null;
  modifications: VariantModification[];
  controlPct: number;
  durationDays: number;
  status: 'running' | 'stopped' | 'completed';
}

export interface ProxyConfig {
  site: { id: string; domain: string };
  experiments: ProxyExperiment[];
}

/**
 * Pure: drop any experiment on the edge kill-list (Zybit-116). Lets the proxy
 * fail closed the instant an experiment is stopped, even if `proxyConfigs`
 * still lists it as running from a stale publish.
 */
export function filterDisabledExperiments(
  config: ProxyConfig,
  disabledIds: readonly string[] | undefined,
): ProxyConfig {
  if (!disabledIds || disabledIds.length === 0) return config;
  const disabled = new Set(disabledIds);
  return { ...config, experiments: config.experiments.filter((e) => !disabled.has(e.id)) };
}

export async function loadProxyConfig(
  slug: string,
  baseUrl: string,
): Promise<ProxyConfig | null> {
  if (process.env.EDGE_CONFIG) {
    try {
      const [configMap, disabled] = await Promise.all([
        get<{ [slug: string]: ProxyConfig }>('proxyConfigs'),
        get<string[]>(DISABLED_KEY),
      ]);
      if (configMap?.[slug]) return filterDisabledExperiments(configMap[slug], disabled);
    } catch {
      // fall through to API
    }
  }

  try {
    const url = new URL(`/api/proxy/config?slug=${encodeURIComponent(slug)}`, baseUrl);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = (await res.json()) as { success: boolean; data?: ProxyConfig };
    if (!json.success || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

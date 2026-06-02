/**
 * GA4 is aggregate-grain: its events cannot be joined to per-visitor A/B
 * assignment events, so a GA4-only site can surface findings but the
 * measurement loop produces no outcomes. This module is the single source
 * of truth for the "GA4-only measurement gap" condition (Zybit-157).
 */

/**
 * True when a site has integrations connected but every one of them is GA4.
 * Disabled integrations are ignored. Returns false when nothing is connected —
 * that is a "no integrations" state, not a measurement gap.
 */
export function isGa4OnlyMeasurementGap(
  integrations: Array<{ provider: string; status: string }>,
): boolean {
  const active = integrations.filter((i) => i.status !== 'disabled');
  if (active.length === 0) return false;
  return active.every((i) => i.provider === 'ga4');
}

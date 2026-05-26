/**
 * Impact estimate helper for Phase 2 audit rules.
 *
 * Computes a finding's estimated monthly impact in the site's goal units —
 * signups, sessions, conversions, or a custom metric — from the behavioral
 * signal each rule already measures (affected rate, daily volume).
 *
 * The result is honest napkin math, not a guarantee:
 *   - For revenue/ecommerce: affected sessions × baseline conversion × 30 days → conversions
 *   - For growth: affected sessions × baseline conversion × 30 days
 *   - For engagement / default: affected sessions × 30 days
 *   - For custom: affected sessions × baseline conversion × customMetricValue × 30 days
 *
 * Dollar figures are intentionally omitted — conversion counts are always
 * available; ARPU/AOV are not reliably set and fabricated $ numbers undermine
 * trust in the audit. Use the conversion count to frame the finding.
 *
 * When the site has no goalConfig, we default to 'engagement' (sessions
 * affected) so every finding always shows something meaningful.
 */

import type { GoalConfig, GoalType } from '@/lib/phase2/types';
import type { AuditFindingImpactEstimate } from './types';

export interface ImpactInput {
  /** 0..1 — fraction of relevant sessions/pageviews that are affected. */
  affectedRate: number;
  /** Total volume (sessions or pageviews) observed during the insight window. */
  windowVolume: number;
  /** Number of days the insight window covers. Used to derive daily rate. */
  windowDays: number;
  /** Goal type from site config. Defaults to 'engagement'. */
  goalType?: GoalType;
  /** Goal config from site config. */
  goalConfig?: GoalConfig;
  /** Short description of what the volume represents, e.g. "pageviews on /pricing". */
  signalDescription: string;
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1_000)  return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(value));
}

export function computeImpactEstimate(input: ImpactInput): AuditFindingImpactEstimate {
  const {
    affectedRate,
    windowVolume,
    windowDays,
    goalType = 'engagement',
    goalConfig = {},
    signalDescription,
  } = input;

  const safeRate = Math.min(Math.max(affectedRate, 0), 1);
  const dailyVolume = windowVolume / Math.max(windowDays, 1);
  const affectedMonthly = safeRate * dailyVolume * 30;

  const baselineConv = goalConfig.baselineConversionRate ?? 0.03; // 3% default

  switch (goalType) {
    case 'revenue':
    case 'ecommerce': {
      const convertedMonthly = affectedMonthly * baselineConv;
      const value = Math.round(convertedMonthly);
      const formatted = `~${formatCount(value)} conversions/month`;
      const basis =
        `${Math.round(safeRate * 100)}% affected rate × ${Math.round(dailyVolume)} ${signalDescription}/day × ` +
        `${Math.round(baselineConv * 100)}% baseline conversion × 30 days`;
      return { value, unit: 'conversions', period: 'monthly', formatted, basis };
    }

    case 'growth': {
      const label = goalConfig.conversionLabel ?? 'signups';
      const convertedMonthly = affectedMonthly * baselineConv;
      const value = Math.round(convertedMonthly);
      const formatted = `~${formatCount(value)} ${label}/month`;
      const basis =
        `${Math.round(safeRate * 100)}% affected rate × ${Math.round(dailyVolume)} ${signalDescription}/day × ` +
        `${Math.round(baselineConv * 100)}% baseline conversion × 30 days`;
      return { value, unit: label, period: 'monthly', formatted, basis };
    }

    case 'custom': {
      const label = goalConfig.customMetricLabel ?? 'conversions';
      const perConv = goalConfig.customMetricValue ?? 1;
      const convertedMonthly = affectedMonthly * baselineConv * perConv;
      const value = Math.round(convertedMonthly);
      const formatted = `~${formatCount(value)} ${label}/month`;
      const basis =
        `${Math.round(safeRate * 100)}% affected rate × ${Math.round(dailyVolume)} ${signalDescription}/day × ` +
        `${Math.round(baselineConv * 100)}% baseline conversion × ${perConv} value × 30 days`;
      return { value, unit: label, period: 'monthly', formatted, basis };
    }
  }

  // Default: engagement (sessions affected)
  const value = Math.round(affectedMonthly);
  const formatted = `~${formatCount(value)} sessions/month`;
  const basis =
    `${Math.round(safeRate * 100)}% of ${Math.round(dailyVolume)} ${signalDescription}/day × 30 days`;
  return { value, unit: 'sessions', period: 'monthly', formatted, basis };
}

/** Derive window duration in days from ISO start/end strings. */
export function windowDaysFromTimeWindow(window: { start: string; end: string }): number {
  return Math.max(
    1,
    (new Date(window.end).getTime() - new Date(window.start).getTime()) / 86_400_000,
  );
}

/**
 * Shared renderers that turn a SiteContext into prompt text. Every audit LLM
 * call threads context through these so the wording is consistent and the
 * flag-off path is trivially "append nothing".
 */

import type { SiteContext, SiteIndustry } from './types';

const INDUSTRY_LABEL: Record<SiteIndustry, string> = {
  saas: 'B2B SaaS',
  ecommerce: 'DTC e-commerce',
  fintech: 'fintech',
  healthtech: 'healthtech',
  media: 'media / publisher',
  other: '',
};

/**
 * The reviewer persona for capture-time critique. Replaces the hardcoded
 * "B2B SaaS landing-page reviewer" with one that matches the site's industry.
 * Falls back to a neutral "landing-page reviewer" when industry is unknown —
 * which is exactly today's behaviour minus the wrong "B2B SaaS" assumption.
 */
export function reviewerPersona(ctx: SiteContext | null): string {
  const label = ctx ? INDUSTRY_LABEL[ctx.industry] : '';
  return label ? `${label} landing-page reviewer` : 'landing-page reviewer';
}

/**
 * Compact context block appended to generation prompts (Layer B, advisors).
 * Returns '' when ctx is null so callers can unconditionally concatenate.
 */
export function siteContextPromptBlock(ctx: SiteContext | null): string {
  if (!ctx) return '';
  const lines: string[] = [`  industry: ${ctx.industry}`];
  if (ctx.businessModel !== 'unknown') lines.push(`  business model: ${ctx.businessModel}`);
  if (ctx.conversionGoal !== 'unknown') lines.push(`  primary conversion goal: ${ctx.conversionGoal}`);
  if (ctx.audience) lines.push(`  audience: ${ctx.audience}`);
  if (ctx.brandVoice) lines.push(`  brand voice: ${ctx.brandVoice}`);
  return [
    "SITE CONTEXT (who this site is — tailor wording and the proposed change to",
    'this business; never invent product names, features, or metrics not given):',
    ...lines,
  ].join('\n');
}

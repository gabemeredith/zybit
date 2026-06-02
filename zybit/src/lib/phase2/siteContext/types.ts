/**
 * SiteContext — the business context every audit LLM call is currently starved of.
 *
 * Today each prompt (copy critique, Layer B prose, variant advisor, fix advisor)
 * sees ONE page in isolation: `deriveIndustry()` even computes an industry and
 * then never passes it to a single prompt; copy critique hardcodes "B2B SaaS
 * reviewer" for every site on the web. SiteContext is the shared, once-per-audit
 * answer to "who is this site, what do they sell, and what action are they trying
 * to drive?" — fed into those prompts so the audit reads like it was written by a
 * consultant who knows the business.
 *
 * AI-engineering contract (mirrors captureCopyCritique / captureVisualSignals):
 *   - Deterministic priors first (deriveIndustry), LLM only refines/extends.
 *   - Structured output + strict validator + fail-soft.
 *   - Declared values (onboarding) always beat inferred ones.
 *   - This is CONTEXT for phrasing/proposals — it never decides whether a finding
 *     fires. The deterministic rule core is untouched.
 */

/** Coarse industry — superset of the deterministic `Industry` enum. */
export type SiteIndustry =
  | 'saas'
  | 'ecommerce'
  | 'fintech'
  | 'healthtech'
  | 'media'
  | 'other';

/** How the business monetizes — orthogonal to industry. */
export type BusinessModel =
  | 'subscription'
  | 'transactional'
  | 'lead-gen'
  | 'marketplace'
  | 'advertising'
  | 'unknown';

/** The single primary conversion action the site is built to drive. */
export type ConversionGoal =
  | 'start-free-trial'
  | 'book-demo'
  | 'contact-sales'
  | 'purchase'
  | 'create-account'
  | 'subscribe'
  | 'request-quote'
  | 'download'
  | 'unknown';

export interface SiteContext {
  /** Coarse industry. `other` when neither heuristic nor model is confident. */
  industry: SiteIndustry;
  /** Monetization model. `unknown` when not inferable. */
  businessModel: BusinessModel;
  /** Primary conversion action. `unknown` when not inferable. */
  conversionGoal: ConversionGoal;
  /** Who the site sells to (ICP), one short phrase. `null` when not inferable. */
  audience: string | null;
  /** Brand voice / tone descriptor, one short phrase. `null` when not inferable. */
  brandVoice: string | null;
  /** Provenance of the fields. */
  source: 'declared' | 'inferred' | 'hybrid';
  /** 0..1 self-assessed confidence in the inferred fields (1 for declared-only). */
  confidence: number;
  capturedAt: string;
  modelVersion: string;
}

/**
 * Master flag for the whole LLM context-enrichment surface. OFF by default: when
 * off, callers must NOT compute or pass SiteContext, so every prompt keeps its
 * exact current behavior (asserted by prompt-equality tests). See HANDOFF.md.
 *
 * Pass an explicit `override` to force on/off regardless of env — the eval
 * harness uses this to run the SAME audit both ways without mutating global env
 * (mirrors `isLayerBEnabled`). `undefined` ⇒ read the env flag.
 */
export function isSiteContextEnabled(override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  return process.env.LLM_SITE_CONTEXT_ENABLED === '1';
}

/**
 * AcmeBank — the synthetic smoke scenario for Lighthouse Phase 1.
 *
 * The "site" is a tiny static HTML tree served by Lighthouse itself at
 * `/fake-sites/acmebank/...` so the scenario doesn't depend on any
 * external service. The pages are deliberately engineered to trigger
 * the `bounce-on-key-page` audit rule:
 *
 *   - Persona mix is biased toward churning + bot-ish, both with high
 *     bounceProbability (0.60 / 0.85). With 200 sessions, well over
 *     100 land on `/` and the bounce rate easily clears the rule's
 *     50% threshold.
 *   - The home page (`/`) buries its primary CTA well below the fold
 *     behind filler copy, so the snapshot has a low above-fold CTA
 *     coverage score.
 *
 * Findings count of zero is a failure of the smoke test; ≥1 finding
 * proves the pipeline is wired end-to-end.
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const acmebank: Scenario = {
  id: 'acmebank',
  name: 'AcmeBank — synthetic, designed to bounce',
  defaultSessions: 300,
  siteManifest: {
    slug: 'acmebank',
    bucket: 'synthetic',
    displayName: 'AcmeBank',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/acmebank',
    // Sessions land on /checking-accounts so the finding reads like a
    // real banking key-funnel page rather than a generic `/`. The HTML
    // at /fake-sites/acmebank/checking-accounts.html is engineered the
    // same way as the home page — buried CTA, padding-heavy copy — so
    // the bounce-on-key-page rule still fires (MIN_ENTRIES=100 met by
    // having every session enter here).
    primaryFunnelPaths: ['/checking-accounts'],
    primaryCtaSelector: '[data-testid=signup-cta]',
    expectedConversionEvent: 'form_submit',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: 80_000_00, aov: null },
    biasNotes: 'Engineered to surface bounce-on-key-page via churning/bot-ish heavy mix and below-fold CTA.',
  },
  personaMix: [
    // Bias toward bouncing personas: ~70% combined.
    { personaId: 'churning', weight: 0.45 },
    { personaId: 'bot-ish', weight: 0.25 },
    { personaId: 'casual', weight: 0.18 },
    { personaId: 'evaluator', weight: 0.08 },
    { personaId: 'power-user', weight: 0.04 },
  ],
};

registerScenario(acmebank);

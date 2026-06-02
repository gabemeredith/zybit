/**
 * Verdant Health — fires form-abandonment on /get-started.
 *
 * Mental-health telehealth intake. The /get-started form is 8 fields
 * including DOB, insurance carrier, and a sensitive medications
 * dropdown — exactly the realistic "ops added a field, never UX-tested"
 * pattern. Most visitors who reach the form abandon at the medications
 * step because it's invasive before they've talked to anyone.
 *
 * The driver's per-page form_submit roll uses `persona.formSubmitIntent`
 * which is naturally well below 50% for every persona — so the rule's
 * submit-rate threshold gets cleared by the personas as-is. The
 * scenario uses high-traffic personaMix + transitions biased into
 * /get-started to clear the MIN_FORM_VIEWS (100) threshold.
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const verdant: Scenario = {
  id: 'rule-form-abandonment',
  name: 'Verdant Health — fires form-abandonment',
  defaultSessions: 600,
  siteManifest: {
    slug: 'verdant',
    bucket: 'saas-landing-app',
    displayName: 'Verdant Health',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/verdant',
    primaryFunnelPaths: ['/get-started'],
    transitionWeights: {
      '/': [
        { path: '/how-it-works', weight: 0.40 },
        { path: '/get-started', weight: 0.30 },
        { path: '/therapists', weight: 0.20 },
        { path: '/', weight: 0.10 },
      ],
      '/how-it-works': [
        { path: '/get-started', weight: 0.50 },
        { path: '/therapists', weight: 0.20 },
        { path: '/', weight: 0.20 },
        { path: '/how-it-works', weight: 0.10 },
      ],
      '/therapists': [
        { path: '/get-started', weight: 0.45 },
        { path: '/', weight: 0.25 },
        { path: '/how-it-works', weight: 0.20 },
        { path: '/therapists', weight: 0.10 },
      ],
      '/get-started': [
        { path: '/', weight: 0.30 },
        { path: '/how-it-works', weight: 0.25 },
        { path: '/therapists', weight: 0.20 },
        { path: '/get-started', weight: 0.25 },
      ],
    },
    primaryCtaSelector: '[data-testid=intake-submit]',
    expectedConversionEvent: 'form_submit',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: 42000, aov: null },
    biasNotes:
      'Telehealth intake with an 8-field form including a sensitive medications dropdown. Persona formSubmitIntent is naturally <50% so the rule clears its submit-rate threshold; transitions feed /get-started so views clear MIN_FORM_VIEWS=100. No narrative on /get-started — the narrative branch of return-visit-thrash uses a lower (3) threshold than strict mode (4), and adding one here triggers thrash on natural multi-page browsing.',
  },
  personaMix: [
    // Healthtech evaluators researching options dominate, with a chunk
    // of casual reseachers and a few committed power-users.
    { personaId: 'evaluator', weight: 0.45 },
    { personaId: 'casual', weight: 0.35 },
    { personaId: 'power-user', weight: 0.08 },
    { personaId: 'churning', weight: 0.07 },
    { personaId: 'bot-ish', weight: 0.05 },
  ],
};

registerScenario(verdant);

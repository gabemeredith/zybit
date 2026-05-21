/**
 * WovenBasics — realistic DTC apparel scenario.
 *
 * Where AcmeBank is deliberately engineered to surface bounce-on-key-page,
 * WovenBasics is the opposite test: a well-built DTC funnel (homepage → PDP
 * → cart → checkout) authored to current best-practice convention. The
 * question this scenario answers is *not* "do the rules fire" — it's "what
 * does Zybit surface on a site a sophisticated DTC PM would actually own?"
 * Findings that fire here are calibration signal; findings that fire
 * loudly on no real flaw are false positives worth tightening.
 *
 * Sessions land on /product (the PDP), which is the highest-leverage page
 * in a DTC funnel. Persona mix is normal e-commerce: heavy on casual
 * browsers, some evaluators comparing, a smaller power-user cohort
 * (repeat buyers), light churning + bot traffic.
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const wovenbasics: Scenario = {
  id: 'wovenbasics',
  name: 'WovenBasics — realistic DTC, well-built',
  defaultSessions: 300,
  siteManifest: {
    slug: 'wovenbasics',
    bucket: 'ecom',
    displayName: 'WovenBasics',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/wovenbasics',
    primaryFunnelPaths: ['/product'],
    primaryCtaSelector: '[data-testid=add-to-cart]',
    expectedConversionEvent: 'form_submit',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: null, aov: 9500 },
    biasNotes:
      'Realistic well-built DTC funnel. No deliberate flaws — calibration test for false-positive rate and marginal-hypothesis surfacing.',
  },
  personaMix: [
    // E-commerce skew: lots of casual browsers, modest evaluators, a
    // smaller repeat-buyer (power) cohort, light churn + bots.
    { personaId: 'casual', weight: 0.55 },
    { personaId: 'evaluator', weight: 0.18 },
    { personaId: 'power-user', weight: 0.12 },
    { personaId: 'churning', weight: 0.07 },
    { personaId: 'bot-ish', weight: 0.08 },
  ],
};

registerScenario(wovenbasics);

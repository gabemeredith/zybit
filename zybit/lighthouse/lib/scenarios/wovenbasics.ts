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
    // Full funnel: home → product → cart → checkout.
    // The transition matrix directs sessions forward through the funnel so
    // /cart accumulates real inbound transitions (not a random walk).
    // exitHazard on /cart models checkout abandonment — the majority of
    // sessions that reach the cart abandon there, which should fire the
    // flow-inter-step-dropoff rule and surface /cart as the chokepoint.
    primaryFunnelPaths: ['/', '/product', '/cart', '/checkout'],
    transitionWeights: {
      '/': [
        { path: '/product', weight: 0.70 },
        { path: '/', weight: 0.30 },
      ],
      '/product': [
        { path: '/cart', weight: 0.55 },
        { path: '/product', weight: 0.25 },
        { path: '/', weight: 0.20 },
      ],
      '/cart': [
        { path: '/checkout', weight: 0.30 },
        { path: '/product', weight: 0.40 },
        { path: '/', weight: 0.30 },
      ],
      '/checkout': [
        { path: '/', weight: 0.50 },
        { path: '/product', weight: 0.30 },
        { path: '/checkout', weight: 0.20 },
      ],
    },
    // 65% of sessions that reach /cart exit there (cart abandonment).
    // 80% of sessions that reach /checkout exit there (post-purchase).
    exitHazard: { '/cart': 0.65, '/checkout': 0.80 },
    primaryCtaSelector: '[data-testid=add-to-cart]',
    expectedConversionEvent: 'form_submit',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: null, aov: 9500 },
    biasNotes:
      'DTC funnel with directed transitions and cart-abandonment exit hazard. /cart should surface as flow-inter-step-dropoff chokepoint.',
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

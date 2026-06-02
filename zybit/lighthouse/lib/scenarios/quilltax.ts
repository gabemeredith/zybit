/**
 * Quill Tax — fires help-seeking-spike on /pricing.
 *
 * Consumer DIY tax filing for freelancers. /pricing has a 3-tier matrix
 * with 11+ checkmark rows of tax jargon (Schedule C, Schedule SE, QBI,
 * 1099-NEC, etc.) that confuses casual visitors. The PM ran an A/B
 * and added a prominent "Chat with a CPA" button at the top AND bottom
 * of the pricing page, "to be helpful." It cannibalizes signups.
 *
 * Visual hierarchy on /pricing: "Chat with a CPA" buttons are the
 * heaviest CTAs (text-2xl, bg-primary, font-bold, px-8, py-4,
 * rounded-2xl, border-2). The per-tier "Select X" buttons are smaller
 * (text-base, font-semibold, border only). The snapshot-driven driver
 * picks clicks by visual weight, so the chat CTA dominates /pricing
 * clicks — local help-click rate spikes well above the 2× site
 * baseline that the rule requires.
 *
 * Other pages also have help links (small "Help" in the nav) so the
 * baseline help-click rate is > 0 (the rule's precondition).
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const quilltax: Scenario = {
  id: 'rule-help-seeking-spike',
  name: 'Quill Tax — fires help-seeking-spike',
  defaultSessions: 1000,
  siteManifest: {
    slug: 'quilltax',
    bucket: 'saas-landing-app',
    displayName: 'Quill Tax',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/quilltax',
    primaryFunnelPaths: ['/pricing'],
    transitionWeights: {
      '/': [
        { path: '/pricing', weight: 0.50 },
        { path: '/features', weight: 0.25 },
        { path: '/signup', weight: 0.15 },
        { path: '/', weight: 0.10 },
      ],
      '/pricing': [
        { path: '/signup', weight: 0.25 },
        { path: '/features', weight: 0.20 },
        { path: '/', weight: 0.25 },
        { path: '/pricing', weight: 0.30 },
      ],
      '/features': [
        { path: '/pricing', weight: 0.45 },
        { path: '/signup', weight: 0.20 },
        { path: '/', weight: 0.25 },
        { path: '/features', weight: 0.10 },
      ],
      '/signup': [
        { path: '/pricing', weight: 0.30 },
        { path: '/', weight: 0.30 },
        { path: '/signup', weight: 0.40 },
      ],
    },
    primaryCtaSelector: '[data-testid=start-filing-home]',
    expectedConversionEvent: 'cta_click',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: null, aov: 59 },
    biasNotes:
      'Consumer fintech with a jargon-heavy pricing matrix. Two prominent "Chat with a CPA" buttons (top + bottom of /pricing) outweigh the small "Select tier" buttons by visual weight. Driver clicks naturally concentrate on the chat CTAs — local help-click rate >> 2× site baseline. No narrative on /pricing (would change thrash threshold) — the rule fires off the click distribution, not the path-traversal pattern.',
  },
  personaMix: [
    // Consumer fintech skew: casual heavy (kicking tires), evaluator
    // moderate (comparing). Tax filing is annual, so power-users
    // (repeat-buyers) are rare.
    { personaId: 'casual', weight: 0.55 },
    { personaId: 'evaluator', weight: 0.25 },
    { personaId: 'churning', weight: 0.08 },
    { personaId: 'bot-ish', weight: 0.07 },
    { personaId: 'power-user', weight: 0.05 },
  ],
};

registerScenario(quilltax);

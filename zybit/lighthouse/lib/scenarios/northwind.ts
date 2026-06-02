/**
 * Northwind Analytics — fires hero-hierarchy-inversion on /.
 *
 * Series A B2B SaaS (warehouse observability). The hero has two side-by-
 * side CTAs: the *intended* primary "Start free trial" rendered as a
 * small ghost (text-base, border only) and the *visually loudest*
 * "Watch 2-min demo" as a large filled button (text-2xl, bg-primary,
 * font-bold, padding, rounded). Design pushes the eye to the demo
 * while the value lands on the trial.
 *
 * For the rule to fire, `most-clicked` must differ from
 * `visually-heaviest`. Snapshot-driven clicks default to visual-weight
 * sampling — which would just pick the demo every time. The scenario
 * uses `ctaIntentBoosts` to multiply the trial CTA's click weight ×8
 * so it outclicks the demo despite being visually lighter. That models
 * the real-world pattern: evaluators with strong intent click "Start
 * free trial" anyway; the design fails to align with that intent.
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const northwind: Scenario = {
  id: 'rule-hero-hierarchy-inversion',
  name: 'Northwind Analytics — fires hero-hierarchy-inversion',
  defaultSessions: 300,
  siteManifest: {
    slug: 'northwind',
    bucket: 'saas-landing-app',
    displayName: 'Northwind Analytics',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/northwind',
    primaryFunnelPaths: ['/'],
    transitionWeights: {
      '/': [
        { path: '/pricing', weight: 0.35 },
        { path: '/customers', weight: 0.25 },
        { path: '/docs', weight: 0.20 },
        { path: '/', weight: 0.20 },
      ],
      '/pricing': [
        { path: '/', weight: 0.40 },
        { path: '/customers', weight: 0.25 },
        { path: '/pricing', weight: 0.20 },
        { path: '/docs', weight: 0.15 },
      ],
      '/customers': [
        { path: '/', weight: 0.50 },
        { path: '/pricing', weight: 0.30 },
        { path: '/customers', weight: 0.20 },
      ],
      '/docs': [
        { path: '/pricing', weight: 0.40 },
        { path: '/', weight: 0.35 },
        { path: '/docs', weight: 0.25 },
      ],
    },
    primaryCtaSelector: '[data-testid=start-free-trial]',
    expectedConversionEvent: 'cta_click',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: 85000, aov: null },
    biasNotes:
      "B2B SaaS hero with inverted visual hierarchy. 'Watch demo' is visually heaviest (filled blue, large); 'Start free trial' is the intended primary but rendered as a small ghost. ctaIntentBoosts model evaluator intent overriding visual cues, so the trial wins clicks — most-clicked ≠ heaviest → hero-hierarchy-inversion fires.",
    // Intent boost: evaluators come ready to trial, despite the design.
    // Multiplier ×8 is large enough to dominate the visual-weight gap
    // (trial ~0.27, demo ~0.85 → boosted trial ~2.16 > 0.85).
    ctaIntentBoosts: [
      {
        pathRef: '/',
        selector: '[data-testid="start-free-trial"]',
        multiplier: 8.0,
      },
    ],
    // Narrative: from / the expected next step is /pricing (where the
    // trial lives). Defers return-visit-thrash for sessions that
    // progress that way.
    narratives: [
      {
        id: 'home-to-pricing',
        label: 'Home → Pricing',
        sourcePathRef: '/',
        expectedPathRefs: ['/pricing'],
      },
    ],
  },
  personaMix: [
    // B2B SaaS skew — heavy evaluator, modest casual, small power-user.
    { personaId: 'evaluator', weight: 0.45 },
    { personaId: 'casual', weight: 0.30 },
    { personaId: 'power-user', weight: 0.10 },
    { personaId: 'churning', weight: 0.08 },
    { personaId: 'bot-ish', weight: 0.07 },
  ],
};

registerScenario(northwind);

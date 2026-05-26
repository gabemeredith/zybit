/**
 * Plot & Patio — fires return-visit-thrash on /listings.
 *
 * Vacation-rental marketplace for small-group trips. Sessions land on
 * /listings, click into a detail page (aspen / lakeside / redwood),
 * bounce back to /listings, click another detail, bounce back —
 * looping without ever reaching /book. The realistic flaw: no
 * side-by-side comparison view, so groups can't converge on a choice.
 *
 * Narrative declares /listings → /book as the expected progression.
 * Sessions whose `pathsBetweenRevisits` for /listings DON'T include
 * /book fall into the narrative-branch thrash bucket (count ≥ 3 events
 * on /listings, no /book in between). With aggressive return-to-
 * listings weights from each detail page, the loop pattern dominates.
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const plotandpatio: Scenario = {
  id: 'rule-return-visit-thrash',
  name: 'Plot & Patio — fires return-visit-thrash',
  defaultSessions: 300,
  siteManifest: {
    slug: 'plotandpatio',
    bucket: 'ecom',
    displayName: 'Plot & Patio',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/plotandpatio',
    primaryFunnelPaths: ['/listings'],
    transitionWeights: {
      '/': [
        { path: '/listings', weight: 0.75 },
        { path: '/', weight: 0.25 },
      ],
      '/listings': [
        { path: '/aspen-a-frame', weight: 0.30 },
        { path: '/lakeside-cabin', weight: 0.25 },
        { path: '/redwood-cottage', weight: 0.25 },
        { path: '/', weight: 0.10 },
        { path: '/listings', weight: 0.05 },
        { path: '/book', weight: 0.05 },
      ],
      '/aspen-a-frame': [
        { path: '/listings', weight: 0.70 },
        { path: '/lakeside-cabin', weight: 0.10 },
        { path: '/redwood-cottage', weight: 0.10 },
        { path: '/book', weight: 0.05 },
        { path: '/aspen-a-frame', weight: 0.05 },
      ],
      '/lakeside-cabin': [
        { path: '/listings', weight: 0.70 },
        { path: '/aspen-a-frame', weight: 0.10 },
        { path: '/redwood-cottage', weight: 0.10 },
        { path: '/book', weight: 0.05 },
        { path: '/lakeside-cabin', weight: 0.05 },
      ],
      '/redwood-cottage': [
        { path: '/listings', weight: 0.70 },
        { path: '/aspen-a-frame', weight: 0.10 },
        { path: '/lakeside-cabin', weight: 0.10 },
        { path: '/book', weight: 0.05 },
        { path: '/redwood-cottage', weight: 0.05 },
      ],
      '/book': [
        { path: '/listings', weight: 0.50 },
        { path: '/', weight: 0.30 },
        { path: '/book', weight: 0.20 },
      ],
    },
    primaryCtaSelector: '[data-testid=browse-listings]',
    expectedConversionEvent: 'cta_click',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: null, aov: 1200 },
    biasNotes:
      "Group-trip vacation-rental marketplace. Detail pages send users back to /listings at 70% — natural loop pattern. Narrative declares /listings → /book; sessions that don't reach /book look like thrash to the rule. priorityScore = thrashRate × 4 so a modest thrash share dominates the finding ranking.",
    // Narrative branch is the right escape hatch here — and we ALSO
    // want thrash to fire, so the narrative declares the expected
    // progression (/listings → /book) and most sessions don't follow it.
    narratives: [
      {
        id: 'listings-to-book',
        label: 'Listings → Book',
        sourcePathRef: '/listings',
        expectedPathRefs: ['/book'],
      },
    ],
  },
  personaMix: [
    // Marketplace skew: heavy evaluators comparing options, modest
    // casual browsers, low committed power-users.
    { personaId: 'evaluator', weight: 0.45 },
    { personaId: 'casual', weight: 0.35 },
    { personaId: 'power-user', weight: 0.08 },
    { personaId: 'churning', weight: 0.07 },
    { personaId: 'bot-ish', weight: 0.05 },
  ],
};

registerScenario(plotandpatio);

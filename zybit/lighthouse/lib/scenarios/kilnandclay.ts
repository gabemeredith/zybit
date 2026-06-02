/**
 * Kiln & Clay — fires above-fold-coverage on /collections.
 *
 * Realistic DTC ceramics studio (small-batch, Portland) where the
 * Spring-drop page is laid out as a long-scroll editorial: the
 * "Shop the Spring drop" CTA sits inside section 7 of 8 in /collections,
 * so the body-child ratio puts it in the bottom quartile — foldGuess
 * resolves to 'below'. The CTA carries enough class signals
 * (text-3xl, bg-primary, font-bold, padding, rounded, border) to clear
 * the rule's MIN_VISUAL_WEIGHT of 0.4.
 *
 * Two manifest knobs do the heavy lifting:
 *   - `lowScrollPaths: ['/collections']` halves the sampled scroll-depth
 *     percent on the long editorial page so the share of <40%-scroll
 *     pageviews clears the rule threshold without needing a bouncy
 *     persona mix (which would surface bounce-on-key-page instead).
 *   - persona mix is engaged (casual + evaluator dominant) so bounce
 *     rate stays well below bounce-on-key-page's 50% threshold.
 */

import { registerScenario } from './index';
import type { Scenario } from '../types';

export const kilnandclay: Scenario = {
  id: 'rule-above-fold-coverage',
  name: 'Kiln & Clay — fires above-fold-coverage',
  defaultSessions: 300,
  siteManifest: {
    slug: 'kilnandclay',
    bucket: 'ecom',
    displayName: 'Kiln & Clay',
    stack: 'static HTML served by Lighthouse',
    baseUrl: 'http://localhost:3001/fake-sites/kilnandclay',
    primaryFunnelPaths: ['/collections'],
    // Forward funnel: home → collections → PDP. /collections leads
    // primarily to the PDP, with little back-flow — sessions visiting
    // /collections 3+ times stay rare so return-visit-thrash doesn't
    // outrank the target rule.
    transitionWeights: {
      '/': [
        { path: '/collections', weight: 0.70 },
        { path: '/about', weight: 0.15 },
        { path: '/', weight: 0.15 },
      ],
      '/collections': [
        { path: '/cobalt-mug', weight: 0.55 },
        { path: '/', weight: 0.25 },
        { path: '/about', weight: 0.15 },
        { path: '/collections', weight: 0.05 },
      ],
      '/cobalt-mug': [
        { path: '/cobalt-mug', weight: 0.50 },
        { path: '/', weight: 0.35 },
        { path: '/collections', weight: 0.15 },
      ],
      '/about': [
        { path: '/', weight: 0.55 },
        { path: '/collections', weight: 0.30 },
        { path: '/about', weight: 0.15 },
      ],
    },
    // No exitHazard: bounce-on-key-page must NOT outrank above-fold-coverage.
    // The "bad" thing about this site is the buried CTA, not the bounce rate.
    lowScrollPaths: ['/collections'],
    // "From /collections the spring-drop CTA is supposed to send users to
    // the PDP." Sessions that progress that way aren't thrashing —
    // return-visit-thrash defers for them. Lets above-fold-coverage win
    // as the lone finding when it's the rule the page actually violates.
    narratives: [
      {
        id: 'collections-to-pdp',
        label: 'Spring drop → PDP',
        sourcePathRef: '/collections',
        expectedPathRefs: ['/cobalt-mug'],
      },
    ],
    primaryCtaSelector: '[data-testid=shop-spring-drop]',
    expectedConversionEvent: 'cta_click',
    requiresTunnel: false,
    isSpa: false,
    businessProfile: { mrr: null, aov: 6800 },
    biasNotes:
      'Spring-drop page buries the primary CTA in section 7 of 8. lowScrollPaths halves scroll on /collections so >50% of pageviews stay below the 40% fold line — fires above-fold-coverage cleanly.',
  },
  personaMix: [
    // Engaged-but-skimming mix: casual + evaluator dominant so multi-page
    // sessions are common (bounce rate stays low), but persona scroll
    // baselines are halved on /collections via lowScrollPaths.
    { personaId: 'casual', weight: 0.55 },
    { personaId: 'evaluator', weight: 0.25 },
    { personaId: 'power-user', weight: 0.10 },
    { personaId: 'churning', weight: 0.05 },
    { personaId: 'bot-ish', weight: 0.05 },
  ],
};

registerScenario(kilnandclay);

/**
 * Constants shared by the /demo surface. The demo runs the real `/audit`
 * pipeline against commitmint.app and provisions a `lighthouse_*` org+site
 * (same id scheme the public-audit funnel uses). All demo-specific code
 * keys off these constants — never inline the slug or email anywhere else.
 */

export const DEMO_TARGET_URL = 'https://commitmint.app';
export const DEMO_TARGET_HOST = 'commitmint.app';

/**
 * Slug passed to `provisionLighthouseSite`. Must match what the real audit
 * pipeline would derive for commitmint.app via `sanitize(host)` so re-runs
 * land on the same row.
 */
export const DEMO_LIGHTHOUSE_SLUG = 'urlaudit-commitmint-app';
export const DEMO_ORG_ID = `lighthouse_org_${DEMO_LIGHTHOUSE_SLUG}`;
export const DEMO_SITE_ID = `lighthouse_site_${DEMO_LIGHTHOUSE_SLUG}`;
export const DEMO_USER_ID = `lighthouse_user_${DEMO_LIGHTHOUSE_SLUG}`;
export const DEMO_USER_EMAIL = `pm@lighthouse-${DEMO_LIGHTHOUSE_SLUG}.invalid`;

/**
 * Proxy slug under which the demo site is reachable at
 * `<slug>.zybit.run`. The proxy honors `?_zb_force=control|variant` only
 * for sites with `organizationId === DEMO_ORG_ID`, so the demo can render
 * both buckets side-by-side without rerolling cookies.
 */
export const DEMO_PROXY_SLUG = 'commitmint';

/**
 * Pre-baked completed-experiment metrics used to make the experiments
 * list look populated on first cockpit load. Realistic for a B2B
 * commit-message AI sign-up flow: low base rate, mid-single-digit
 * absolute lift, 95% confidence.
 */
export const DEMO_COMPLETED_RESULT = {
  controlRate: 0.0421,
  variantRate: 0.0476,
  confidence: 0.95,
  participants: 8412,
} as const;

/**
 * Single source of truth for "we ran N friction rules" copy.
 *
 * Re-exported from the rules barrel so server code can compute it and a
 * test (`publicAuditRuleCount.test.ts`) keeps the marketing constant in
 * sync. Lives in its own file because the landing page (`src/app/page.tsx`)
 * is a client component — importing the rules barrel there would bundle
 * every rule implementation into the public JS payload.
 */

/**
 * Count of rules whose `publicAuditBehavior !== 'empty'`. When this number
 * changes, update both this constant and the test that asserts the two
 * match — the test catches drift in either direction.
 */
export const PUBLIC_AUDIT_RULE_COUNT = 13;

/**
 * Rules that stay dark in public-audit mode (`publicAuditBehavior: 'empty'`)
 * — behavioral rules that need PostHog session data to fire. Surfaced in
 * the report email's empty-state intro + PostHog caveat ("the other N rules
 * light up once you connect PostHog"). The same drift-catching test pins
 * this to the runtime count.
 */
export const PUBLIC_AUDIT_DEFERRED_RULE_COUNT = 10;

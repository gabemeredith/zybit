/**
 * Reject-list of personal-email domains for the public `/audit` form.
 *
 * Premium positioning (see `docs/sprints/url-audit-lead-magnet.md` §0):
 * the audit is for product teams, not consumers. We accept work emails
 * and university (.edu) addresses. Personal-email domains bounce at the
 * form with a helpful nudge.
 *
 * Both the client form and the API route should call `isPersonalEmail`.
 */

const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'hey.com',
  'fastmail.com',
  'gmx.com',
  'gmx.de',
  'yandex.com',
  'yandex.ru',
  'mail.com',
  'mail.ru',
  'zoho.com',
  'duck.com',
  'tutanota.com',
  'tuta.io',
  'qq.com',
  '163.com',
  '126.com',
]);

export function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

export function isPersonalEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  return PERSONAL_EMAIL_DOMAINS.has(domain);
}

/**
 * Test-email allowlist for development + staging. When the submitter's
 * address matches the allowlist (comma-separated), the personal-email
 * rejection is bypassed. All other gates — SSRF, rate limits, budget,
 * confirmation flow — still apply.
 *
 * Two env-var names are read, both optional:
 *   - `PUBLIC_AUDIT_TEST_EMAILS` — server-only, never reaches the browser.
 *     Use when you only need to drive the API directly (curl / Postman).
 *   - `NEXT_PUBLIC_AUDIT_TEST_EMAILS` — also inlined into the client bundle
 *     by Next.js so the `/audit` form can skip its preemptive rejection.
 *     Use this when you want the actual GUI flow to work.
 *
 * Production-safe: setting either in prod only opens a hole for the named
 * humans whose inboxes you control. The double-opt-in step means a stranger
 * submitting an allowlisted address still can't receive the report — they
 * don't own the inbox. NEXT_PUBLIC_* leaks the allowlist into the public JS
 * bundle; only put addresses there whose ownership is already public (a
 * personal Gmail is fine; a colleague's address is a judgment call).
 */
export function isAllowlistedTestEmail(email: string): boolean {
  const raw =
    process.env.PUBLIC_AUDIT_TEST_EMAILS ??
    process.env.NEXT_PUBLIC_AUDIT_TEST_EMAILS;
  if (!raw) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0)
    .includes(normalized);
}

export function rejectionMessage(): string {
  return 'Please use your work email. We send the audit report to your team inbox; personal addresses are for the waitlist, not the audit.';
}

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

export function rejectionMessage(): string {
  return 'Please use your work email. We send the audit report to your team inbox; personal addresses are for the waitlist, not the audit.';
}

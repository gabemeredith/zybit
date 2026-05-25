import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUDIT_CONFIRMED_COOKIE = 'zb_audit_confirmed';
const AUDIT_COOKIE_DAYS = 7;
const AUDIT_SIGNUP_PARAM_DAYS = 30;

function secret(): string {
  const s = process.env.PUBLIC_AUDIT_SIGNING_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PUBLIC_AUDIT_SIGNING_SECRET is required in production');
    }
    return 'dev-audit-signing-secret';
  }
  return s;
}

export function signAuditCookie(auditId: string): string {
  const expiry = String(Date.now() + AUDIT_COOKIE_DAYS * 24 * 3600 * 1000);
  const sig = createHmac('sha256', secret()).update(`${auditId}|${expiry}`).digest('hex');
  return `${expiry}.${sig}`;
}

export function verifyAuditCookie(value: string | undefined, auditId: string): boolean {
  if (!value) return false;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return false;
  const expiry = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expiryNum = Number(expiry);
  if (!Number.isFinite(expiryNum) || expiryNum < Date.now()) return false;
  const expected = createHmac('sha256', secret()).update(`${auditId}|${expiry}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

export const auditCookieOptions = {
  name: AUDIT_CONFIRMED_COOKIE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: AUDIT_COOKIE_DAYS * 24 * 3600,
};

// Sign an HMAC over `email|auditId|expiry` for the report-email signup CTA URL.
// The CTA hits /api/auth/request-link-from-audit which verifies this sig
// before issuing a magic link — prevents enumeration / open-relay spam.
// The 30-day expiry caps how long a leaked report-email URL stays a valid
// trigger; legitimate PMs who rediscover the email after vacation are still
// inside the window.
export function signAuditSignupParam(email: string, auditId: string): string {
  const expiry = String(Date.now() + AUDIT_SIGNUP_PARAM_DAYS * 24 * 3600 * 1000);
  const sig = createHmac('sha256', secret())
    .update(`${email}|${auditId}|${expiry}`)
    .digest('hex');
  return `${expiry}.${sig}`;
}

export function verifyAuditSignupParam(
  email: string,
  auditId: string,
  value: string,
): boolean {
  if (!value) return false;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return false;
  const expiry = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (sig.length !== 64 || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const expiryNum = Number(expiry);
  if (!Number.isFinite(expiryNum) || expiryNum < Date.now()) return false;
  const expected = createHmac('sha256', secret())
    .update(`${email}|${auditId}|${expiry}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

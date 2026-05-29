import { createHmac, timingSafeEqual } from 'node:crypto';

// One-time-ish signed token for the "set your password" link in the welcome
// email sent at approval. Stateless HMAC over `email|expiry` — same pattern as
// src/lib/audit/cookies.ts. The link is single-use in practice because once a
// password is set the user signs in normally; the token stays valid until
// expiry as a "reset" affordance for the closed pilot (no separate reset flow
// yet). Format: `email-b64url.expiry.sigHex`.
const SET_PASSWORD_TOKEN_DAYS = 7;

function secret(): string {
  const s = process.env.AUTH_SIGNING_SECRET ?? process.env.PUBLIC_AUDIT_SIGNING_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SIGNING_SECRET (or PUBLIC_AUDIT_SIGNING_SECRET) is required in production');
    }
    return 'dev-auth-signing-secret';
  }
  return s;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function signSetPasswordToken(email: string, ttlDays = SET_PASSWORD_TOKEN_DAYS): string {
  const expiry = String(Date.now() + ttlDays * 24 * 3600 * 1000);
  const normalized = normalizeEmail(email);
  const sig = createHmac('sha256', secret()).update(`${normalized}|${expiry}`).digest('hex');
  const emailPart = Buffer.from(normalized, 'utf8').toString('base64url');
  return `${emailPart}.${expiry}.${sig}`;
}

/** Returns the verified normalized email, or null if the token is invalid/expired. */
export function verifySetPasswordToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [emailPart, expiry, sig] = parts;
  if (sig.length !== 64 || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expiryNum = Number(expiry);
  if (!Number.isFinite(expiryNum) || expiryNum < Date.now()) return null;

  let email: string;
  try {
    email = Buffer.from(emailPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email.includes('@')) return null;

  const expected = createHmac('sha256', secret()).update(`${email}|${expiry}`).digest();
  const provided = Buffer.from(sig, 'hex');
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  return email;
}

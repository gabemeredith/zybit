import { describe, it, expect, beforeAll } from 'vitest';
import {
  signAuditCookie,
  verifyAuditCookie,
  signAuditSignupParam,
  verifyAuditSignupParam,
} from '../cookies';

beforeAll(() => {
  // Ensure dev default is exercised — explicitly unset so tests don't depend
  // on the developer's local env.
  delete process.env.PUBLIC_AUDIT_SIGNING_SECRET;
});

describe('audit confirmation cookie', () => {
  it('round-trips for the same auditId', () => {
    const cookie = signAuditCookie('audit-123');
    expect(verifyAuditCookie(cookie, 'audit-123')).toBe(true);
  });

  it('rejects when auditId differs', () => {
    const cookie = signAuditCookie('audit-123');
    expect(verifyAuditCookie(cookie, 'audit-456')).toBe(false);
  });

  it('rejects empty / undefined values', () => {
    expect(verifyAuditCookie(undefined, 'audit-123')).toBe(false);
    expect(verifyAuditCookie('', 'audit-123')).toBe(false);
    expect(verifyAuditCookie('garbage', 'audit-123')).toBe(false);
  });

  it('rejects tampered signature', () => {
    const cookie = signAuditCookie('audit-123');
    const tampered = cookie.slice(0, -2) + '00';
    expect(verifyAuditCookie(tampered, 'audit-123')).toBe(false);
  });

  it('rejects expired cookie', () => {
    // Hand-craft an expired cookie by shifting the embedded expiry into the past.
    const cookie = signAuditCookie('audit-123');
    const dot = cookie.lastIndexOf('.');
    const sig = cookie.slice(dot + 1);
    const expiredCookie = `${Date.now() - 1000}.${sig}`;
    expect(verifyAuditCookie(expiredCookie, 'audit-123')).toBe(false);
  });
});

describe('audit signup param HMAC', () => {
  it('round-trips for the same email+auditId', () => {
    const sig = signAuditSignupParam('jad@acmebank.com', 'audit-123');
    expect(verifyAuditSignupParam('jad@acmebank.com', 'audit-123', sig)).toBe(true);
  });

  it('rejects when email is swapped', () => {
    const sig = signAuditSignupParam('jad@acmebank.com', 'audit-123');
    expect(verifyAuditSignupParam('attacker@evil.com', 'audit-123', sig)).toBe(false);
  });

  it('rejects when auditId is swapped', () => {
    const sig = signAuditSignupParam('jad@acmebank.com', 'audit-123');
    expect(verifyAuditSignupParam('jad@acmebank.com', 'audit-999', sig)).toBe(false);
  });

  it('rejects malformed sig', () => {
    expect(verifyAuditSignupParam('jad@acmebank.com', 'audit-123', '')).toBe(false);
    expect(verifyAuditSignupParam('jad@acmebank.com', 'audit-123', 'short')).toBe(false);
    // Legacy 64-char hex (pre-expiry format) — must be rejected; no dot.
    expect(
      verifyAuditSignupParam('jad@acmebank.com', 'audit-123', 'a'.repeat(64)),
    ).toBe(false);
    // Hex with dot but bad sig.
    expect(
      verifyAuditSignupParam(
        'jad@acmebank.com',
        'audit-123',
        `${Date.now() + 1000}.${'z'.repeat(64)}`,
      ),
    ).toBe(false);
  });

  it('rejects expired sig', () => {
    const sig = signAuditSignupParam('jad@acmebank.com', 'audit-123');
    const dot = sig.lastIndexOf('.');
    const hex = sig.slice(dot + 1);
    const expired = `${Date.now() - 1000}.${hex}`;
    expect(verifyAuditSignupParam('jad@acmebank.com', 'audit-123', expired)).toBe(false);
  });

  it('rejects tampered expiry (sig binds the expiry)', () => {
    const sig = signAuditSignupParam('jad@acmebank.com', 'audit-123');
    const dot = sig.lastIndexOf('.');
    const hex = sig.slice(dot + 1);
    // Shift expiry into the far future — sig was computed over a different expiry.
    const tampered = `${Date.now() + 10 * 365 * 24 * 3600 * 1000}.${hex}`;
    expect(verifyAuditSignupParam('jad@acmebank.com', 'audit-123', tampered)).toBe(false);
  });
});

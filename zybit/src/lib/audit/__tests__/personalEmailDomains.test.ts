import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isPersonalEmail,
  isAllowlistedTestEmail,
  extractDomain,
} from '../personalEmailDomains';

describe('isPersonalEmail', () => {
  it('rejects common personal domains', () => {
    expect(isPersonalEmail('a@gmail.com')).toBe(true);
    expect(isPersonalEmail('A@YAHOO.COM')).toBe(true);
    expect(isPersonalEmail('foo@icloud.com')).toBe(true);
  });

  it('accepts work-looking domains', () => {
    expect(isPersonalEmail('a@stripe.com')).toBe(false);
    expect(isPersonalEmail('a@acme.io')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isPersonalEmail('not-an-email')).toBe(false);
    expect(isPersonalEmail('@gmail.com')).toBe(false);
    expect(isPersonalEmail('foo@')).toBe(false);
  });
});

describe('extractDomain', () => {
  it('lowercases and trims', () => {
    expect(extractDomain('  Foo@Example.COM ')).toBe('example.com');
  });
  it('uses the last @ (for plus-aliasing edge cases)', () => {
    expect(extractDomain('a@b@example.com')).toBe('example.com');
  });
});

describe('isAllowlistedTestEmail', () => {
  beforeEach(() => {
    delete process.env.PUBLIC_AUDIT_TEST_EMAILS;
    delete process.env.NEXT_PUBLIC_AUDIT_TEST_EMAILS;
  });
  afterEach(() => {
    delete process.env.PUBLIC_AUDIT_TEST_EMAILS;
    delete process.env.NEXT_PUBLIC_AUDIT_TEST_EMAILS;
  });

  it('returns false when no env var is set', () => {
    expect(isAllowlistedTestEmail('foo@gmail.com')).toBe(false);
  });

  it('returns false for an empty env var', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS = '';
    expect(isAllowlistedTestEmail('foo@gmail.com')).toBe(false);
  });

  it('matches a single address (case-insensitive)', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS = 'gabriel.b.meredith@gmail.com';
    expect(isAllowlistedTestEmail('gabriel.b.meredith@gmail.com')).toBe(true);
    expect(isAllowlistedTestEmail('GABRIEL.B.MEREDITH@gmail.com')).toBe(true);
    expect(isAllowlistedTestEmail('someone-else@gmail.com')).toBe(false);
  });

  it('matches across comma-separated entries with whitespace', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS =
      ' alice@gmail.com , bob@yahoo.com ,charlie@icloud.com ';
    expect(isAllowlistedTestEmail('alice@gmail.com')).toBe(true);
    expect(isAllowlistedTestEmail('bob@yahoo.com')).toBe(true);
    expect(isAllowlistedTestEmail('charlie@icloud.com')).toBe(true);
    expect(isAllowlistedTestEmail('dave@gmail.com')).toBe(false);
  });

  it('reads NEXT_PUBLIC_ when the server-only var is unset', () => {
    process.env.NEXT_PUBLIC_AUDIT_TEST_EMAILS = 'gabe@gmail.com';
    expect(isAllowlistedTestEmail('gabe@gmail.com')).toBe(true);
  });

  it('unions both server-only and client-visible vars when both are set', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS = 'server@gmail.com';
    process.env.NEXT_PUBLIC_AUDIT_TEST_EMAILS = 'client@gmail.com';
    expect(isAllowlistedTestEmail('server@gmail.com')).toBe(true);
    expect(isAllowlistedTestEmail('client@gmail.com')).toBe(true);
    expect(isAllowlistedTestEmail('other@gmail.com')).toBe(false);
  });

  it('treats an empty PUBLIC_ as unset (does not suppress NEXT_PUBLIC_ fallback)', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS = '';
    process.env.NEXT_PUBLIC_AUDIT_TEST_EMAILS = 'gabe@gmail.com';
    expect(isAllowlistedTestEmail('gabe@gmail.com')).toBe(true);
  });

  it('trims and lowercases the input email before comparison', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS = 'gabe@gmail.com';
    expect(isAllowlistedTestEmail('  GABE@GMAIL.COM  ')).toBe(true);
  });

  it('returns false for empty input even when allowlist is set', () => {
    process.env.PUBLIC_AUDIT_TEST_EMAILS = 'gabe@gmail.com';
    expect(isAllowlistedTestEmail('')).toBe(false);
    expect(isAllowlistedTestEmail('   ')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { hashPassword, isAcceptablePassword, verifyPassword } from '../password';

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a unique salt per hash (no two hashes are identical)', async () => {
    expect(await hashPassword('same-input')).not.toBe(await hashPassword('same-input'));
  });

  it('uses the documented scrypt$N$salt$hash format', async () => {
    const hash = await hashPassword('whatever');
    const parts = hash.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBeGreaterThan(1);
  });

  it('returns false for null / empty / malformed stored hashes', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', undefined)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$32768$zz$zz')).toBe(false);
  });

  it('enforces password length bounds', () => {
    expect(isAcceptablePassword('short')).toBe(false);
    expect(isAcceptablePassword('12345678')).toBe(true);
    expect(isAcceptablePassword('a'.repeat(201))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { signSetPasswordToken, verifySetPasswordToken } from '../setPasswordToken';

describe('set-password tokens', () => {
  it('round-trips a signed token back to the normalized email', () => {
    const token = signSetPasswordToken('Jane@Company.com');
    expect(verifySetPasswordToken(token)).toBe('jane@company.com');
  });

  it('rejects a tampered signature', () => {
    const token = signSetPasswordToken('jane@company.com');
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifySetPasswordToken(tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSetPasswordToken('jane@company.com', -1);
    expect(verifySetPasswordToken(token)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifySetPasswordToken('')).toBeNull();
    expect(verifySetPasswordToken(undefined)).toBeNull();
    expect(verifySetPasswordToken('only.two')).toBeNull();
    expect(verifySetPasswordToken('a.b.c')).toBeNull();
  });
});

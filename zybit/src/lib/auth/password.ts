import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Owned password hashing with node:crypto scrypt — no new dependency, no
// heavyweight auth framework. Format: `scrypt$N$saltHex$hashHex` so the work
// factor travels with the hash and can be bumped without a migration.
//
// N is the scrypt cost parameter (CPU/memory). 2^15 = 32768 is a sensible
// 2025 default for an interactive login; verify cost stays well under a
// second. KEYLEN is the derived-key length in bytes.
const N = 32768;
const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt's default maxmem (32 MiB) is too small for N=32768 (needs ~128*N*r
// bytes ≈ 128*32768*8 ≈ 32 MiB plus overhead). Raise it so derivation doesn't
// throw "Invalid scrypt params".
const SCRYPT_OPTS = { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

export function isAcceptablePassword(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEYLEN, SCRYPT_OPTS);
  return `scrypt$${N}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 2) return false;
  if (!/^[0-9a-f]+$/.test(parts[2]) || !/^[0-9a-f]+$/.test(parts[3])) return false;

  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, {
      ...SCRYPT_OPTS,
      N: cost,
    });
  } catch {
    return false;
  }
  // Lengths are equal by construction (expected.length), so timingSafeEqual
  // won't throw — but guard anyway for hand-mangled hashes.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

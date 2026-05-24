import { lookup } from 'node:dns/promises';

// Ranges that must never be reachable from a public API endpoint.
// Tests the string representation of a resolved IPv4 or IPv6 address.
const BLOCKED_IPV4: RegExp[] = [
  /^127\./, // loopback
  /^10\./, // RFC 1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 class B
  /^192\.168\./, // RFC 1918 class C
  /^169\.254\./, // link-local (APIPA)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT (RFC 6598)
  /^(22[4-9]|23\d)\./, // multicast
  /^0\./, // "this" network
  /^192\.0\.2\./, // TEST-NET-1 (RFC 5737)
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^240\./, // reserved (future use)
];

const BLOCKED_IPV6: RegExp[] = [
  /^::1$/, // loopback
  /^fe80:/i, // link-local
  /^fc/i, // ULA (RFC 4193)
  /^fd/i, // ULA (RFC 4193)
  /^::$/, // unspecified
];

function isBlockedAddress(addr: string): boolean {
  if (addr.includes(':')) {
    return BLOCKED_IPV6.some((r) => r.test(addr));
  }
  return BLOCKED_IPV4.some((r) => r.test(addr));
}

export interface ValidationOk { valid: true; url: URL }
export interface ValidationFail { valid: false; reason: string }
export type ValidationResult = ValidationOk | ValidationFail;

export async function validatePublicUrl(raw: string): Promise<ValidationResult> {
  // Normalise — prepend https:// if missing
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { valid: false, reason: 'That doesn\'t look like a valid URL.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, reason: 'Only http and https URLs are supported.' };
  }

  const hostname = parsed.hostname;

  // Reject bare IP literals (IPv4 dotted-decimal or IPv6 brackets)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { valid: false, reason: 'IP address URLs are not accepted.' };
  }
  if (hostname.startsWith('[')) {
    return { valid: false, reason: 'IPv6 address URLs are not accepted.' };
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'localhost is not a valid audit target.' };
  }

  // Must have at least one dot (prevents bare hostnames like "intranet")
  if (!hostname.includes('.')) {
    return { valid: false, reason: 'Please enter a full domain like acme.com.' };
  }

  // DNS resolution — check every returned address
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { valid: false, reason: 'The domain couldn\'t be resolved. Double-check the URL.' };
  }

  if (addresses.length === 0) {
    return { valid: false, reason: 'The domain returned no DNS records.' };
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return {
        valid: false,
        reason: 'That domain resolves to a private network address and can\'t be audited.',
      };
    }
  }

  return { valid: true, url: parsed };
}

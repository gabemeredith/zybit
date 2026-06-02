import { decryptSecret } from '@/lib/crypto/secrets';
import { GA4ConnectorError } from './errors';

/**
 * Resolve the GA4 service-account key JSON. Mirrors `resolvePostHogSecret`:
 * self-service path is an encrypted blob in integration config; otherwise an
 * env-var named by `secretRef` (defaults to GOOGLE_SA_KEY).
 */
export function resolveGA4Secret(
  secretRef: string | null,
  config?: Record<string, unknown>,
): string {
  if (config?.serviceAccountEncrypted && typeof config.serviceAccountEncrypted === 'string') {
    try {
      const decrypted = decryptSecret(config.serviceAccountEncrypted);
      if (decrypted.length > 0) return decrypted;
    } catch {
      // fall through to env-var path
    }
  }

  const ref = secretRef && secretRef.trim().length > 0 ? secretRef.trim() : 'GOOGLE_SA_KEY';
  const raw = process.env[ref];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) {
    throw new GA4ConnectorError('GA4_AUTH', `Secret env var ${ref} is not set.`);
  }
  return value;
}

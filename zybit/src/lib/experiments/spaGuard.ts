/**
 * Zybit-123 — launch-time SPA-shell detection.
 *
 * The proxy applies variant modifications to the origin's server-rendered
 * HTML (`applyModifications` in `htmlModifier.ts`). On a client-side-rendered
 * SPA the target DOM nodes do not exist at request time, so the modification
 * is a silent no-op: variant-bucket traffic is served HTML identical to
 * control and the experiment concludes "no lift" on data that was never a
 * real variant. This guard fetches the target page before launch so the PM
 * can be warned before a doomed experiment pollutes outcome history.
 */
import { isSpaHtml } from '@/lib/phase2/snapshots/browserFetcher';

const LAUNCH_CHECK_TIMEOUT_MS = 8_000;

/**
 * Fetch `url` and report whether it renders as a client-side SPA shell.
 *
 * Fails open: any fetch error, timeout, or non-HTML response returns `false`
 * so a transient problem never blocks an otherwise-valid launch.
 */
export async function targetPageIsSpaShell(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ZybitLaunchCheck/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(LAUNCH_CHECK_TIMEOUT_MS),
    });
    // A non-2xx response (401/503/…) may return a minimal error page that
    // looks like a SPA shell — fail open rather than raise a false warning.
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) {
      return false;
    }
    return isSpaHtml(await res.text());
  } catch {
    return false;
  }
}

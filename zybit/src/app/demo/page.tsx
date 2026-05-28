/**
 * /demo — public entry point for the video-ready demo.
 *
 * - If the seed is already complete: mints a `zb_session` for the synthetic
 *   PM user and 302s to `/app`.
 * - If the seed hasn't run yet: kicks it off in the background and renders
 *   `SeedingScreen`, which polls `/api/demo/status` and reloads when done.
 *
 * The seed runs the real `/audit` pipeline (Firecrawl + Browserless +
 * Gemini) against commitmint.app, persists findings + brand DNA + fix
 * previews, then overlays a 14-day PostHog-shaped event stream and
 * provisions experiments. End-to-end the first run takes ~60–120 s; every
 * subsequent visit lands on `/app` instantly.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { readSeedStatus, seedDemo } from '@/lib/demo/seed';
import { ensureDemoUserAndMintSession } from '@/lib/demo/session';
import { sessionCookieOptions } from '@/lib/auth/session';
import SeedingScreen from '@/components/demo/SeedingScreen';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DemoEntryPage() {
  const status = await readSeedStatus();

  if (status.stage === 'done') {
    const token = await ensureDemoUserAndMintSession();
    if (token) {
      const cookieStore = await cookies();
      cookieStore.set({ ...sessionCookieOptions, value: token });
      redirect('/app');
    }
  }

  if (status.stage === 'idle' || status.stage === 'failed') {
    const h = await headers();
    const proto = h.get('x-forwarded-proto') ?? 'http';
    const host = h.get('host') ?? 'localhost:3000';
    void fetch(`${proto}://${host}/api/demo/seed`, { method: 'POST' }).catch(() => {});
    // Local fallback for when fetch back to ourselves is blocked.
    void seedDemo().catch(() => {});
  }

  return <SeedingScreen initialStatus={status} />;
}

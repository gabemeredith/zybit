/**
 * /demo — public entry point for the video-ready demo.
 *
 * Every visit resets the curated commitmint data so each presentation starts
 * clean:
 * - First visit (no findings yet): kicks off the full `/audit` pipeline
 *   (Firecrawl + Browserless + Gemini) in the background and renders
 *   `SeedingScreen`, which polls `/api/demo/status` and reloads when done.
 *   First run takes ~60–120 s.
 * - Subsequent visits: re-provisions the three demo experiments (wiping any the
 *   presenter created while clicking around) and re-applies the sign-up
 *   drop-off tune — sub-second, no re-audit — then signs in at `/app`.
 */
import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { readSeedStatus, seedDemo, resetDemoCuratedState } from '@/lib/demo/seed';
import SeedingScreen from '@/components/demo/SeedingScreen';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IN_PROGRESS_STAGES = new Set([
  'audit-running',
  'overlaying-events',
  'wiring-proxy',
  'creating-experiments',
]);

export default async function DemoEntryPage() {
  const status = await readSeedStatus();

  // First run (no findings) or a seed already mid-flight: run the full seed in
  // the background and show progress. SeedingScreen reloads /demo when done,
  // which then takes the reset-and-enter path below.
  if (status.findingCount === 0 || IN_PROGRESS_STAGES.has(status.stage)) {
    if (!IN_PROGRESS_STAGES.has(status.stage)) {
      after(async () => {
        try {
          await seedDemo();
        } catch (err) {
          console.error('[demo] background seed failed', err);
        }
      });
    }
    return <SeedingScreen initialStatus={status} />;
  }

  // Findings exist: reset the curated layer on every entry so the demo starts
  // clean, then hand off to the route handler that mints the session (cookies
  // can't be set during a page render) and redirects to /app. Fail open — a
  // reset hiccup shouldn't block entry.
  try {
    await resetDemoCuratedState();
  } catch (err) {
    console.error('[demo] curated-state reset failed', err);
  }
  redirect('/api/demo/enter');
}

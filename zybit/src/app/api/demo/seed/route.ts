/**
 * POST /api/demo/seed — kicks off the /demo seed in the background and
 * returns the current status snapshot. Idempotent: a second hit while a
 * seed is in flight piggybacks on the existing promise instead of
 * starting a parallel pipeline.
 *
 * No auth gate. The seed only writes to the synthetic
 * `lighthouse_org_urlaudit-commitmint-app` org and is bounded by the
 * audit pipeline's own daily budget cap.
 */
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { readSeedStatus, seedDemo } from '@/lib/demo/seed';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(): Promise<NextResponse> {
  const status = await readSeedStatus();
  if (status.stage === 'done') {
    return NextResponse.json({ success: true, status });
  }

  after(async () => {
    try {
      await seedDemo();
    } catch (err) {
      console.error('[demo/seed] background seed failed', err);
    }
  });

  return NextResponse.json({ success: true, status });
}

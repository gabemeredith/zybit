import { NextResponse } from 'next/server';
import { readSeedStatus } from '@/lib/demo/seed';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const status = await readSeedStatus();
  return NextResponse.json({ success: true, status });
}

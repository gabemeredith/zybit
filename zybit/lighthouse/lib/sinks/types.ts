/**
 * Event sink contract. Lets the Playwright driver emit events without
 * caring whether they're going straight into phase1_events (direct) or
 * out to PostHog's capture API (posthog).
 */

import type { CanonicalEventInput } from '@/lib/phase2/types';

export interface EventSink {
  emit(input: CanonicalEventInput): Promise<void>;
  flush(): Promise<{ written: number }>;
}

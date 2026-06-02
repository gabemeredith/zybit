/**
 * Direct event sink: buffers CanonicalEventInputs and batches them into
 * phase1_events via Zybit's Drizzle client + materializeCanonicalEvent.
 *
 * source defaults to 'posthog' so downstream rules treat these events
 * identically to real PostHog-sourced events. The dedupe-on-conflict
 * means re-running a scenario with the same sourceEventIds won't
 * double-insert.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { phase1Events } from '@/lib/db/schema';
import { materializeCanonicalEvent } from '@/lib/phase2/canonicalEvent';
import type { CanonicalEvent, CanonicalEventInput } from '@/lib/phase2/types';
import type { EventSink } from './types';

const DEFAULT_BATCH_SIZE = 500;

export interface DirectSinkOptions {
  organizationId: string;
  /** Override the default 'posthog' source for tests / niche scenarios. */
  defaultSource?: CanonicalEventInput['source'];
  /** Override the batch size — useful in tests. */
  batchSize?: number;
}

type Row = typeof phase1Events.$inferInsert;

function toRow(event: CanonicalEvent): Row {
  return {
    id: event.id,
    organizationId: event.organizationId,
    siteId: event.siteId,
    sessionId: event.sessionId,
    type: event.type,
    path: event.path,
    metrics: event.metrics ?? null,
    createdAt: new Date(event.createdAt),
    occurredAt: new Date(event.occurredAt),
    source: event.source,
    sourceEventId: event.sourceEventId ?? null,
    anonymousId: event.anonymousId ?? null,
    properties: event.properties ?? null,
    schemaVersion: event.schemaVersion,
  };
}

export class DirectEventSink implements EventSink {
  private buffer: Row[] = [];
  private writtenTotal = 0;
  private readonly organizationId: string;
  private readonly defaultSource: NonNullable<CanonicalEventInput['source']>;
  private readonly batchSize: number;

  constructor(opts: DirectSinkOptions) {
    this.organizationId = opts.organizationId;
    this.defaultSource = opts.defaultSource ?? 'posthog';
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async emit(input: CanonicalEventInput): Promise<void> {
    const now = new Date().toISOString();
    const event = materializeCanonicalEvent({
      input: { ...input, source: input.source ?? this.defaultSource },
      organizationId: this.organizationId,
      id: `lh_${randomUUID()}`,
      createdAt: now,
    });
    this.buffer.push(toRow(event));
    if (this.buffer.length >= this.batchSize) {
      await this.drain();
    }
  }

  async flush(): Promise<{ written: number }> {
    await this.drain();
    return { written: this.writtenTotal };
  }

  private async drain(): Promise<void> {
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    const db = getDb();
    const inserted = await db
      .insert(phase1Events)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: phase1Events.id });
    this.writtenTotal += inserted.length;
  }
}

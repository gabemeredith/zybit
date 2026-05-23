/**
 * Zybit-148 — Daily per-org rate limit + cost logging for the AI Variant
 * Advisor (Zybit-144).
 *
 * Why a separate table (vs. reusing `auth_rate_limits`): the auth table
 * runs an opportunistic cleanup that deletes any row >20 min old. A daily
 * AI counter would be wiped within minutes. Decoupled table, simple key.
 *
 * Semantics: denied calls do NOT increment the counter. The upsert uses
 * `WHERE call_count < AI_DAILY_LIMIT` on the conflict update — when at
 * limit the update doesn't fire and `RETURNING` is empty, which the caller
 * interprets as `denied`.
 *
 * UTC boundary: two calls straddling 23:59:59.999Z / 00:00:00.001Z land on
 * different `day_utc` keys and each see a fresh 1/LIMIT. Accepted — this
 * is a soft cost guard (10/org/day @ ~$0.001/call), not a security boundary,
 * so worst-case burst is 2×LIMIT at the rollover and only once per day.
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { logger } from '@/lib/observability/logger';

export const AI_DAILY_LIMIT = 10;

/** Format a Date as YYYY-MM-DD in UTC (the calendar-day window key). */
export function todayUtcKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type AiRateLimitResult =
  | { allowed: true; usedToday: number; remaining: number }
  | { allowed: false; usedToday: number; limit: number };

type CountRow = { call_count: number };

/**
 * Atomic check-and-increment. Allowed → counter bumped, returns post-bump
 * `usedToday` (1..LIMIT). Denied → counter untouched, returns LIMIT.
 *
 * Safe under concurrent calls: the upsert is a single statement, and the
 * `WHERE call_count < LIMIT` on the update ensures we never go past LIMIT
 * even under a tight race.
 */
export async function checkAndIncrementAiUsage(
  organizationId: string,
  now: Date = new Date(),
): Promise<AiRateLimitResult> {
  const db = getDb();
  const day = todayUtcKey(now);

  const result = await db.execute<CountRow>(sql`
    INSERT INTO phase2_ai_advisor_usage (organization_id, day_utc, call_count)
    VALUES (${organizationId}, ${day}, 1)
    ON CONFLICT (organization_id, day_utc) DO UPDATE
      SET call_count = phase2_ai_advisor_usage.call_count + 1
      WHERE phase2_ai_advisor_usage.call_count < ${AI_DAILY_LIMIT}
    RETURNING call_count
  `);

  const row = result.rows[0];
  if (!row) {
    return { allowed: false, usedToday: AI_DAILY_LIMIT, limit: AI_DAILY_LIMIT };
  }
  const count = Number(row.call_count);
  return { allowed: true, usedToday: count, remaining: AI_DAILY_LIMIT - count };
}

/**
 * Structured-log a single advisor call's token cost. The rate limiter caps
 * *call count*; tokens go to the log drain so ops can build cost dashboards
 * without a second DB column we'd have to migrate every time the model
 * pricing shape changes.
 */
export function logAiAdvisorUsage(args: {
  organizationId: string;
  findingId: string;
  model: string;
  promptTokens: number | null;
  responseTokens: number | null;
  durationMs: number;
  outcome: 'ok' | 'invalid_response' | 'upstream_error' | 'rate_limited';
}): void {
  logger.info('ai_advisor.call', {
    service: 'ai-advisor',
    organizationId: args.organizationId,
    findingId: args.findingId,
    model: args.model,
    promptTokens: args.promptTokens ?? 0,
    responseTokens: args.responseTokens ?? 0,
    durationMs: args.durationMs,
    outcome: args.outcome,
  });
}

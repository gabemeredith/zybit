import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

const WINDOW_MS = 10 * 60 * 1000; // 10-minute sliding window
const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;

type CountRow = { count: string };

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export async function checkAuthRateLimit(
  email: string,
  ip: string
): Promise<RateLimitResult> {
  const db = getDb();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  const retryAfterSeconds = Math.ceil((windowStart.getTime() + WINDOW_MS - now) / 1000);

  const emailKey = `email:${email}`;
  const ipKey = `ip:${ip}`;

  const [emailRow, ipRow] = await Promise.all([
    db.execute<CountRow>(sql`
      INSERT INTO auth_rate_limits (key, window_start, count)
      VALUES (${emailKey}, ${windowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = auth_rate_limits.count + 1
      RETURNING count
    `),
    db.execute<CountRow>(sql`
      INSERT INTO auth_rate_limits (key, window_start, count)
      VALUES (${ipKey}, ${windowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = auth_rate_limits.count + 1
      RETURNING count
    `),
  ]);

  const emailCount = Number((emailRow.rows[0] as CountRow).count);
  const ipCount = Number((ipRow.rows[0] as CountRow).count);

  if (emailCount > EMAIL_LIMIT || ipCount > IP_LIMIT) {
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

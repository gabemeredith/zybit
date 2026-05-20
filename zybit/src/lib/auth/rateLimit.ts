import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

// Fixed-width window duration. We use a two-bucket sliding-window approximation:
// effective_count = prev_window_count * (1 - elapsed/WINDOW_MS) + current_window_count
// This prevents the 2× burst that a naive fixed window allows at bucket boundaries.
const WINDOW_MS = 10 * 60 * 1000;
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
  const currentWindowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  const prevWindowStart = new Date(currentWindowStart.getTime() - WINDOW_MS);
  const elapsed = now - currentWindowStart.getTime();
  // Weight: what fraction of the previous window still falls inside our sliding window
  const prevWeight = (WINDOW_MS - elapsed) / WINDOW_MS;
  const retryAfterSeconds = Math.ceil((WINDOW_MS - elapsed) / 1000);

  const emailKey = `email:${email}`;
  const ipKey = `ip:${ip}`;

  // Upsert current-window counters + read previous-window counts in parallel.
  const [emailCurrent, emailPrev, ipCurrent, ipPrev] = await Promise.all([
    db.execute<CountRow>(sql`
      INSERT INTO auth_rate_limits (key, window_start, count)
      VALUES (${emailKey}, ${currentWindowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = auth_rate_limits.count + 1
      RETURNING count
    `),
    db.execute<CountRow>(sql`
      SELECT COALESCE(count, 0) AS count FROM auth_rate_limits
      WHERE key = ${emailKey} AND window_start = ${prevWindowStart}
    `),
    db.execute<CountRow>(sql`
      INSERT INTO auth_rate_limits (key, window_start, count)
      VALUES (${ipKey}, ${currentWindowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = auth_rate_limits.count + 1
      RETURNING count
    `),
    db.execute<CountRow>(sql`
      SELECT COALESCE(count, 0) AS count FROM auth_rate_limits
      WHERE key = ${ipKey} AND window_start = ${prevWindowStart}
    `),
  ]);

  const emailCurrentCount = Number((emailCurrent.rows[0] as CountRow).count);
  const emailPrevCount = Number(((emailPrev.rows[0] as CountRow | undefined)?.count) ?? 0);
  const ipCurrentCount = Number((ipCurrent.rows[0] as CountRow).count);
  const ipPrevCount = Number(((ipPrev.rows[0] as CountRow | undefined)?.count) ?? 0);

  // Sliding-window effective counts
  const emailEffective = emailPrevCount * prevWeight + emailCurrentCount;
  const ipEffective = ipPrevCount * prevWeight + ipCurrentCount;

  // Opportunistic cleanup: delete rows older than the previous window.
  // Runs on every auth request — auth volume is low so this keeps the table bounded.
  db.execute(sql`
    DELETE FROM auth_rate_limits WHERE window_start < ${prevWindowStart}
  `).catch(() => { /* non-fatal */ });

  if (emailEffective > EMAIL_LIMIT || ipEffective > IP_LIMIT) {
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

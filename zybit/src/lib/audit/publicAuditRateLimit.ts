import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

// Sliding-window limits per dimension.
// Two-bucket approximation: effective = prev * (1 - elapsed/WINDOW) + current
const LIMITS = {
  ip: { perMs: 60 * 60 * 1000, max: 3 }, // 3 per hour
  email: { perMs: 24 * 60 * 60 * 1000, max: 2 }, // 2 per 24 h
  emailDomain: { perMs: 24 * 60 * 60 * 1000, max: 10 }, // 10 per 24 h
  targetHost: { perMs: 24 * 60 * 60 * 1000, max: 5 }, // 5 per 24 h
} as const;

const DAILY_BUDGET_USD = 25;

type CountRow = { count: string };
type BudgetRow = { cost_usd: string };

export type AuditRateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterSeconds?: number };

async function checkDim(
  key: string,
  windowMs: number,
  max: number,
  now: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const db = getDb();
  const currentWindowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const prevWindowStart = new Date(currentWindowStart.getTime() - windowMs);
  const elapsed = now - currentWindowStart.getTime();
  const prevWeight = (windowMs - elapsed) / windowMs;
  const retryAfterSeconds = Math.ceil((windowMs - elapsed) / 1000);

  const [current, prev] = await Promise.all([
    db.execute<CountRow>(sql`
      INSERT INTO public_audit_rate_limits (key, window_start, count)
      VALUES (${key}, ${currentWindowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = public_audit_rate_limits.count + 1
      RETURNING count
    `),
    db.execute<CountRow>(sql`
      SELECT COALESCE(count, 0) AS count FROM public_audit_rate_limits
      WHERE key = ${key} AND window_start = ${prevWindowStart}
    `),
  ]);

  const curr = Number((current.rows[0] as CountRow).count);
  const prv = Number(((prev.rows[0] as CountRow | undefined)?.count) ?? 0);
  const effective = prv * prevWeight + curr;

  db.execute(sql`
    DELETE FROM public_audit_rate_limits WHERE window_start < ${prevWindowStart}
  `).catch(() => { /* non-fatal */ });

  return { allowed: effective <= max, retryAfterSeconds };
}

export async function checkPublicAuditRateLimit(opts: {
  ip: string;
  email: string;
  emailDomain: string;
  targetHost: string;
}): Promise<AuditRateLimitResult> {
  const now = Date.now();
  const { ip, email, emailDomain, targetHost } = opts;

  const [ipResult, emailResult, domainResult, hostResult] = await Promise.all([
    checkDim(`audit:ip:${ip}`, LIMITS.ip.perMs, LIMITS.ip.max, now),
    checkDim(`audit:email:${email}`, LIMITS.email.perMs, LIMITS.email.max, now),
    checkDim(`audit:dom:${emailDomain}`, LIMITS.emailDomain.perMs, LIMITS.emailDomain.max, now),
    checkDim(`audit:host:${targetHost}`, LIMITS.targetHost.perMs, LIMITS.targetHost.max, now),
  ]);

  if (!ipResult.allowed) {
    return {
      allowed: false,
      reason: 'Too many requests from your IP. Try again in an hour.',
      retryAfterSeconds: ipResult.retryAfterSeconds,
    };
  }
  if (!emailResult.allowed) {
    return {
      allowed: false,
      reason: 'That email address has already requested two audits today. Check your inbox.',
      retryAfterSeconds: emailResult.retryAfterSeconds,
    };
  }
  if (!domainResult.allowed) {
    return {
      allowed: false,
      reason: 'Too many audits from this email domain today.',
      retryAfterSeconds: domainResult.retryAfterSeconds,
    };
  }
  if (!hostResult.allowed) {
    return {
      allowed: false,
      reason: 'That site has already been audited multiple times today.',
      retryAfterSeconds: hostResult.retryAfterSeconds,
    };
  }

  return { allowed: true };
}

export async function checkDailyBudget(): Promise<AuditRateLimitResult> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  const result = await db.execute<BudgetRow>(sql`
    SELECT COALESCE(cost_usd, 0)::text AS cost_usd
    FROM public_audit_budget
    WHERE day_utc = ${today}
  `);

  const spent = Number((result.rows[0] as BudgetRow | undefined)?.cost_usd ?? 0);
  if (spent >= DAILY_BUDGET_USD) {
    return {
      allowed: false,
      reason: 'Daily audit capacity is full. Try again tomorrow.',
    };
  }
  return { allowed: true };
}

export async function recordAuditCost(costUsd: number): Promise<void> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  await db.execute(sql`
    INSERT INTO public_audit_budget (day_utc, cost_usd)
    VALUES (${today}, ${costUsd.toFixed(4)})
    ON CONFLICT (day_utc) DO UPDATE
      SET cost_usd = public_audit_budget.cost_usd + ${costUsd.toFixed(4)}
  `);
}

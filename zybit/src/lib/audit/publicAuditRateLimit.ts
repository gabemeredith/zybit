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

type BudgetRow = { cost_usd: string };

export type AuditRateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterSeconds?: number };

type DimSpec = { key: string; windowMs: number; max: number };

function windowBounds(windowMs: number, now: number) {
  const currentWindowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const prevWindowStart = new Date(currentWindowStart.getTime() - windowMs);
  const elapsed = now - currentWindowStart.getTime();
  const prevWeight = (windowMs - elapsed) / windowMs;
  const retryAfterSeconds = Math.ceil((windowMs - elapsed) / 1000);
  return { currentWindowStart, prevWindowStart, prevWeight, retryAfterSeconds };
}

/** Read-only check: would another request push this dimension over `max`? */
async function peekDim(
  spec: DimSpec,
  now: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const db = getDb();
  const { currentWindowStart, prevWindowStart, prevWeight, retryAfterSeconds } =
    windowBounds(spec.windowMs, now);

  const result = await db.execute<{ curr: string; prev: string }>(sql`
    SELECT
      COALESCE((SELECT count FROM public_audit_rate_limits
                WHERE key = ${spec.key} AND window_start = ${currentWindowStart}), 0)::text AS curr,
      COALESCE((SELECT count FROM public_audit_rate_limits
                WHERE key = ${spec.key} AND window_start = ${prevWindowStart}), 0)::text AS prev
  `);
  const row = result.rows[0] as { curr: string; prev: string } | undefined;
  const curr = Number(row?.curr ?? 0);
  const prv = Number(row?.prev ?? 0);
  // After increment, effective count = prev*weight + curr + 1
  const effectiveAfter = prv * prevWeight + curr + 1;
  return { allowed: effectiveAfter <= spec.max, retryAfterSeconds };
}

async function incrementDim(spec: DimSpec, now: number): Promise<void> {
  const db = getDb();
  const { currentWindowStart, prevWindowStart } = windowBounds(spec.windowMs, now);
  await db.execute(sql`
    INSERT INTO public_audit_rate_limits (key, window_start, count)
    VALUES (${spec.key}, ${currentWindowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE
      SET count = public_audit_rate_limits.count + 1
  `);
  db.execute(sql`
    DELETE FROM public_audit_rate_limits WHERE window_start < ${prevWindowStart}
  `).catch(() => { /* non-fatal */ });
}

export async function checkPublicAuditRateLimit(opts: {
  ip: string;
  email: string;
  emailDomain: string;
  targetHost: string;
}): Promise<AuditRateLimitResult> {
  const now = Date.now();
  const { ip, email, emailDomain, targetHost } = opts;

  const specs = {
    ip: { key: `audit:ip:${ip}`, windowMs: LIMITS.ip.perMs, max: LIMITS.ip.max },
    email: { key: `audit:email:${email}`, windowMs: LIMITS.email.perMs, max: LIMITS.email.max },
    domain: { key: `audit:dom:${emailDomain}`, windowMs: LIMITS.emailDomain.perMs, max: LIMITS.emailDomain.max },
    host: { key: `audit:host:${targetHost}`, windowMs: LIMITS.targetHost.perMs, max: LIMITS.targetHost.max },
  };

  // Phase 1 — read-only peek across all dimensions. A request that would
  // overflow any dimension is rejected without bumping the counters on the
  // other three, so a flood on one IP can't burn email/domain/host quotas.
  const [ipPeek, emailPeek, domainPeek, hostPeek] = await Promise.all([
    peekDim(specs.ip, now),
    peekDim(specs.email, now),
    peekDim(specs.domain, now),
    peekDim(specs.host, now),
  ]);

  if (!ipPeek.allowed) {
    return {
      allowed: false,
      reason: 'Too many requests from your IP. Try again in an hour.',
      retryAfterSeconds: ipPeek.retryAfterSeconds,
    };
  }
  if (!emailPeek.allowed) {
    return {
      allowed: false,
      reason: 'That email address has already requested two audits today. Check your inbox.',
      retryAfterSeconds: emailPeek.retryAfterSeconds,
    };
  }
  if (!domainPeek.allowed) {
    return {
      allowed: false,
      reason: 'Too many audits from this email domain today.',
      retryAfterSeconds: domainPeek.retryAfterSeconds,
    };
  }
  if (!hostPeek.allowed) {
    return {
      allowed: false,
      reason: 'That site has already been audited multiple times today.',
      retryAfterSeconds: hostPeek.retryAfterSeconds,
    };
  }

  // Phase 2 — all four dimensions pass; commit increments. Small race window
  // between peek and increment is acceptable: at worst a single extra request
  // sneaks in per dimension, which is well within the abuse tolerance for
  // these limits.
  await Promise.all([
    incrementDim(specs.ip, now),
    incrementDim(specs.email, now),
    incrementDim(specs.domain, now),
    incrementDim(specs.host, now),
  ]);

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

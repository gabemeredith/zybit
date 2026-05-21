/**
 * Structured JSON logger for observability.
 *
 * Outputs one JSON line per log entry so Vercel / Datadog / any log drain
 * can parse and index fields automatically.
 */

type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  service:
    | 'cron-sync'
    | 'insights-pipeline'
    | 'snapshot-fetcher'
    | 'proxy'
    | 'health-alert'
    | 'capture-record'
    | 'capture-cron'
    | 'snapshot-cron'
    | 'compute-outcomes';
  organizationId?: string;
  siteId?: string;
  [key: string]: unknown;
}

/**
 * Best-effort drain to Axiom. Fire-and-forget: logging must never block or
 * throw. Activates only when both AXIOM_TOKEN and AXIOM_DATASET are set, so
 * environments without Axiom keep behaving exactly as before.
 *
 * Note: in serverless runtimes a fire-and-forget request may be dropped if
 * the function freezes before it completes. For guaranteed delivery use
 * Axiom's platform-level Vercel log drain on top of the JSON console output;
 * this transport covers non-serverless runtimes and best-effort serverless.
 */
function drainToAxiom(entry: Record<string, unknown>): void {
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;
  if (!token || !dataset) return;

  void fetch(`https://api.axiom.co/v1/datasets/${encodeURIComponent(dataset)}/ingest`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([entry]),
  }).catch(() => {
    // Never let an observability failure surface to the caller.
  });
}

export function log(level: LogLevel, message: string, ctx: LogContext): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...ctx,
  };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
  drainToAxiom(entry);
}

export const logger = {
  info: (msg: string, ctx: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx: LogContext) => log('error', msg, ctx),
};

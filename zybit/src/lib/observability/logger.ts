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

export function log(level: LogLevel, message: string, ctx: LogContext): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...ctx,
  };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, ctx: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx: LogContext) => log('error', msg, ctx),
};

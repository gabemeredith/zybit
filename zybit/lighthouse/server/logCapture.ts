/**
 * Per-run developer log capture.
 *
 * Lighthouse runs the real Zybit pipeline in-process, and that pipeline (plus
 * every LLM call routed through `src/lib/observability/logger.ts`) already
 * emits structured JSON to `console`. Rather than rebuild a logger, we tap
 * `console` once at startup and attribute each line to whichever run is active
 * — tracked through the async call chain with `AsyncLocalStorage`, so a log
 * emitted deep inside `runUrlAudit` → `captureCopyCritique` → the OpenAI client
 * still lands on the right run.
 *
 * The original console behaviour is preserved (the dev terminal is unchanged);
 * capture is purely additive.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendLog } from './runs';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'ai' | 'snapshot' | 'db' | 'pipeline' | 'http' | 'other';

export interface LogEntry {
  /** ISO timestamp. */
  ts: string;
  level: LogLevel;
  category: LogCategory;
  /** Human-readable one-liner (parsed `message` for structured lines). */
  message: string;
  /** Structured fields when the line was JSON (model, tokens, latencyMs, …). */
  fields?: Record<string, unknown>;
}

/** Bound the active run's id through the async pipeline. */
export const runLogStore = new AsyncLocalStorage<{ runId: string }>();

/** Hard cap per run so a runaway loop can't exhaust memory. */
const MAX_ENTRIES_PER_RUN = 5_000;

/** Track per-run entry counts so we stop attributing past the cap. */
const counts = new Map<string, number>();

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** A structured logger.ts line looks like `{"level":"info","message":"…",…}`. */
function tryParseStructured(first: unknown): Record<string, unknown> | null {
  if (typeof first !== 'string') return null;
  const trimmed = first.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function classify(message: string, fields: Record<string, unknown> | null): LogCategory {
  const service = fields && typeof fields.service === 'string' ? fields.service : '';
  if (service === 'ai-advisor') return 'ai';
  const hay = `${message} ${service} ${fields ? Object.keys(fields).join(' ') : ''}`.toLowerCase();
  if (/openai|gpt-|gemini|layer ?b|inpaint|vision|copy.?critique|advisor|token|prompt|\bmodel\b|fix.?preview/.test(hay))
    return 'ai';
  if (/snapshot|browserless|firecrawl|crawl|capture|screenshot/.test(hay)) return 'snapshot';
  if (/\bdb\b|drizzle|\bquery\b|insert|upsert|neon|postgres|\bsql\b/.test(hay)) return 'db';
  if (/pipeline|insights|\brule\b|finding|experiment|outcome/.test(hay)) return 'pipeline';
  if (/\bhttp\b|fetch|request|route|status \d{3}/.test(hay)) return 'http';
  return 'other';
}

function toEntry(nativeLevel: LogLevel, args: unknown[]): LogEntry {
  const structured = tryParseStructured(args[0]);
  if (structured) {
    const level =
      structured.level === 'warn' || structured.level === 'error'
        ? (structured.level as LogLevel)
        : nativeLevel;
    const message =
      typeof structured.message === 'string' ? structured.message : safeStringify(structured);
    // Keep the structured fields minus the ones we surface separately.
    const rest = { ...structured };
    delete rest.level;
    delete rest.message;
    delete rest.timestamp;
    const fields = Object.keys(rest).length ? rest : undefined;
    return {
      ts: typeof structured.timestamp === 'string' ? structured.timestamp : new Date().toISOString(),
      level,
      category: classify(message, structured),
      message,
      ...(fields ? { fields } : {}),
    };
  }
  const message = args.map(safeStringify).join(' ');
  return {
    ts: new Date().toISOString(),
    level: nativeLevel,
    category: classify(message, null),
    message,
  };
}

let installed = false;

/**
 * Patch `console` once. Each call still hits the original method (terminal
 * output unchanged) and, when a run is active, is mirrored into that run's
 * log buffer.
 */
export function installLogCapture(): void {
  if (installed) return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const patch =
    (nativeLevel: LogLevel, passthrough: (...a: unknown[]) => void) =>
    (...args: unknown[]): void => {
      passthrough(...args);
      const store = runLogStore.getStore();
      if (!store) return;
      const seen = counts.get(store.runId) ?? 0;
      if (seen >= MAX_ENTRIES_PER_RUN) {
        if (seen === MAX_ENTRIES_PER_RUN) {
          counts.set(store.runId, seen + 1);
          appendLog(store.runId, {
            ts: new Date().toISOString(),
            level: 'warn',
            category: 'other',
            message: `[lighthouse] log buffer full (${MAX_ENTRIES_PER_RUN}); further lines for this run are dropped`,
          });
        }
        return;
      }
      counts.set(store.runId, seen + 1);
      try {
        appendLog(store.runId, toEntry(nativeLevel, args));
      } catch {
        // Never let capture break the pipeline.
      }
    };

  console.log = patch('info', original.log);
  console.info = patch('info', original.info);
  console.warn = patch('warn', original.warn);
  console.error = patch('error', original.error);
}

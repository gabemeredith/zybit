/**
 * In-memory run state for the Lighthouse generator. Persistence is
 * intentionally process-local — a server restart wipes the runs, which
 * is fine for a dev tool. Crash recovery is not a goal.
 */

import type { GenerateProgressEvent, GenerateResult } from '../lib/types';
import type { ContextComparison } from '../lib/eval/contextComparison';
import type { LogEntry } from './logCapture';

export type RunStatus = 'running' | 'done' | 'error';

export interface RunState {
  runId: string;
  scenarioId: string;
  startedAt: string;
  status: RunStatus;
  progress: GenerateProgressEvent[];
  /** Developer log stream captured from `console` while this run was active. */
  logs: LogEntry[];
  result?: GenerateResult;
  /** Set for context A/B eval runs (POST /lighthouse/api/eval/context). */
  evalComparison?: ContextComparison;
  error?: { message: string };
}

const runs = new Map<string, RunState>();

export function createRun(scenarioId: string): RunState {
  const runId = `lh_run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const state: RunState = {
    runId,
    scenarioId,
    startedAt: new Date().toISOString(),
    status: 'running',
    progress: [],
    logs: [],
  };
  runs.set(runId, state);
  return state;
}

export function appendProgress(runId: string, event: GenerateProgressEvent): void {
  const state = runs.get(runId);
  if (!state) return;
  state.progress.push(event);
}

export function appendLog(runId: string, entry: LogEntry): void {
  const state = runs.get(runId);
  if (!state) return;
  state.logs.push(entry);
}

export function completeRun(runId: string, result: GenerateResult): void {
  const state = runs.get(runId);
  if (!state) return;
  state.status = 'done';
  state.result = result;
}

export function completeEvalRun(runId: string, comparison: ContextComparison): void {
  const state = runs.get(runId);
  if (!state) return;
  state.status = 'done';
  state.evalComparison = comparison;
}

export function failRun(runId: string, err: unknown): void {
  const state = runs.get(runId);
  if (!state) return;
  state.status = 'error';
  state.error = {
    message: err instanceof Error ? err.message : String(err),
  };
}

export function getRun(runId: string): RunState | undefined {
  return runs.get(runId);
}

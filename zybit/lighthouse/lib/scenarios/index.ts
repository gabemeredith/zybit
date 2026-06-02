/**
 * Registry of available scenarios. Step 9 ships an empty registry —
 * the GUI handles an empty dropdown gracefully. Step 12 adds the
 * acmebank smoke scenario. User-fed bucketed sites get registered
 * here as individual scenario files.
 */

import type { Scenario } from '../types';

const scenarios: Scenario[] = [];

export function registerScenario(scenario: Scenario): void {
  if (scenarios.some((s) => s.id === scenario.id)) {
    throw new Error(`duplicate scenario id: ${scenario.id}`);
  }
  scenarios.push(scenario);
}

export function listScenarios(): Scenario[] {
  return scenarios.slice();
}

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}

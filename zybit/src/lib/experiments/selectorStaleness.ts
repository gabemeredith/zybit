/**
 * Selector staleness check (Zybit-133).
 *
 * A running experiment's variant modifications target the page by CSS
 * selector. If the customer ships a redesign, those selectors can silently
 * stop matching — the variant quietly becomes a no-op and the experiment
 * measures nothing. The daily `check-selectors` cron runs this against the
 * latest snapshot for each experiment's target path and emails the PM on a
 * miss. Pure: same modifications + snapshot → same result.
 */

import type { VariantModification } from './types';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import { countSelectorMatches } from '@/lib/phase2/snapshots/selectorUtils';

export interface StaleSelector {
  selector: string;
  reason: 'no_match' | 'invalid_selector';
}

/** The CSS selector a modification targets — `parentSelector` for reorders. */
function selectorOf(m: VariantModification): string | null {
  if ('selector' in m) return m.selector;
  if ('parentSelector' in m) return m.parentSelector;
  return null;
}

export function findStaleSelectors(
  modifications: VariantModification[],
  data: PageSnapshotData,
): StaleSelector[] {
  const stale: StaleSelector[] = [];
  const seen = new Set<string>();
  for (const m of modifications) {
    const selector = selectorOf(m)?.trim();
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    const { count, status } = countSelectorMatches(data, selector);
    if (status === 'invalid_selector') {
      stale.push({ selector, reason: 'invalid_selector' });
    } else if (count === 0) {
      stale.push({ selector, reason: 'no_match' });
    }
  }
  return stale;
}

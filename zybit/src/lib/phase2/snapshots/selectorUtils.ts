/**
 * Shared selector-matching helpers (Zybit-121 / Zybit-133).
 *
 * Builds a minimal HTML document from a structured page snapshot and counts
 * CSS-selector matches against it. Used by the live selector-validation badge
 * in the experiment builder and by the daily selector-staleness cron, so both
 * agree on what "the selector still matches" means.
 *
 * Covers tags, `data-zybit-ref` attributes, landmarks, hrefs and aria labels
 * from our extraction pass. Class-based selectors only match when the class
 * appears in the rendered text/aria — the snapshot doesn't retain raw classes.
 */

import { parse, type HTMLElement } from 'node-html-parser';
import type { PageSnapshotData } from './types';

export function buildMinimalHtml(data: PageSnapshotData): string {
  const parts: string[] = ['<html><body>'];

  for (const h of data.headings) {
    const tag = `h${h.level}`;
    const escaped = h.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    parts.push(`<${tag} data-idx="${h.documentIndex}">${escaped}</${tag}>`);
  }

  for (const cta of data.ctas) {
    const tag = cta.tag;
    const text = cta.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const href = cta.href ? ` href="${cta.href}"` : '';
    const aria = cta.ariaLabel ? ` aria-label="${cta.ariaLabel}"` : '';
    const disabled = cta.disabled ? ' disabled' : '';
    parts.push(
      `<${tag} data-zybit-ref="${cta.ref}" data-landmark="${cta.landmark}"${href}${aria}${disabled}>${text}</${tag}>`
    );
  }

  for (const form of data.forms) {
    const submitBtn = form.hasSubmitButton ? '<button type="submit">Submit</button>' : '';
    parts.push(`<form data-zybit-ref="${form.ref}" data-landmark="${form.landmark}">${submitBtn}</form>`);
  }

  parts.push('</body></html>');
  return parts.join('\n');
}

export type SelectorMatchStatus = 'ok' | 'empty' | 'invalid_selector';

export interface SelectorMatchResult {
  /** Number of matches, or null when the selector is empty/invalid. */
  count: number | null;
  status: SelectorMatchStatus;
}

export type SelectorStability = 'stable' | 'medium' | 'fragile';

/**
 * Rank how robust a selector is against page changes (Zybit-134). Stable
 * selectors (an explicit id or our injected `data-zybit-ref`) survive most
 * redesigns; positional selectors (`:nth-of-type`/`:nth-child`) break the
 * moment markup order shifts. Surfaced so PMs pick durable selectors and the
 * staleness cron (Zybit-133) fires less often. Pure.
 */
export function selectorStability(selector: string): SelectorStability {
  const s = selector.trim();
  // ID branch is anchored at start-of-string or after a CSS combinator so
  // `#` inside an attribute value (e.g. `a[href="#pricing"]`) doesn't match.
  if (/\[data-zybit-ref=|(^|[\s>+~,])#[A-Za-z]/.test(s)) return 'stable';
  if (/:nth-(of-type|child)\b|>\s*\*|:first-child|:last-child/.test(s)) return 'fragile';
  return 'medium';
}

/**
 * Parse a snapshot once. Reuse the returned root across many selector matches
 * to avoid rebuilding+reparsing the same HTML per call (the staleness cron
 * checks every selector on the same page snapshot).
 */
export function buildSelectorRoot(data: PageSnapshotData): HTMLElement {
  return parse(buildMinimalHtml(data));
}

/** Match a selector against an already-parsed root. Never throws. */
export function countSelectorMatchesAgainstRoot(
  root: HTMLElement,
  selector: string,
): SelectorMatchResult {
  const trimmed = selector.trim();
  if (!trimmed) return { count: null, status: 'empty' };
  try {
    return { count: root.querySelectorAll(trimmed).length, status: 'ok' };
  } catch {
    return { count: null, status: 'invalid_selector' };
  }
}

/** Count how many elements a selector matches in a snapshot. Never throws. */
export function countSelectorMatches(data: PageSnapshotData, selector: string): SelectorMatchResult {
  const trimmed = selector.trim();
  if (!trimmed) return { count: null, status: 'empty' };
  return countSelectorMatchesAgainstRoot(buildSelectorRoot(data), trimmed);
}

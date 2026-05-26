/**
 * Shared helpers for `proposeAnnotations`. Two patterns recur across the
 * 9 rules:
 *
 *   1. "Missing X" placeholder — the prescription says "add a quick-answer
 *      block / FAQ / proof line"; the annotation should show the *empty
 *      space* where the missing element belongs, not outline an unrelated
 *      existing element. Implemented as an `element-insert` + matching
 *      `css-inject` pair so the placeholder is visually distinct without
 *      relying on inline `style` attributes (which `sanitizeInsertHtml`
 *      strips on purpose).
 *
 *   2. "Look here →" caption — the prescription says "rewrite this headline"
 *      or "this CTA is broken"; the rule still highlights the existing
 *      element with an outline, but adds a small labeled caption next to it
 *      so the PM doesn't have to read the finding summary to know *why*
 *      it's outlined.
 *
 * Both helpers emit only `element-insert` + `css-inject` modifications,
 * which `htmlModifier.applyModifications` already handles. The
 * `data-zybit-annotation` attribute on every inserted node makes the
 * preview-screenshot diff debuggable.
 */

import type { VariantModification } from '@/lib/experiments/types';
import type { PageSnapshotData } from '@/lib/phase2/snapshots/types';
import type { HeadingItem } from '@/lib/phase2/snapshots/types';

/**
 * Insert a dashed-outline placeholder block labeled "Missing: <label>"
 * relative to an anchor. The annotation's class is namespaced per rule
 * to keep the css-inject scoped (no chance of bleeding into a co-rendered
 * preview surface).
 */
export function missingPlaceholder(args: {
  anchorSelector: string;
  position: 'before' | 'after' | 'prepend' | 'append';
  ruleClassName: string;
  label: string;
  color: string;
}): VariantModification[] {
  const cls = args.ruleClassName;
  return [
    {
      type: 'element-insert',
      selector: args.anchorSelector,
      position: args.position,
      html: `<div data-zybit-annotation="missing" class="${cls}"><strong>Missing:</strong> ${escapeText(args.label)}</div>`,
    },
    {
      type: 'css-inject',
      selector: `.${cls}`,
      css:
        `display: block; border: 3px dashed ${args.color}; padding: 18px 16px; ` +
        `margin: 12px 0; background: rgba(245, 158, 11, 0.08); color: #1f2937; ` +
        `font-family: system-ui, -apple-system, sans-serif; font-size: 14px; ` +
        `font-weight: 500; text-align: center; border-radius: 8px;`,
    },
  ];
}

/**
 * Insert a small labeled caption ("Rewrite to answer top-referrer question",
 * "Visitors rage-click here") relative to an anchor. Used by rules that
 * also outline an existing element via a separate css-inject — the caption
 * is the annotation's "why," the outline is the annotation's "what."
 */
export function annotationCaption(args: {
  anchorSelector: string;
  position: 'before' | 'after' | 'prepend' | 'append';
  ruleClassName: string;
  label: string;
  color: string;
}): VariantModification[] {
  const cls = args.ruleClassName;
  return [
    {
      type: 'element-insert',
      selector: args.anchorSelector,
      position: args.position,
      html: `<div data-zybit-annotation="caption" class="${cls}">${escapeText(args.label)}</div>`,
    },
    {
      type: 'css-inject',
      selector: `.${cls}`,
      css:
        `display: inline-block; background: ${args.color}; color: #fff; ` +
        `padding: 4px 10px; margin: 4px 0; font-family: system-ui, -apple-system, sans-serif; ` +
        `font-size: 12px; font-weight: 700; letter-spacing: 0.02em; border-radius: 4px; ` +
        `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);`,
    },
  ];
}

/** Outline an existing element with a dashed-colored border. */
export function outlineMod(selector: string, color: string): VariantModification {
  return {
    type: 'css-inject',
    selector,
    css: `outline: 3px dashed ${color} !important; outline-offset: 4px;`,
  };
}

/**
 * Build a `:nth-of-type` index for a heading. `:nth-of-type` counts
 * same-tag siblings within the parent, NOT a global document position —
 * so using `documentIndex + 1` is wrong whenever there are headings of
 * other levels earlier in the document. Example: on a page with
 * `[h2 idx=0, h1 idx=1]`, `documentIndex+1` would produce
 * `h1:nth-of-type(2)`, which matches nothing.
 *
 * This helper counts only headings of the same level appearing earlier
 * in the snapshot. On the example above the `h1` correctly resolves to
 * `:nth-of-type(1)`. This isn't a fully parent-scoped selector (we don't
 * know the parent path from a heading list), but for the common case of
 * one heading per level at the page root it produces a matching selector.
 */
export function nthOfTypeIndex(headings: HeadingItem[], target: HeadingItem): number {
  let earlier = 0;
  for (const h of headings) {
    if (h === target) break;
    if (h.documentIndex >= target.documentIndex) continue;
    if (h.level === target.level) earlier += 1;
  }
  return earlier + 1;
}

/**
 * First-heading selector for a snapshot. Prefer `<h1>`; fall back to the
 * earliest-encountered heading of any level. Returns `null` if the page
 * has no headings (in which case the rule should fall back to whatever
 * other anchor it can derive — usually the primary CTA).
 */
export function firstHeadingSelector(headings: HeadingItem[]): string | null {
  if (headings.length === 0) return null;
  const h1 = headings.find((h) => h.level === 1);
  const target = h1 ?? headings[0];
  return `h${target.level}:nth-of-type(${nthOfTypeIndex(headings, target)})`;
}

/** Convenience: get the first heading selector from a snapshot. */
export function snapshotHeadingSelector(snapshot: PageSnapshotData): string | null {
  return firstHeadingSelector(snapshot.headings ?? []);
}

/** HTML-escape so user copy that ends up in a label can't break out of attributes
 * or close the `<strong>` tag. The sanitizer already protects against this
 * for user-authored HTML; rule-authored copy gets the same treatment for
 * defense-in-depth. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

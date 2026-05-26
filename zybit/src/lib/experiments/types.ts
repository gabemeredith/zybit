/** Where to place inserted markup relative to the anchor element. Mirrors
 * the DOM `insertAdjacentHTML` positions so PMs reading the schema can
 * predict the outcome from web-platform intuition. */
export type InsertPosition = 'before' | 'after' | 'prepend' | 'append';

export const INSERT_POSITIONS: readonly InsertPosition[] = ['before', 'after', 'prepend', 'append'] as const;

export type VariantModification =
  | { type: 'css-inject'; selector: string; css: string }
  | { type: 'text-replace'; selector: string; text: string }
  | { type: 'element-hide'; selector: string }
  | { type: 'element-show'; selector: string }
  | { type: 'attribute-set'; selector: string; attr: string; value: string }
  | { type: 'element-reorder'; parentSelector: string; childOrder: number[] }
  | { type: 'element-insert'; selector: string; position: InsertPosition; html: string };

function isNonEmptyString(value: unknown): value is string {
  // Whitespace-only strings would pass a literal length check but throw
  // a `DOMException` at proxy time when handed to `document.querySelector`.
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns a PM-readable error string if the input isn't a valid
 * `VariantModification[]`, or `null` if it is. Type-discriminated:
 * each modification kind must carry the fields its proxy-time handler
 * actually reads. Without this, a request like
 * `{type:'element-insert', selector:'h1', position:'sideways'}` used to
 * pass and silently no-op at proxy time (`INSERT_POSITION_MAP['sideways']`
 * is undefined), so the experiment would run with a control-identical
 * variant. Same risk for `element-reorder` without `childOrder`, etc.
 */
export function validateModifications(modifications: unknown): string | null {
  if (!Array.isArray(modifications)) {
    return 'Modifications must be an array.';
  }
  for (let i = 0; i < modifications.length; i++) {
    const raw = modifications[i];
    if (!raw || typeof raw !== 'object') {
      return `Modification at index ${i} must be an object.`;
    }
    const mod = raw as Record<string, unknown>;
    const where = `Modification at index ${i}`;
    switch (mod.type) {
      case 'css-inject':
        if (!isNonEmptyString(mod.selector)) return `${where}: \`selector\` must be a non-empty string.`;
        if (typeof mod.css !== 'string') return `${where}: \`css\` must be a string.`;
        break;
      case 'text-replace':
        if (!isNonEmptyString(mod.selector)) return `${where}: \`selector\` must be a non-empty string.`;
        if (typeof mod.text !== 'string') return `${where}: \`text\` must be a string.`;
        break;
      case 'element-hide':
      case 'element-show':
        if (!isNonEmptyString(mod.selector)) return `${where}: \`selector\` must be a non-empty string.`;
        break;
      case 'attribute-set':
        if (!isNonEmptyString(mod.selector)) return `${where}: \`selector\` must be a non-empty string.`;
        if (!isNonEmptyString(mod.attr)) return `${where}: \`attr\` must be a non-empty string.`;
        if (typeof mod.value !== 'string') return `${where}: \`value\` must be a string.`;
        break;
      case 'element-reorder':
        if (!isNonEmptyString(mod.parentSelector)) return `${where}: \`parentSelector\` must be a non-empty string.`;
        if (!Array.isArray(mod.childOrder) || !mod.childOrder.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
          return `${where}: \`childOrder\` must be an array of non-negative integers.`;
        }
        break;
      case 'element-insert':
        if (!isNonEmptyString(mod.selector)) return `${where}: \`selector\` must be a non-empty string.`;
        if (typeof mod.position !== 'string' || !(INSERT_POSITIONS as readonly string[]).includes(mod.position)) {
          return `${where}: \`position\` must be one of ${INSERT_POSITIONS.join(', ')}.`;
        }
        // Empty html would round-trip through `sanitizeInsertHtml` and produce
        // a no-op `insertAdjacentHTML('', position)` at proxy time — the
        // experiment ships with a control-identical variant and pollutes the
        // outcome the same way a bad `position` would.
        if (!isNonEmptyString(mod.html)) return `${where}: \`html\` must be a non-empty string.`;
        break;
      default:
        return `${where}: unknown \`type\` ${JSON.stringify(mod.type)}.`;
    }
  }
  return null;
}

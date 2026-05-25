/** Where to place inserted markup relative to the anchor element. Mirrors
 * the DOM `insertAdjacentHTML` positions so PMs reading the schema can
 * predict the outcome from web-platform intuition. */
export type InsertPosition = 'before' | 'after' | 'prepend' | 'append';

export type VariantModification =
  | { type: 'css-inject'; selector: string; css: string }
  | { type: 'text-replace'; selector: string; text: string }
  | { type: 'element-hide'; selector: string }
  | { type: 'element-show'; selector: string }
  | { type: 'attribute-set'; selector: string; attr: string; value: string }
  | { type: 'element-reorder'; parentSelector: string; childOrder: number[] }
  | { type: 'element-insert'; selector: string; position: InsertPosition; html: string };

export function validateModifications(modifications: unknown): string | null {
  if (!Array.isArray(modifications)) {
    return 'Modifications must be an array.';
  }
  const VALID_MOD_TYPES = ['css-inject', 'text-replace', 'element-hide', 'element-show', 'attribute-set', 'element-reorder', 'element-insert'] as const;
  for (const mod of modifications) {
    if (!mod || typeof mod !== 'object' || !(VALID_MOD_TYPES as readonly string[]).includes(String((mod as Record<string, unknown>).type))) {
      return 'Each modification must have a valid `type`.';
    }
  }
  return null;
}

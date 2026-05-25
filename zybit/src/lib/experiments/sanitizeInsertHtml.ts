import { parse } from 'node-html-parser';

/**
 * Sanitize an HTML fragment that a PM (or AI) wants the proxy to splice into
 * a customer page via `element-insert`. This is the only modification type
 * that introduces new markup, so it's the only one that needs a real
 * sanitizer — the others only mutate properties of existing elements.
 *
 * Policy:
 *   - Tag allowlist (layout + text + simple media + links + buttons). Anything
 *     else is removed; its text content is preserved so a stray <article>
 *     doesn't silently delete the copy inside it.
 *   - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<svg>` and
 *     friends are dropped entirely (text content too — these don't contain
 *     readable copy worth keeping).
 *   - Attribute allowlist per tag. Unknown attributes are dropped silently.
 *   - All `on*` handler attributes are dropped, as is any `href`/`src` whose
 *     scheme is `javascript:`/`data:`/`vbscript:`. http(s)/mailto/tel and
 *     site-relative URLs pass.
 *   - Returns the empty string on parse failure rather than the original
 *     input — same fail-closed posture the rest of the experiment runtime
 *     uses for the one capability that could ship arbitrary markup.
 */

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'div', 'section', 'article', 'nav', 'aside', 'header', 'footer', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'strong', 'em', 'b', 'i', 'u', 'small', 'br', 'hr',
  'ul', 'ol', 'li',
  'a', 'button',
  'img',
]);

const TAGS_TO_DROP_WHOLESALE: ReadonlySet<string> = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'link', 'meta', 'base', 'form', 'input', 'textarea', 'select', 'option',
  'video', 'audio', 'source', 'track', 'canvas',
]);

// Per-tag attribute allowlist. `class` and `id` are allowed everywhere so PMs
// can target inserted markup with their own CSS or anchors.
const GLOBAL_ATTRS: ReadonlySet<string> = new Set(['class', 'id', 'title', 'role']);
const ATTRS_BY_TAG: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  button: new Set(['type']),
};

const SAFE_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Site-relative, root-relative, fragment, and protocol-relative-but-rooted
  // URLs all pass — they can't switch the page to a javascript: context.
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return true;
  // Anything with a scheme must be on the allowlist.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    return SAFE_URL_SCHEMES.has(schemeMatch[1].toLowerCase() + ':');
  }
  // No scheme and no leading slash → treat as a relative path; safe.
  return true;
}

interface NodeLike {
  nodeType: number;
  rawTagName?: string;
  attributes?: Record<string, string>;
  childNodes: NodeLike[];
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  remove(): void;
  replaceWith(...content: string[]): void;
  text: string;
}

function sanitizeNode(node: NodeLike): void {
  // Recurse first so we operate on a settled subtree (replacing a parent
  // before its children would orphan the unsanitized descendants).
  for (const child of [...node.childNodes]) sanitizeNode(child as NodeLike);

  if (node.nodeType !== 1) return; // not an element — text/comment, leave alone
  const tag = (node.rawTagName ?? '').toLowerCase();
  if (!tag) return;

  if (TAGS_TO_DROP_WHOLESALE.has(tag)) {
    node.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    // Preserve the inner text so copy isn't silently lost when a PM wraps
    // their section in a tag we don't allow.
    const text = node.text;
    if (text.trim().length > 0) node.replaceWith(text);
    else node.remove();
    return;
  }

  const allowed = ATTRS_BY_TAG[tag];
  for (const name of Object.keys(node.attributes ?? {})) {
    const lower = name.toLowerCase();
    // Strip every event handler regardless of tag — onclick, onerror, onload, …
    if (lower.startsWith('on')) {
      node.removeAttribute(name);
      continue;
    }
    if (lower === 'style') {
      // Inline style is fine for layout-only insertions but the easiest
      // injection vector — drop until we have a CSS-declarations validator.
      node.removeAttribute(name);
      continue;
    }
    const isGlobal = GLOBAL_ATTRS.has(lower);
    const isTagSpecific = allowed?.has(lower) ?? false;
    if (!isGlobal && !isTagSpecific) {
      node.removeAttribute(name);
      continue;
    }
    if (lower === 'href' || lower === 'src') {
      const value = node.attributes?.[name] ?? '';
      if (!isSafeUrl(value)) {
        node.removeAttribute(name);
      }
    }
  }
}

export function sanitizeInsertHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  let root: ReturnType<typeof parse>;
  try {
    root = parse(html);
  } catch {
    return '';
  }
  try {
    for (const child of [...root.childNodes]) sanitizeNode(child as unknown as NodeLike);
    return root.toString();
  } catch {
    return '';
  }
}

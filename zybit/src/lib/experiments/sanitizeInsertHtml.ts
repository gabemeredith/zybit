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
  // Normalize the same way the URL parser does:
  //   - Strip tab/newline/carriage-return/null bytes (WHATWG drops these
  //     mid-scheme). Without this, `java&#9;script:alert(1)` decodes to
  //     `java\tscript:alert(1)`, skips the scheme regex (which doesn't
  //     tolerate control chars), and falls through to "no scheme → safe".
  //   - Map `\` → `/`. For HTTP(S)-grounded pages the WHATWG path-start
  //     parser treats backslash identically to forward slash, so a payload
  //     like `<img src="\\//attacker.example/pixel">` resolves cross-origin
  //     in the browser even though it doesn't literally begin with `//`.
  //     Normalising backslashes before the protocol-relative check rejects
  //     both forms.
  const normalized = value.replace(/[\t\n\r\0]/g, '').replace(/\\/g, '/').trim();
  if (normalized.length === 0) return false;
  // Protocol-relative URLs (`//evil.com/x`) point at a third-party origin even
  // though they lack a scheme — reject before the leading-slash shortcut.
  if (normalized.startsWith('//')) return false;
  // Site-relative, root-relative, fragment, and query URLs all pass — they
  // can't switch the page to a javascript: context.
  if (normalized.startsWith('/') || normalized.startsWith('#') || normalized.startsWith('?')) return true;
  // Anything with a scheme must be on the allowlist.
  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):/i);
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
    // Drop the whole subtree. The text-preservation path used to call
    // `node.replaceWith(node.text)` here, but `node-html-parser`'s
    // `replaceWith` re-parses string arguments as HTML — so a payload like
    // `<marquee>&lt;script&gt;alert(1)&lt;/script&gt;</marquee>` decoded its
    // entities back into a live `<script>` tag in the parent, after this
    // subtree had already been sanitized. Allowed wrappers (`<article>`,
    // `<section>`, `<nav>`, `<aside>`, `<header>`, etc.) already cover every
    // legitimate text-preservation case; the only inputs that lose text now
    // are tags that don't belong in PM-authored copy in the first place.
    node.remove();
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

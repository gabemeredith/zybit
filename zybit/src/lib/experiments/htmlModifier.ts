import { parse } from 'node-html-parser';
import type { VariantModification, InsertPosition } from './types';
import { sanitizeInsertHtml } from './sanitizeInsertHtml';

const INSERT_POSITION_MAP: Record<InsertPosition, 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend'> = {
  before: 'beforebegin',
  prepend: 'afterbegin',
  append: 'beforeend',
  after: 'afterend',
};

/**
 * Applies variant modifications to an HTML string. Fails open: any thrown
 * error inside a single modification is swallowed and that modification
 * is skipped; a catastrophic parser failure returns the original markup
 * unchanged so the customer's site never crashes behind the proxy.
 */
export function applyModifications(
  html: string,
  modifications: VariantModification[],
): string {
  if (!modifications || modifications.length === 0) return html;

  let root: ReturnType<typeof parse>;
  try {
    root = parse(html);
  } catch {
    return html;
  }

  const cssRules: string[] = [];

  for (const mod of modifications) {
    try {
      switch (mod.type) {
        case 'css-inject':
          cssRules.push(`${mod.selector} { ${mod.css} }`);
          break;
        case 'element-hide':
          cssRules.push(`${mod.selector} { display: none !important; }`);
          break;
        case 'element-show':
          cssRules.push(`${mod.selector} { display: block !important; }`);
          break;
        case 'text-replace': {
          const el = root.querySelector(mod.selector);
          if (el) el.set_content(mod.text);
          break;
        }
        case 'attribute-set': {
          const el = root.querySelector(mod.selector);
          if (el) el.setAttribute(mod.attr, mod.value);
          break;
        }
        case 'element-insert': {
          const anchor = root.querySelector(mod.selector);
          if (!anchor) break;
          const safeHtml = sanitizeInsertHtml(mod.html);
          if (safeHtml.length === 0) break;
          anchor.insertAdjacentHTML(INSERT_POSITION_MAP[mod.position], safeHtml);
          break;
        }
        case 'element-reorder': {
          const parent = root.querySelector(mod.parentSelector);
          if (!parent) break;
          const currentStyle = parent.getAttribute('style') || '';
          if (
            !currentStyle.includes('display: flex') &&
            !currentStyle.includes('display: grid')
          ) {
            parent.setAttribute(
              'style',
              currentStyle ? `${currentStyle}; display: flex;` : 'display: flex;',
            );
          }
          const children = parent.childNodes.filter((n) => n.nodeType === 1);
          for (let i = 0; i < children.length && i < mod.childOrder.length; i++) {
            const child = children[i];
            if ('setAttribute' in child && typeof child.setAttribute === 'function') {
              (child as unknown as { setAttribute: (k: string, v: string) => void }).setAttribute(
                'style',
                `order: ${mod.childOrder[i]};`,
              );
            }
          }
          break;
        }
      }
    } catch {
      // Single modification failed (malformed selector, unsupported op, etc).
      // Skip it; other modifications still apply.
    }
  }

  if (cssRules.length > 0) {
    try {
      const styleTag = `<style data-zybit-variant>${cssRules.join('\n')}</style>`;
      const head = root.querySelector('head');
      if (head) {
        head.insertAdjacentHTML('beforeend', styleTag);
      } else {
        return styleTag + safeSerialize(root, html);
      }
    } catch {
      // Style injection failed; continue and serialize whatever we have.
    }
  }

  return safeSerialize(root, html);
}

function safeSerialize(root: ReturnType<typeof parse>, fallback: string): string {
  try {
    return root.toString();
  } catch {
    return fallback;
  }
}

// Attributes whose value can execute JavaScript when the page is rendered
// outside a sandboxed iframe. The screenshot pipeline (Browserless) renders
// the HTML in a real Chrome with scripting enabled, so CSP alone is not
// sufficient — these have to be stripped at the source.
const URL_ATTRS_WITH_JS_SCHEME = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'background',
  'poster',
]);

// Elements that can execute JavaScript or navigate the browser even after
// <script> tags are stripped. The screenshot path runs in real headless
// Chrome with no CSP, so:
//
//   <iframe src="data:text/html,<script>...</script>">      ← executes
//   <object data="data:text/html,..." type="text/html">     ← executes
//   <embed src="...">                                       ← can execute
//   <frame src="...">                                       ← legacy framing
//   <meta http-equiv="refresh" content="0;url=evil.com">    ← redirects Chrome
//
// We're showing a static visual preview, not running the customer's runtime,
// so just remove these elements wholesale. The iframe-preview path has
// `default-src 'none'; frame-src 'none'; object-src 'none'` in its CSP as a
// belt+braces — but the screenshot path has only this defense.
const FRAME_AND_EMBED_TAGS = new Set([
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
]);

/**
 * Remove all `<script>` tags (inline + external) plus inline event-handler
 * attributes (`onerror`, `onclick`, `onload`, …), `javascript:` and `data:`
 * URIs in url-bearing attributes, frame-creating elements
 * (`<iframe>`/`<object>`/`<embed>`/etc.), and `<meta http-equiv="refresh">`
 * tags from an HTML string. Used by preview surfaces that render less-trusted
 * content — we're showing visual changes, not running the customer's runtime.
 *
 * Fails **closed**: any parse or traversal error returns `''` (blank HTML).
 * Why: this is the only line of defense for the Browserless screenshot path,
 * which renders in real headless Chrome with no CSP. Returning the original
 * markup on error would hand customer-controlled `<script>` tags to Chrome
 * and allow exfiltration to remote URLs. A blank preview is the safe
 * degradation — the caller's UI already falls back to "preview unavailable".
 *
 * CSP on the preview route additionally blocks script execution in the
 * direct-nav case, but the screenshot path has only this defense.
 */
export function stripScripts(html: string): string {
  let root: ReturnType<typeof parse>;
  try {
    root = parse(html);
  } catch (err) {
    console.warn('[stripScripts] parse failed; failing closed', { error: String(err) });
    return '';
  }
  try {
    for (const el of root.querySelectorAll('script')) el.remove();
    // Frame/object/embed-style elements can execute scripts via data: URIs
    // or by navigating Chrome to attacker-controlled content.
    for (const el of root.querySelectorAll('*')) {
      if (FRAME_AND_EMBED_TAGS.has(el.tagName?.toLowerCase() ?? '')) {
        el.remove();
      }
    }
    // <meta http-equiv="refresh" content="0;url=..."> would redirect headless
    // Chrome away from the setContent payload before the screenshot fires.
    for (const el of root.querySelectorAll('meta')) {
      const httpEquiv = el.getAttribute('http-equiv');
      if (httpEquiv && httpEquiv.toLowerCase() === 'refresh') {
        el.remove();
      }
    }
    for (const el of root.querySelectorAll('*')) {
      const attrs = el.attributes;
      for (const name of Object.keys(attrs)) {
        const lower = name.toLowerCase();
        if (lower.startsWith('on')) {
          el.removeAttribute(name);
          continue;
        }
        if (URL_ATTRS_WITH_JS_SCHEME.has(lower)) {
          const value = attrs[name] ?? '';
          if (isJavaScriptUri(value) || isDataUri(value)) {
            el.removeAttribute(name);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[stripScripts] traversal failed; failing closed', { error: String(err) });
    return '';
  }
  // safeSerialize falls back to the original `html` on serialization error.
  // For the strip path that fallback would re-introduce scripts, so we want
  // a fail-closed fallback here too.
  try {
    return root.toString();
  } catch (err) {
    console.warn('[stripScripts] serialize failed; failing closed', { error: String(err) });
    return '';
  }
}

/**
 * True when `value` parses as a `javascript:` URI under browser URL rules.
 *
 * Browsers strip ASCII tab, LF, and CR from URLs before scheme parsing
 * (WHATWG URL spec), so `java&#x09;script:alert(1)` — which `node-html-parser`
 * decodes to `java\tscript:alert(1)` — still executes as `javascript:` in
 * Chrome. The naive `/^javascript:/i.test(value)` test misses this. We
 * normalize the same way the URL parser does before checking.
 */
function isJavaScriptUri(value: string): boolean {
  const normalized = value.replace(/[\t\n\r]/g, '');
  return /^\s*javascript:/i.test(normalized);
}

/**
 * True when `value` parses as any `data:` URI. We don't try to allow benign
 * subtypes (data:image/png, etc.) — relative image URLs go through `src=`
 * which still works, and the screenshot path's threat model treats every
 * data URI as untrusted because `data:text/html,...` is script-equivalent.
 */
function isDataUri(value: string): boolean {
  const normalized = value.replace(/[\t\n\r]/g, '');
  return /^\s*data:/i.test(normalized);
}

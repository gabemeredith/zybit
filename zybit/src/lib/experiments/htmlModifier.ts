import { parse } from 'node-html-parser';
import type { VariantModification } from './types';

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

/**
 * Remove all `<script>` tags (inline + external) from an HTML string. Used
 * by preview surfaces that render less-trusted content inside an iframe —
 * we're showing visual changes, not running the customer's runtime. Fails
 * open: parser failure returns the original markup unchanged.
 */
export function stripScripts(html: string): string {
  let root: ReturnType<typeof parse>;
  try {
    root = parse(html);
  } catch {
    return html;
  }
  try {
    for (const el of root.querySelectorAll('script')) el.remove();
  } catch {
    return html;
  }
  return safeSerialize(root, html);
}

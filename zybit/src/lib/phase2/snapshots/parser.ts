/**
 * Static HTML → PageSnapshotData parser.
 *
 * Pure function: takes a fetched HTML string and the URL it came from and
 * extracts the meta, heading, CTA, and form inventories the audit rules
 * reason about. No network IO, no JS execution.
 */

import { createHash, webcrypto } from 'node:crypto';
import { parse, type HTMLElement } from 'node-html-parser';

import { guessFold } from './foldGuess';
import { scoreVisualWeight } from './visualWeight';
import { detectCssSystem, extractClassTokens } from './cssSystemDetector';
import { computeCssSelector } from './cssSelector';
import {
  SnapshotError,
  type CtaCandidate,
  type FormCandidate,
  type FormInputItem,
  type HeadingItem,
  type ImageItem,
  type PageLandmark,
  type PageSnapshotMeta,
  type SnapshotParser,
} from './types';

const PARSE_OPTIONS = {
  lowerCaseTagName: true,
  comment: false,
  blockTextElements: {
    script: true,
    noscript: true,
    style: true,
    pre: false,
  },
};

const MAX_HEADINGS = 100;
const MAX_CTAS = 200;
const MAX_FORMS = 30;
const MAX_INPUTS_PER_FORM = 30;
const MAX_IMAGES = 200;
const TEXT_CAP = 200;

const LANDMARK_TAGS = ['header', 'nav', 'main', 'aside', 'footer', 'dialog'] as const;
type LandmarkTag = (typeof LANDMARK_TAGS)[number];

function isLandmarkTag(tag: string): tag is LandmarkTag {
  return (LANDMARK_TAGS as readonly string[]).includes(tag);
}

/**
 * node-html-parser declares parentNode as non-nullable, but the document
 * root resolves to a nullish parent at runtime. Localize the cast here.
 */
function parentOf(el: HTMLElement): HTMLElement | null {
  return (el as unknown as { parentNode: HTMLElement | null }).parentNode ?? null;
}

function getTag(el: HTMLElement | null | undefined): string {
  return (el?.tagName ?? '').toLowerCase();
}

function capText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, TEXT_CAP);
}

function computeLandmark(el: HTMLElement): PageLandmark {
  let cur = parentOf(el);
  while (cur) {
    const tag = getTag(cur);
    if (isLandmarkTag(tag)) return tag;
    cur = parentOf(cur);
  }
  return 'unknown';
}

function computeDomDepth(el: HTMLElement): number {
  let depth = 0;
  let cur = parentOf(el);
  while (cur) {
    depth++;
    cur = parentOf(cur);
  }
  return depth;
}

function computeBodyChildIndex(
  el: HTMLElement,
  body: HTMLElement | null,
): { bodyChildIndex: number; totalBodyChildren: number } {
  if (!body) return { bodyChildIndex: 0, totalBodyChildren: 0 };
  const bodyChildren = body.children;
  const totalBodyChildren = bodyChildren.length;

  let cur: HTMLElement | null = el;
  while (cur && parentOf(cur) !== body) {
    cur = parentOf(cur);
  }
  if (!cur) return { bodyChildIndex: 0, totalBodyChildren };
  const idx = bodyChildren.indexOf(cur);
  return { bodyChildIndex: idx < 0 ? 0 : idx, totalBodyChildren };
}

function findRootHtml(root: HTMLElement): HTMLElement | null {
  if (getTag(root) === 'html') return root;
  return root.querySelector('html');
}

function readMeta(root: HTMLElement): PageSnapshotMeta {
  const empty: PageSnapshotMeta = {
    title: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    description: null,
    canonical: null,
    lang: null,
    charset: null,
    themeColor: null,
    viewport: null,
    robotsMeta: null,
  };

  const head = root.querySelector('head');
  if (!head) return empty;

  const findContent = (selector: string): string | null =>
    capText(head.querySelector(selector)?.getAttribute('content'));

  const titleEl = head.querySelector('title');
  const html = findRootHtml(root);

  return {
    title: capText(titleEl?.text),
    ogTitle: findContent('meta[property="og:title"]'),
    ogDescription: findContent('meta[property="og:description"]'),
    ogImage: findContent('meta[property="og:image"]'),
    description: findContent('meta[name="description"]'),
    canonical: capText(head.querySelector('link[rel="canonical"]')?.getAttribute('href')),
    lang: capText(html?.getAttribute('lang')),
    charset: capText(head.querySelector('meta[charset]')?.getAttribute('charset')),
    themeColor: findContent('meta[name="theme-color"]'),
    viewport: findContent('meta[name="viewport"]'),
    robotsMeta: findContent('meta[name="robots"]'),
  };
}

function findHeadings(root: HTMLElement): HeadingItem[] {
  const elements = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const results: HeadingItem[] = [];
  let documentIndex = 0;
  for (const el of elements) {
    if (results.length >= MAX_HEADINGS) break;
    const tag = getTag(el);
    const level = Number(tag.slice(1));
    if (!Number.isInteger(level) || level < 1 || level > 6) continue;
    // `el.text` can be undefined when the parser hands back a node from a
    // truncated/malformed DOM (posthog.com hits this on >2 MB pages — the
    // capture is trimmed at the last `>` and a child element can land with
    // no text accessor). `?? ''` keeps the crash from poisoning the entire
    // audit run; the heading is simply skipped by the empty-text guard.
    const text = (el.text ?? '').trim().slice(0, TEXT_CAP);
    if (!text) continue;
    results.push({
      level: level as HeadingItem['level'],
      text,
      documentIndex,
      cssSelector: computeCssSelector(el, tag),
    });
    documentIndex++;
  }
  return results;
}

function isPrimaryCandidate(className: string | null, el: HTMLElement): boolean {
  if (className && (className.includes('primary') || className.includes('cta'))) return true;
  return el.hasAttribute('data-cta');
}

function isDisabled(el: HTMLElement): boolean {
  return (
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.hasAttribute('inert')
  );
}

function normalizeClasses(classes: string): string {
  // Sort tokens so formatter-driven reorderings (e.g. Tailwind's prettier
  // plugin) don't change the resulting hash for an otherwise identical CTA.
  return classes.split(/\s+/).filter(Boolean).sort().join(' ');
}

function hashCtaRef(tag: string, href: string | null, text: string, classes: string): string {
  return createHash('sha256')
    .update(`${tag}|${href ?? ''}|${text}|${normalizeClasses(classes)}`)
    .digest('hex')
    .slice(0, 16);
}

function firstImgAlt(el: HTMLElement): string {
  const img = el.querySelector('img[alt]');
  return img ? (img.getAttribute('alt') ?? '').trim() : '';
}

/**
 * Accessibility skip links ("Skip to content", "Skip to main content",
 * "Jump to navigation", etc.) are a11y affordances, not call-to-action
 * candidates. Including them in the CTA inventory pollutes every
 * downstream rule: they sort to documentIndex=0 on most pages, so the
 * synthetic generator's doc-order click weighting plus the public-audit
 * pipeline reports "your visitors want `Skip to content`" — which is
 * nonsense and destroys the audit's credibility. Detected via:
 *   - text content matching common skip patterns
 *   - href pointing at `#main`, `#content`, `#main-content`, `#skip`
 *   - class names containing `skip-link`, `sr-only`, `visually-hidden`
 *     (the last two are how skip links are conventionally visually hidden
 *     until focused)
 */
const SKIP_LINK_TEXT = /^(skip|jump)\s+(to|past|over)\s+(main|content|navigation|nav)/i;
const SKIP_LINK_HREF = /^#(main|content|main-content|skip|skip-link|skip-to-content|primary)$/i;
const SKIP_LINK_CLASS = /(^|\s)(skip-link|skip-to-content|sr-only|visually-hidden|screen-reader|usa-skipnav)(\s|$)/i;

function isSkipLink(el: HTMLElement, text: string, ariaLabel: string): boolean {
  if (SKIP_LINK_TEXT.test(text) || SKIP_LINK_TEXT.test(ariaLabel)) return true;
  const href = el.getAttribute('href') ?? '';
  if (SKIP_LINK_HREF.test(href)) return true;
  const cls = el.getAttribute('class') ?? '';
  if (cls && SKIP_LINK_CLASS.test(cls)) return true;
  return false;
}

// Browser-default chrome affordances. These are *always* navigation /
// dismiss controls — never conversion CTAs anywhere. Without this filter
// `hero-hierarchy-inversion` on Stripe `/enterprise` named the responsive
// nav's "Back" button as the "most visually emphasized CTA" and prescribed
// copying its styling — incoherent on a marketing page. Exact-match only:
// "Back" → chrome; "Back to overview" → real CTA. Plain "×"/"✕" close
// glyphs included; multi-letter labels like "Close panel" don't match.
const CHROME_BUTTON_TEXT = /^(back|close|dismiss|cancel|menu|search|open menu|open navigation|toggle menu|toggle navigation|×|✕|✖|\+|−|‒)$/i;

// Site brand logos are commonly authored as `<a href="/"><img alt="Stripe
// logo"></a>` — a navigation affordance to the homepage, not a conversion
// CTA. Without this filter `hero-hierarchy-inversion` on Stripe
// `/enterprise` named the Stripe logo as the most emphasized CTA after
// the Back-button filter cleared it from the inventory. Same shape:
// always brand chrome, never a conversion target. Matches plain `logo`
// or `<word> logo` (e.g. "Stripe logo", "Acme Inc logo").
const LOGO_ALT_TEXT = /^([a-z0-9][\w&.\- ]{0,40}\s)?logo$/i;

function isChromeButton(
  tag: string,
  text: string,
  ariaLabel: string,
  imgAlt: string,
  href: string | null,
): boolean {
  // Anchors with a real destination (not a fragment) are real links — never
  // chrome. Buttons + fragment-only anchors are candidates.
  const anchorIsReal = tag === 'a' && !!href && !href.startsWith('#');
  if (!anchorIsReal) {
    if (CHROME_BUTTON_TEXT.test(text)) return true;
    if (CHROME_BUTTON_TEXT.test(ariaLabel)) return true;
  }
  // Logos are a navigation affordance even when href="/"; filter regardless
  // of which accessible-name slot the alt text landed in. Stripe authors
  // their logo as `<a href="/"><span class="sr-only">Stripe logo</span>
  // <svg/></a>` so the alt text ends up in `text`, not in `imgAlt` —
  // checking only the alt-text fallback misses this pattern.
  if (LOGO_ALT_TEXT.test(text)) return true;
  if (LOGO_ALT_TEXT.test(imgAlt)) return true;
  if (LOGO_ALT_TEXT.test(ariaLabel)) return true;
  return false;
}

function findCtas(root: HTMLElement, body: HTMLElement | null): CtaCandidate[] {
  const elements = root.querySelectorAll('a, button');
  const candidates: HTMLElement[] = [];
  for (const el of elements) {
    if (candidates.length >= MAX_CTAS) break;
    const tag = getTag(el);
    if (tag !== 'a' && tag !== 'button') continue;
    const text = (el.text ?? '').trim();
    const ariaLabel = (el.getAttribute('aria-label') ?? '').trim();
    // Graphical buttons / logo links often have no text or aria-label and
    // rely on a child <img alt="..."> for their accessible name. Treat that
    // alt text as a label so we don't drop them from the inventory.
    const imgAlt = !text && !ariaLabel ? firstImgAlt(el) : '';
    if (!text && !ariaLabel && !imgAlt) continue;
    // Skip links are accessibility affordances, not CTAs — see isSkipLink doc.
    if (isSkipLink(el, text, ariaLabel)) continue;
    // Browser-default chrome buttons (Back / Close / Menu / × close glyphs)
    // and brand logo anchors are never conversion CTAs — see isChromeButton.
    const hrefForChromeCheck = tag === 'a' ? (el.getAttribute('href') ?? null) : null;
    if (isChromeButton(tag, text, ariaLabel, imgAlt, hrefForChromeCheck)) continue;
    candidates.push(el);
  }

  const results: CtaCandidate[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    const tag = getTag(el) as 'a' | 'button';
    const className = el.getAttribute('class') ?? null;
    const directText = (el.text ?? '').trim();
    // For graphical CTAs, fall back to the first child img's alt as the
    // visible label so downstream rules can reason about them.
    const text = (directText || firstImgAlt(el)).slice(0, TEXT_CAP);
    const href = tag === 'a' ? (el.getAttribute('href') ?? null) : null;
    const ariaLabel = (el.getAttribute('aria-label') ?? '').trim() || null;
    const landmark = computeLandmark(el);
    const { bodyChildIndex, totalBodyChildren } = computeBodyChildIndex(el, body);
    const primary = isPrimaryCandidate(className, el);

    const { weight, signals } = scoreVisualWeight({
      className,
      tag,
      landmark,
      ariaLabel,
      isPrimaryCandidate: primary,
    });

    const foldGuess = guessFold({
      landmark,
      documentIndex: i,
      totalCandidates: candidates.length,
      bodyChildIndex,
      totalBodyChildren,
    });

    results.push({
      ref: hashCtaRef(tag, href, text, className ?? ''),
      cssSelector: computeCssSelector(el, tag),
      tag,
      text,
      href,
      ariaLabel,
      landmark,
      visualWeight: weight,
      visualWeightSignals: signals,
      foldGuess,
      domDepth: computeDomDepth(el),
      documentIndex: i,
      disabled: isDisabled(el),
    });
  }
  return results;
}

function findInputLabel(
  root: HTMLElement,
  form: HTMLElement,
  input: HTMLElement,
): string | null {
  let cur = parentOf(input);
  while (cur && cur !== form) {
    if (getTag(cur) === 'label') return capText(cur.text);
    cur = parentOf(cur);
  }
  const id = input.getAttribute('id');
  if (!id) return null;
  // Per the HTML spec, <label for="..."> can live anywhere in the document,
  // not just inside the same <form>. Search the form first (most common /
  // cheapest case), then fall back to a document-wide scan.
  const formLabels = form.querySelectorAll('label');
  for (const lbl of formLabels) {
    if (lbl.getAttribute('for') === id) return capText(lbl.text);
  }
  const rootLabels = root.querySelectorAll('label');
  for (const lbl of rootLabels) {
    if (lbl.getAttribute('for') === id) return capText(lbl.text);
  }
  return null;
}

function readInputType(field: HTMLElement): string {
  const tag = getTag(field);
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  return field.getAttribute('type') ?? 'text';
}

function hashFormRef(action: string, innerSnippet: string): string {
  return createHash('sha256').update(`${action}|${innerSnippet}`).digest('hex').slice(0, 16);
}

function findImages(target: HTMLElement, ctaElements: Set<HTMLElement>): ImageItem[] {
  const elements = target.querySelectorAll('img');
  const results: ImageItem[] = [];
  let documentIndex = 0;
  for (const el of elements) {
    if (results.length >= MAX_IMAGES) break;
    const src = el.getAttribute('src') ?? '';
    if (!src) continue;
    const altAttr = el.getAttribute('alt');
    const hasAlt = altAttr !== null;
    const alt = hasAlt ? altAttr!.trim() : null;
    const widthAttr = el.getAttribute('width');
    const heightAttr = el.getAttribute('height');
    const width = widthAttr != null && /^\d+$/.test(widthAttr) ? parseInt(widthAttr, 10) : null;
    const height = heightAttr != null && /^\d+$/.test(heightAttr) ? parseInt(heightAttr, 10) : null;
    // ctaElements holds the img elements themselves (queried via
    // `a img, button img`), so a direct membership check is sufficient.
    const isCtaChild = ctaElements.has(el);
    results.push({ src: src.slice(0, TEXT_CAP), alt, hasAlt, width, height, isCtaChild, documentIndex });
    documentIndex++;
  }
  return results;
}

function findForms(root: HTMLElement, target: HTMLElement): FormCandidate[] {
  const forms = target.querySelectorAll('form');
  const results: FormCandidate[] = [];
  let documentIndex = 0;
  for (const form of forms) {
    if (results.length >= MAX_FORMS) break;
    const action = form.getAttribute('action') ?? '';
    const innerSnippet = form.innerHTML.slice(0, TEXT_CAP);
    const landmark = computeLandmark(form);
    // Skip hidden inputs (CSRF tokens, tracking ids, etc.) — they don't
    // contribute to the visual form hierarchy our audit reasons about.
    const fields = form
      .querySelectorAll('input, select, textarea')
      .filter((field) => field.getAttribute('type') !== 'hidden');
    const fieldCount = fields.length;
    const inputs: FormInputItem[] = [];
    for (const field of fields) {
      if (inputs.length >= MAX_INPUTS_PER_FORM) break;
      const name = field.getAttribute('name') ?? null;
      inputs.push({
        type: readInputType(field),
        name,
        required: field.hasAttribute('required'),
        labelText: findInputLabel(root, form, field),
      });
    }
    // Bare <button> inside <form> defaults to type=submit per HTML spec.
    const explicitSubmit =
      form.querySelector('button[type="submit"]') ??
      form.querySelector('input[type="submit"]');
    const bareButton = form
      .querySelectorAll('button')
      .find((btn) => !btn.hasAttribute('type'));
    const submit = explicitSubmit ?? bareButton ?? null;
    results.push({
      ref: hashFormRef(action, innerSnippet),
      cssSelector: computeCssSelector(form, 'form'),
      landmark,
      fieldCount,
      inputs,
      documentIndex,
      hasSubmitButton: submit !== null,
    });
    documentIndex++;
  }
  return results;
}

function normalizeHtmlForHash(root: HTMLElement): string {
  // tags are already lowercased via parser options; collapse all whitespace.
  return root.toString().replace(/\s+/g, ' ').trim();
}

export const parseSnapshot: SnapshotParser = async (input) => {
  try {
    const root = parse(input.html, PARSE_OPTIONS);
    const body = root.querySelector('body');
    const target = body ?? root;

    const meta = readMeta(root);
    const headings = findHeadings(target);
    const ctas = findCtas(target, body);
    const forms = findForms(root, target);
    // Build a set of <img> elements that are direct children of CTA anchors/buttons
    // so imageAltTextMissing can skip them (CTA images already handled by the CTA parser).
    const ctaImgSet = new Set<HTMLElement>(
      target.querySelectorAll('a img, button img') as unknown as HTMLElement[],
    );
    const images = findImages(target, ctaImgSet);
    // Strip <script>, <style>, and <noscript> before hashing — they often
    // carry per-request noise (nonces, csrf tokens, build hashes, analytics
    // payloads) that would otherwise drift contentHash on every fetch even
    // when the visible design is identical.
    for (const el of Array.from(root.querySelectorAll('script, style, noscript'))) {
      el.remove();
    }
    const normalized = normalizeHtmlForHash(root);
    const contentHashHex = Buffer.from(
      await webcrypto.subtle.digest('SHA-256', Buffer.from(normalized, 'utf8')),
    ).toString('hex');

    const cssSystem = detectCssSystem(extractClassTokens(input.html));

    return {
      schemaVersion: 1,
      meta,
      headings,
      ctas,
      forms,
      images,
      contentHash: contentHashHex,
      rawByteSize: input.rawByteSize,
      parsedAt: new Date().toISOString(),
      cssSystem: cssSystem !== 'unknown' ? cssSystem : undefined,
    };
  } catch (err) {
    if (err instanceof SnapshotError) throw err;
    throw new SnapshotError('PARSE_ERROR', err instanceof Error ? err.message : 'parse failed', err);
  }
};

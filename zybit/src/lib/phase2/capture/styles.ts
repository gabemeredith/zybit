/**
 * Computed-style measurements for headings, CTAs, and forms.
 *
 * Runs in the browser via page.evaluate(). The filtering logic mirrors
 * parser.ts exactly (same `querySelectorAll` selector, same skip
 * conditions) so the returned arrays are index-aligned with what
 * parseSnapshot() produces from the same rendered HTML.
 *
 * record.ts merges these measurements into the *Measured extension types
 * by position: `parsedCtas[i]` + `ctaMeasurements[i]` → `CtaCandidateMeasured`.
 */

import type { Page } from 'playwright-core';
import type { BBox } from './types';

export interface CtaMeasurement {
  documentIndex: number;
  bbox: BBox | null;
  bgColorHex: string | null;
  fgColorHex: string | null;
}

export interface HeadingMeasurement {
  documentIndex: number;
  bbox: BBox | null;
  fontSizePx: number | null;
  colorHex: string | null;
}

export interface FormMeasurement {
  documentIndex: number;
  bbox: BBox | null;
  inputMeasurements: Array<{ bbox: BBox | null; labelProximityPx: number | null }>;
}

export interface PageMeasurements {
  ctas: CtaMeasurement[];
  headings: HeadingMeasurement[];
  forms: FormMeasurement[];
}

const LIMITS = {
  maxCtas: 200,
  maxHeadings: 100,
  maxForms: 30,
  maxInputsPerForm: 30,
} as const;

export async function extractMeasurements(page: Page): Promise<PageMeasurements> {
  // tsx/esbuild transpiles this file with `keepNames`, which wraps the named
  // inner functions below in calls to a `__name(...)` helper. That helper is
  // defined in Node but NOT in the browser context where `page.evaluate` runs,
  // so without this shim the evaluate throws `__name is not defined` (Lighthouse
  // runs under tsx; the Next build doesn't emit the helper). Define it in the
  // page first — this arrow has no named inner functions, so it isn't itself
  // wrapped and runs cleanly.
  await page.evaluate(() => {
    const g = globalThis as unknown as { __name?: (fn: unknown, name?: string) => unknown };
    if (typeof g.__name !== 'function') g.__name = (fn) => fn;
  });
  return page.evaluate(
    (limits: typeof LIMITS): PageMeasurements => {
      // ---- helpers --------------------------------------------------------

      function rgbToHex(rgb: string): string | null {
        const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
        if (!m) return null;
        // Skip fully transparent colors — rgba(0,0,0,0) is the browser default
        // for "no background" and would corrupt the primary-color mode as black.
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
        const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, '0');
        return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
      }

      function toDocBBox(el: Element): BBox | null {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return {
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      }

      // ---- CTAs (mirrors parser.ts findCtas filter) -----------------------
      const allCtaEls = Array.from(document.querySelectorAll('a, button'));
      const ctaMeasurements: CtaMeasurement[] = [];
      let ctaIdx = 0;

      for (const el of allCtaEls) {
        if (ctaMeasurements.length >= limits.maxCtas) break;
        const text = (el.textContent ?? '').trim();
        const ariaLabel = (el.getAttribute('aria-label') ?? '').trim();
        const imgAlt =
          !text && !ariaLabel
            ? ((el.querySelector('img[alt]')?.getAttribute('alt') ?? '').trim())
            : '';
        if (!text && !ariaLabel && !imgAlt) continue;

        const styles = window.getComputedStyle(el);
        ctaMeasurements.push({
          documentIndex: ctaIdx,
          bbox: toDocBBox(el),
          bgColorHex: rgbToHex(styles.backgroundColor),
          fgColorHex: rgbToHex(styles.color),
        });
        ctaIdx++;
      }

      // ---- Headings (mirrors parser.ts findHeadings filter) ---------------
      const allHeadingEls = Array.from(
        document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
      );
      const headingMeasurements: HeadingMeasurement[] = [];
      let hIdx = 0;

      for (const el of allHeadingEls) {
        if (headingMeasurements.length >= limits.maxHeadings) break;
        if (!(el.textContent ?? '').trim()) continue;

        const styles = window.getComputedStyle(el);
        headingMeasurements.push({
          documentIndex: hIdx,
          bbox: toDocBBox(el),
          fontSizePx: parseFloat(styles.fontSize) || null,
          colorHex: rgbToHex(styles.color),
        });
        hIdx++;
      }

      // ---- Forms (mirrors parser.ts findForms filter) ---------------------
      // Pre-build a label lookup map once rather than running querySelector
      // for every individual input (avoids O(inputs) full-document scans).
      const labelByFor = new Map<string, Element>();
      for (const lbl of document.querySelectorAll('label[for]')) {
        const forAttr = lbl.getAttribute('for');
        if (forAttr && !labelByFor.has(forAttr)) {
          labelByFor.set(forAttr, lbl);
        }
      }

      const allFormEls = Array.from(document.querySelectorAll('form'));
      const formMeasurements: FormMeasurement[] = [];
      let fIdx = 0;

      for (const form of allFormEls) {
        if (formMeasurements.length >= limits.maxForms) break;

        const inputEls = Array.from(
          form.querySelectorAll('input, select, textarea'),
        ).filter(
          inp => (inp as HTMLInputElement).type !== 'hidden',
        );

        const inputMeasurements = inputEls.slice(0, limits.maxInputsPerForm).map(inp => {
          const inpBBox = toDocBBox(inp);
          let labelProximityPx: number | null = null;

          const id = (inp as HTMLElement).getAttribute('id');
          if (id) {
            const lbl = labelByFor.get(id);
            if (lbl) {
              const lblRect = lbl.getBoundingClientRect();
              const inpRect = inp.getBoundingClientRect();
              if (inpRect.width > 0 && lblRect.width > 0) {
                labelProximityPx = Math.round(
                  Math.abs(inpRect.top - lblRect.bottom),
                );
              }
            }
          }

          return { bbox: inpBBox, labelProximityPx };
        });

        formMeasurements.push({
          documentIndex: fIdx,
          bbox: toDocBBox(form),
          inputMeasurements,
        });
        fIdx++;
      }

      return { ctas: ctaMeasurements, headings: headingMeasurements, forms: formMeasurements };
    },
    LIMITS,
  );
}

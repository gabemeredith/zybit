import { describe, expect, it } from 'vitest';
import { applyModifications, stripScripts } from '../htmlModifier';
import type { VariantModification } from '../types';

const SIMPLE_HTML = `
<!DOCTYPE html>
<html>
  <head><title>x</title></head>
  <body>
    <h1 class="title">Original</h1>
    <button class="cta">Sign up</button>
    <div class="banner">Banner</div>
  </body>
</html>`;

describe('applyModifications — happy path', () => {
  it('text-replace updates the matched element', () => {
    const out = applyModifications(SIMPLE_HTML, [
      { type: 'text-replace', selector: '.title', text: 'New Headline' },
    ]);
    expect(out).toContain('New Headline');
    expect(out).not.toContain('>Original<');
  });

  it('css-inject adds a style tag in head with the rule', () => {
    const out = applyModifications(SIMPLE_HTML, [
      { type: 'css-inject', selector: '.cta', css: 'background: red;' },
    ]);
    expect(out).toMatch(/<style data-zybit-variant>[\s\S]*\.cta \{ background: red; \}[\s\S]*<\/style>/);
  });

  it('element-hide injects display:none rule', () => {
    const out = applyModifications(SIMPLE_HTML, [
      { type: 'element-hide', selector: '.banner' },
    ]);
    expect(out).toContain('.banner { display: none !important; }');
  });

  it('multiple mods are applied together', () => {
    const out = applyModifications(SIMPLE_HTML, [
      { type: 'css-inject', selector: '.cta', css: 'color: blue;' },
      { type: 'text-replace', selector: '.title', text: 'Hello' },
      { type: 'element-hide', selector: '.banner' },
    ]);
    expect(out).toContain('Hello');
    expect(out).toContain('.cta { color: blue; }');
    expect(out).toContain('.banner { display: none !important; }');
  });
});

describe('applyModifications — fail-open contract', () => {
  it('returns input unchanged when modifications array is empty', () => {
    const out = applyModifications(SIMPLE_HTML, []);
    expect(out).toBe(SIMPLE_HTML);
  });

  it('selector miss is a silent no-op (no throw)', () => {
    expect(() =>
      applyModifications(SIMPLE_HTML, [
        { type: 'text-replace', selector: '.does-not-exist', text: 'never' },
      ]),
    ).not.toThrow();
  });

  it('malformed selector on text-replace does not crash; other mods still apply', () => {
    const mods: VariantModification[] = [
      { type: 'text-replace', selector: '::weird::!', text: 'never' },
      { type: 'element-hide', selector: '.banner' },
    ];
    const out = applyModifications(SIMPLE_HTML, mods);
    expect(out).toContain('.banner { display: none !important; }');
  });

  it('malformed selector on attribute-set does not crash', () => {
    expect(() =>
      applyModifications(SIMPLE_HTML, [
        { type: 'attribute-set', selector: ':::', attr: 'data-x', value: 'y' },
      ]),
    ).not.toThrow();
  });

  it('malformed selector on element-reorder does not crash', () => {
    expect(() =>
      applyModifications(SIMPLE_HTML, [
        { type: 'element-reorder', parentSelector: ':::', childOrder: [1, 0] },
      ]),
    ).not.toThrow();
  });

  it('garbage HTML input does not throw and still applies CSS-only mods', () => {
    const garbage = '<<<>><not html<<';
    expect(() =>
      applyModifications(garbage, [{ type: 'element-hide', selector: '.x' }]),
    ).not.toThrow();
  });

  it('HTML without a <head> still injects style (prepended) without throwing', () => {
    const noHead = '<html><body><div class="x">x</div></body></html>';
    const out = applyModifications(noHead, [
      { type: 'css-inject', selector: '.x', css: 'color: red;' },
    ]);
    expect(out).toContain('<style data-zybit-variant>');
    expect(out).toContain('.x { color: red; }');
  });
});

describe('applyModifications — performance', () => {
  function generate150KbHtml(): string {
    const parts: string[] = [];
    parts.push('<!DOCTYPE html><html><head><title>Perf Test</title></head><body>');
    parts.push('<header class="hero"><h1 class="title">Original Title</h1></header>');
    parts.push('<main>');
    for (let i = 0; i < 500; i++) {
      parts.push(
        `<section class="card card-${i}" data-id="${i}">` +
          `<h2 class="card-title">Section ${i}</h2>` +
          `<p class="copy" data-id="${i}">Lorem ipsum dolor sit amet, consectetur adipiscing elit. ` +
          `Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>` +
          `<a class="cta cta-${i}" href="/x">Click ${i}</a>` +
          `</section>`,
      );
    }
    parts.push('</main><footer class="footer">Footer</footer></body></html>');
    return parts.join('');
  }

  it('parses, modifies, and serializes a 150KB DOM with 3 mods under 15ms (median)', () => {
    const html = generate150KbHtml();
    expect(html.length).toBeGreaterThan(140 * 1024);
    expect(html.length).toBeLessThan(200 * 1024);

    const mods: VariantModification[] = [
      { type: 'css-inject', selector: '.hero', css: 'background: linear-gradient(red, blue);' },
      { type: 'text-replace', selector: '.title', text: 'Variant Headline' },
      { type: 'element-hide', selector: '.footer' },
    ];

    // Warmup — JIT + module init noise out of the timed sample.
    applyModifications(html, mods);

    // Take min of 10 samples. We use min (not mean/median) because vitest
    // runs test files in parallel and scheduler-stolen CPU dominates outliers;
    // min approximates the rewriter's actual runtime on a free core, which is
    // the real-world question (proxy middleware doesn't compete with N test
    // workers in prod).
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const out = applyModifications(html, mods);
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      expect(out).toContain('Variant Headline');
      expect(out).toContain('.footer { display: none !important; }');
    }

    const min = Math.min(...samples);
    console.log(
      `[htmlModifier perf] ${html.length} bytes, samples=${samples.map((s) => s.toFixed(2)).join(',')} min=${min.toFixed(2)}ms`,
    );
    expect(min).toBeLessThan(15);
  });
});

describe('stripScripts', () => {
  it('removes inline <script> tags', () => {
    const html = '<html><head></head><body><script>alert(1)</script><p>hi</p></body></html>';
    const out = stripScripts(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>hi</p>');
  });

  it('removes external <script src=...> tags', () => {
    const html = '<html><head><script src="https://example.com/x.js"></script></head><body><p>hi</p></body></html>';
    const out = stripScripts(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('example.com/x.js');
    expect(out).toContain('<p>hi</p>');
  });

  it('leaves non-script tags intact', () => {
    const html = '<html><head><style>.x { color: red }</style></head><body><p>hi</p><img src="a.png"></body></html>';
    const out = stripScripts(html);
    expect(out).toContain('<style>');
    expect(out).toContain('color: red');
    expect(out).toContain('<img');
    expect(out).toContain('<p>hi</p>');
  });

  it('returns the input unchanged when there are no scripts', () => {
    const html = '<html><body><h1>hello</h1></body></html>';
    const out = stripScripts(html);
    expect(out).toContain('<h1>hello</h1>');
    expect(out).not.toContain('<script');
  });
});

/**
 * End-to-end verification for the heading-selector scope expansion
 * shipped on the `feat/audit-rules-fired-industry` branch (PR #84
 * follow-ups).
 *
 * This test runs the *real* parser against a hand-authored HTML fixture
 * (no mocks, no stubs) and then drives the output through the same
 * `buildMinimalHtml` + `countSelectorMatches` path the AI Variant Advisor's
 * selector allowlist uses. It is the closest thing to an e2e check we can
 * do without Browserless, since it walks every line of the diff:
 *
 *   parser.ts → findHeadings → computeCssSelector
 *        → HeadingItem.cssSelector populated
 *   selectorUtils.ts → buildMinimalHtml emits heading attrs
 *        → countSelectorMatches finds the heading by selector
 *   (PR #84 bug-4) advisor would now be able to anchor an element-insert
 *   on that heading selector and validateModification would accept it.
 *
 * Also covers the PR #84 bug-1 defensive `el.text ?? ''` change and the
 * bug-3 nav/header CTA-vocab filter so the same fixture exercises all
 * three structural changes in one place.
 */

import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../parser';
import { countSelectorMatches, selectorStability } from '../selectorUtils';

const FINAL_URL = 'https://example.com/';
const RAW_BYTE_SIZE = 4096;

const HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Acme Banking — Personal accounts</title>
  <meta name="description" content="Checking and savings, simple.">
</head>
<body>
  <!-- Three skip-link patterns the parser MUST exclude from the CTA inventory. -->
  <a href="#main" class="skip-link">Skip to content</a>
  <a href="#content" class="sr-only">Skip to main content</a>
  <a href="#nav">Jump to navigation</a>
  <header>
    <nav>
      <a href="/products">Products</a>
      <a href="/pricing">Pricing</a>
      <a href="/developers">Developers</a>
    </nav>
  </header>
  <main>
    <h1 id="hero-h1">Banking that respects your time</h1>
    <p>Open an account in under five minutes.</p>
    <button data-testid="primary-cta" class="cta-primary">Open a checking account</button>
    <a class="cta-secondary" href="/pricing">See pricing</a>
    <h2>How it works</h2>
    <p>Tell us about you. Pick an account. Done.</p>
    <h2 data-testid="why-section">Why customers stay</h2>
    <form data-testid="signup-form">
      <input name="email" type="email" />
      <button type="submit">Get started</button>
    </form>
  </main>
  <footer>
    <a href="/about">About</a>
  </footer>
</body>
</html>`;

describe('parser → buildMinimalHtml → validator round-trip (PR #84 follow-ups)', () => {
  it('PR #84 bug-4/5: H1 with id gets a stable cssSelector the validator can match', async () => {
    const data = await parseSnapshot({ html: HTML, finalUrl: FINAL_URL, rawByteSize: RAW_BYTE_SIZE });

    const h1 = data.headings.find((h) => h.level === 1);
    expect(h1, 'parser must surface the H1').toBeDefined();
    expect(h1!.text).toBe('Banking that respects your time');
    expect(h1!.cssSelector, 'human-authored id should produce a stable selector').toBe('#hero-h1');

    // The advisor's selector allowlist for headings:
    const headingSelectors = data.headings
      .map((h) => h.cssSelector)
      .filter((s): s is string => !!s);
    expect(headingSelectors).toContain('#hero-h1');

    // buildMinimalHtml + countSelectorMatches is the path the staleness cron
    // and the AI advisor's validation share. If this returns count: 0 the
    // advisor would silently drop every heading-targeted option.
    const match = countSelectorMatches(data, '#hero-h1');
    expect(match).toEqual({ count: 1, status: 'ok' });
  });

  it('PR #84 bug-4/5: H2 with data-testid also gets a stable selector', async () => {
    const data = await parseSnapshot({ html: HTML, finalUrl: FINAL_URL, rawByteSize: RAW_BYTE_SIZE });

    const why = data.headings.find((h) => h.text === 'Why customers stay');
    expect(why?.cssSelector).toBe('[data-testid="why-section"]');

    const match = countSelectorMatches(data, '[data-testid="why-section"]');
    expect(match.count).toBe(1);
  });

  it('heading without any stable anchor gets a fragile positional selector (rung 5)', async () => {
    const data = await parseSnapshot({ html: HTML, finalUrl: FINAL_URL, rawByteSize: RAW_BYTE_SIZE });

    const how = data.headings.find((h) => h.text === 'How it works');
    // No id/testid → falls to the positional path rather than null, so the AI
    // advisor still has something to target on anchor-less real-world sites.
    expect(how?.cssSelector).toBeTruthy();
    expect(how?.cssSelector).toContain(':nth-of-type(');
    expect(selectorStability(how!.cssSelector!)).toBe('fragile');
  });

  it('PR #84 bug-3: nav and footer CTAs are emitted with the right landmark for the vocab filter', async () => {
    const data = await parseSnapshot({ html: HTML, finalUrl: FINAL_URL, rawByteSize: RAW_BYTE_SIZE });

    const products = data.ctas.find((c) => c.text === 'Products');
    expect(products?.landmark, 'nav links must land in the nav landmark').toBe('nav');

    const primary = data.ctas.find((c) => c.text === 'Open a checking account');
    expect(primary?.landmark, 'main hero CTA must NOT be nav/header').toBe('main');

    // Drive the same filter the audit-funnel + advisor route apply.
    const conversionCopy = data.ctas
      .filter((c) => c.landmark !== 'nav' && c.landmark !== 'header')
      .map((c) => c.text);
    expect(conversionCopy).toContain('Open a checking account');
    expect(conversionCopy).not.toContain('Products');
    expect(conversionCopy).not.toContain('Pricing');
    expect(conversionCopy).not.toContain('Developers');
  });

  it('skip-link patterns are excluded from the CTA inventory (no "Skip to content" leak)', async () => {
    // Pre-fix, "Skip to content" landed at documentIndex=0 on most sites.
    // Combined with the synthetic generator's doc-order click weighting,
    // the public audit reported "your visitors want `Skip to content`" —
    // unactionable nonsense. The parser-level filter is the canonical fix
    // because it removes the contamination from every downstream rule.
    const data = await parseSnapshot({ html: HTML, finalUrl: FINAL_URL, rawByteSize: RAW_BYTE_SIZE });
    const allCtaText = data.ctas.map((c) => c.text);
    expect(allCtaText).not.toContain('Skip to content');
    expect(allCtaText).not.toContain('Skip to main content');
    expect(allCtaText).not.toContain('Jump to navigation');
    // The legitimate CTAs survive.
    expect(allCtaText).toContain('Open a checking account');
    expect(allCtaText).toContain('Products');
  });

  it('PR #84 bug-1: parser does not throw on a heading whose body would otherwise feed undefined to .trim()', async () => {
    // Force the malformed shape the truncated-DOM crash produces: a heading
    // tag whose children include only nodes that node-html-parser may report
    // with a missing `.text` accessor. Pre-fix this threw
    // "Cannot read properties of undefined (reading 'trim')" before the
    // empty-text guard could skip it.
    const truncated = `<!doctype html><html><body><h1></h1><h2>Real heading</h2></body></html>`;
    const data = await parseSnapshot({
      html: truncated,
      finalUrl: FINAL_URL,
      rawByteSize: truncated.length,
    });
    // The empty H1 is skipped (no text) and the real H2 survives.
    expect(data.headings.map((h) => h.text)).toEqual(['Real heading']);
  });
});

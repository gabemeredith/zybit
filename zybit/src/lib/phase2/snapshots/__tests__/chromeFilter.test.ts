import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../parser';

const FINAL_URL = 'https://example.com';
const RAW_BYTE_SIZE = 8192;

function ctaTexts(html: string) {
  return parseSnapshot({ html, finalUrl: FINAL_URL, rawByteSize: RAW_BYTE_SIZE })
    .then((data) => data.ctas.map((c) => c.text.trim()));
}

describe('parser: browser-default chrome buttons excluded from CTA inventory', () => {
  it('excludes a bare <button>Back</button> in the header', async () => {
    const html = `<!doctype html><html><body>
      <header>
        <button>Back</button>
        <a href="/products">Products</a>
      </header>
      <main>
        <h1>Hello</h1>
        <button>Get started</button>
      </main>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).not.toContain('Back');
    expect(texts).toContain('Products');
    expect(texts).toContain('Get started');
  });

  it.each([
    'Back',
    'Close',
    'Dismiss',
    'Cancel',
    'Menu',
    'Search',
    'Open menu',
    'Toggle navigation',
    '×',
    '✕',
  ])('excludes <button>%s</button>', async (label) => {
    const html = `<!doctype html><html><body><button>${label}</button><a href="/x">Real link</a></body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).not.toContain(label);
    expect(texts).toContain('Real link');
  });

  it('excludes aria-labeled "Close" button with no visible text', async () => {
    const html = `<!doctype html><html><body>
      <button aria-label="Close"><svg></svg></button>
      <a href="/x">Real link</a>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).not.toContain('');
    expect(texts).toContain('Real link');
  });

  it('KEEPS real CTAs whose text contains a chrome word', async () => {
    // "Back to overview" / "Close the deal" are real navigation copy, not chrome.
    const html = `<!doctype html><html><body>
      <a href="/x">Back to overview</a>
      <a href="/y">Close the deal</a>
      <a href="/z">Open a checking account</a>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).toContain('Back to overview');
    expect(texts).toContain('Close the deal');
    expect(texts).toContain('Open a checking account');
  });

  it('KEEPS an anchor with a real href even if its visible text matches chrome', async () => {
    // <a href="/blog">Back</a> is unusual but the href points somewhere — keep it.
    // Pure chrome is <button>Back</button> or <a href="#"></a>.
    const html = `<!doctype html><html><body>
      <a href="/blog">Back</a>
      <button>Back</button>
    </body></html>`;
    const texts = await ctaTexts(html);
    // The hyperlinked Back stays; the button Back drops.
    expect(texts.filter((t) => t === 'Back')).toHaveLength(1);
  });

  it('drops anchors with fragment-only hrefs that are chrome ("Close" linking to #)', async () => {
    const html = `<!doctype html><html><body>
      <a href="#" aria-label="Close"><svg></svg></a>
      <a href="/x">Real link</a>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).toContain('Real link');
    expect(texts).toHaveLength(1);
  });
});

describe('parser: brand-logo anchors excluded from CTA inventory', () => {
  it.each([
    'Stripe logo',
    'Acme logo',
    'GitHub logo',
    'Vercel logo',
    'Acme Inc logo',
    'logo',
    'Brand & Co logo',
  ])('excludes <a href="/"><img alt="%s"></a>', async (alt) => {
    const html = `<!doctype html><html><body>
      <a href="/"><img alt="${alt}" /></a>
      <a href="/x">Real link</a>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).not.toContain(alt);
    expect(texts).toContain('Real link');
  });

  it('excludes aria-labeled logo anchor with no visible text', async () => {
    const html = `<!doctype html><html><body>
      <a href="/" aria-label="Stripe logo"><svg></svg></a>
      <a href="/x">Real link</a>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).toContain('Real link');
    expect(texts).toHaveLength(1);
  });

  it('KEEPS a real CTA whose alt happens to mention "logo" in different position', async () => {
    // "Choose your logo" / "Logo design tool" — alt text where "logo" is the noun
    // being acted on, not the brand identifier. The regex anchors `logo$` so only
    // trailing-word "logo" matches.
    const html = `<!doctype html><html><body>
      <a href="/tool"><img alt="Logo design tool" /></a>
      <a href="/upload"><img alt="Upload your logo here" /></a>
    </body></html>`;
    const texts = await ctaTexts(html);
    expect(texts).toContain('Logo design tool');
    expect(texts).toContain('Upload your logo here');
  });
});

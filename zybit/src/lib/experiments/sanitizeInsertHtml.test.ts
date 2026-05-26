import { describe, expect, it } from 'vitest';
import { sanitizeInsertHtml } from './sanitizeInsertHtml';

describe('sanitizeInsertHtml — allowed markup', () => {
  it('keeps a quick-answer section with heading, paragraph, and link', () => {
    const out = sanitizeInsertHtml(
      '<section class="quick-answer"><h2>Looking for checking accounts?</h2><p>Compare options.</p><a href="/apply">Apply</a></section>',
    );
    expect(out).toContain('<section class="quick-answer">');
    expect(out).toContain('<h2>Looking for checking accounts?</h2>');
    expect(out).toContain('<p>Compare options.</p>');
    expect(out).toContain('<a href="/apply">Apply</a>');
  });

  it('keeps an anchor nav with multiple list items', () => {
    const out = sanitizeInsertHtml(
      '<nav><ul><li><a href="#fees">Fees</a></li><li><a href="#apply">Apply</a></li></ul></nav>',
    );
    expect(out).toContain('<nav>');
    expect(out).toContain('href="#fees"');
    expect(out).toContain('href="#apply"');
  });
});

describe('sanitizeInsertHtml — dangerous markup is stripped', () => {
  it('removes <script> tags entirely', () => {
    const out = sanitizeInsertHtml(
      '<div><script>alert("xss")</script><p>hi</p></div>',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p>hi</p>');
  });

  it('removes <iframe> tags entirely', () => {
    const out = sanitizeInsertHtml(
      '<div><iframe src="https://attacker"></iframe><p>real</p></div>',
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('attacker');
    expect(out).toContain('<p>real</p>');
  });

  it('removes onclick (and other on*) handler attributes', () => {
    const out = sanitizeInsertHtml(
      '<button onclick="alert(1)" onmouseover="x()">Click</button>',
    );
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('Click');
  });

  it('drops javascript: hrefs but keeps the link element', () => {
    const out = sanitizeInsertHtml(
      '<a href="javascript:alert(1)">Click</a>',
    );
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<a');
    expect(out).toContain('Click');
  });

  it('drops data: image src but keeps the img element with alt', () => {
    const out = sanitizeInsertHtml(
      '<img src="data:image/png;base64,xxxxx" alt="logo">',
    );
    expect(out).not.toContain('src="data:');
    expect(out).toContain('alt="logo"');
  });

  it('drops style attributes (inline-style injection vector)', () => {
    const out = sanitizeInsertHtml(
      '<div style="background: url(javascript:alert(1))">x</div>',
    );
    expect(out).not.toContain('style=');
  });
});

describe('sanitizeInsertHtml — tag handling', () => {
  it('drops disallowed wrapper tags entirely (fail-closed; no text reinjection)', () => {
    // Previously this path called `node.replaceWith(node.text)`, but
    // node-html-parser's `replaceWith` re-parses string args as HTML, so
    // entity-encoded payloads inside a disallowed wrapper could revive a
    // live <script> tag. The wrapper and its contents are dropped now.
    const out = sanitizeInsertHtml('<marquee>Important copy</marquee>');
    expect(out).not.toContain('<marquee');
    expect(out).not.toContain('Important copy');
  });

  it('does not revive a <script> hidden in a disallowed wrapper via entity-encoded HTML', () => {
    const out = sanitizeInsertHtml(
      '<marquee>&lt;script&gt;alert(1)&lt;/script&gt;</marquee>',
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
  });

  it('drops form-related tags entirely (no surreptitious phishing form)', () => {
    const out = sanitizeInsertHtml(
      '<form action="https://attacker"><input name="ssn"><button>Send</button></form>',
    );
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    // The button inside the form is dropped along with the form.
    expect(out).not.toContain('Send');
  });
});

describe('sanitizeInsertHtml — URL hardening', () => {
  it('rejects javascript: hidden by an embedded tab character', () => {
    const out = sanitizeInsertHtml('<a href="java&#9;script:alert(1)">Click</a>');
    expect(out.toLowerCase()).not.toContain('javascript');
    // Browsers normalize tabs out of the href; the sanitizer must too.
    expect(out).not.toMatch(/href=/);
  });

  it('rejects javascript: hidden by an embedded newline character', () => {
    const out = sanitizeInsertHtml('<a href="java&#10;script:alert(1)">Click</a>');
    expect(out.toLowerCase()).not.toContain('javascript');
    expect(out).not.toMatch(/href=/);
  });

  it('rejects protocol-relative URLs (cross-origin tracker pixel via //evil.com)', () => {
    const out = sanitizeInsertHtml('<img src="//attacker.example/pixel" alt="x">');
    // The img stays, the cross-origin src is stripped.
    expect(out).toContain('<img');
    expect(out).toContain('alt="x"');
    expect(out).not.toContain('attacker.example');
    expect(out).not.toMatch(/src=/);
  });

  it('keeps a normal http link', () => {
    const out = sanitizeInsertHtml('<a href="https://example.com/x">x</a>');
    expect(out).toContain('href="https://example.com/x"');
  });

  it('keeps a fragment, query, and root-relative URL', () => {
    expect(sanitizeInsertHtml('<a href="#section">a</a>')).toContain('href="#section"');
    expect(sanitizeInsertHtml('<a href="?q=1">a</a>')).toContain('href="?q=1"');
    expect(sanitizeInsertHtml('<a href="/apply">a</a>')).toContain('href="/apply"');
  });
});

describe('sanitizeInsertHtml — fail-open contract', () => {
  it('returns empty string on empty input', () => {
    expect(sanitizeInsertHtml('')).toBe('');
  });

  it('returns empty string on non-string input', () => {
    expect(sanitizeInsertHtml(null as unknown as string)).toBe('');
  });

  it('does not throw on malformed markup', () => {
    expect(() => sanitizeInsertHtml('<<<>><not html<<')).not.toThrow();
  });
});

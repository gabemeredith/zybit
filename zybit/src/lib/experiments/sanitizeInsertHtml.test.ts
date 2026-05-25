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
  it('replaces disallowed wrapper tags with their text content', () => {
    const out = sanitizeInsertHtml('<marquee>Important copy</marquee>');
    expect(out).not.toContain('<marquee');
    expect(out).toContain('Important copy');
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

import { describe, expect, it } from 'vitest';
import { buildBridgeScript, injectBridgeScript } from '../bridgeScript';

describe('buildBridgeScript', () => {
  it('embeds the visitor ID as a safe JS string literal', () => {
    const tag = buildBridgeScript('abc-123');
    expect(tag).toContain('data-zybit-bridge');
    expect(tag).toContain('"abc-123"');
    expect(tag).toContain('posthog.register');
    expect(tag).toContain('zybit_vid');
  });

  it('escapes characters that could break out of the script context', () => {
    const tag = buildBridgeScript('</script><x>"evil');
    expect(tag).not.toContain('</script><x>');
    expect(tag).toContain('\\u003c');
  });
});

describe('injectBridgeScript', () => {
  it('injects before </head> when present', () => {
    const out = injectBridgeScript('<html><head><title>x</title></head><body>b</body></html>', 'v1');
    expect(out).toMatch(/data-zybit-bridge[^]*<\/head>/);
    expect(out).toContain('"v1"');
  });

  it('falls back to </body> when there is no head', () => {
    const out = injectBridgeScript('<body>hello</body>', 'v1');
    expect(out).toMatch(/data-zybit-bridge[^]*<\/body>/);
  });

  it('prepends when there is neither head nor body', () => {
    const out = injectBridgeScript('<p>bare</p>', 'v1');
    expect(out.indexOf('data-zybit-bridge')).toBeLessThan(out.indexOf('<p>bare</p>'));
  });

  it('is idempotent — does not inject twice', () => {
    const once = injectBridgeScript('<head></head>', 'v1');
    const twice = injectBridgeScript(once, 'v1');
    expect(twice).toBe(once);
    expect(twice.match(/data-zybit-bridge/g)).toHaveLength(1);
  });
});

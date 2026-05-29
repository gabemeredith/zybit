import { describe, expect, it } from 'vitest';
import { buildWelcomeEmail } from '../welcomeEmail';

describe('buildWelcomeEmail', () => {
  it('embeds the set-password and Google URLs', () => {
    const { subject, html } = buildWelcomeEmail({
      email: 'jane@co.com',
      setPasswordUrl: 'https://app.test/set-password?token=abc.123.def',
      googleSignInUrl: 'https://app.test/api/auth/google/start',
    });
    expect(subject).toMatch(/set up your Zybit account/i);
    expect(html).toContain('https://app.test/set-password?token=abc.123.def');
    expect(html).toContain('https://app.test/api/auth/google/start');
    expect(html).toMatch(/approved/i);
  });

  it('escapes HTML in URLs to prevent attribute breakout', () => {
    const { html } = buildWelcomeEmail({
      email: 'x@y.com',
      setPasswordUrl: 'https://app.test/set-password?token=a"><script>alert(1)</script>',
      googleSignInUrl: 'https://app.test/g',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

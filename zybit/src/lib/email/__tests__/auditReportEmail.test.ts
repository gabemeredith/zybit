import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderAuditReportEmailHtml,
  sampleAuditReport,
  subjectForReport,
} from '../auditReportEmail';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

beforeEach(() => {
  delete process.env.PUBLIC_AUDIT_SIGNING_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.APP_BASE_URL;
  delete process.env.AUDIT_FROM_EMAIL;
});

describe('renderAuditReportEmailHtml', () => {
  it('emits the HMAC-signed signup CTA href', () => {
    const html = renderAuditReportEmailHtml(sampleAuditReport());
    expect(html).toMatch(/\/api\/auth\/request-link-from-audit\?/);
    // HTML escapes `&` to `&amp;`, so don't anchor sig match on a preceding
    // delimiter — just look for the `<expiry>.<64-char-hex>` blob.
    expect(html).toMatch(/s=\d+\.[0-9a-f]{64}/);
    // email + auditId echoed back
    expect(html).toContain('e=priya%40acme.com');
    expect(html).toContain('a=pub_sample0000000000000000');
  });

  it('emits the bookCallUrl', () => {
    const html = renderAuditReportEmailHtml(sampleAuditReport());
    expect(html).toContain('https://calendly.com/asad-getzybit/30min');
  });

  it('puts the signup CTA before the Calendly CTA in source order', () => {
    const html = renderAuditReportEmailHtml(sampleAuditReport());
    const signupAt = html.indexOf('request-link-from-audit');
    const calendlyAt = html.indexOf('calendly.com');
    expect(signupAt).toBeGreaterThan(-1);
    expect(calendlyAt).toBeGreaterThan(-1);
    expect(signupAt).toBeLessThan(calendlyAt);
  });

  it('turns the PostHog caveat phrase into a link', () => {
    const html = renderAuditReportEmailHtml(sampleAuditReport());
    // The caveat block contains a link wrapping "Connect PostHog" that points
    // at the same signup destination — keeps the journey one URL deep.
    const caveatStart = html.indexOf('Based on page structure');
    const caveatEnd = html.indexOf('</td>', caveatStart);
    const caveatHtml = html.slice(caveatStart, caveatEnd);
    expect(caveatHtml).toMatch(/<a [^>]*href=".*request-link-from-audit/);
    expect(caveatHtml).toContain('Connect PostHog');
  });

  it('does not leak the resend.dev sandbox domain anywhere in the body', () => {
    const html = renderAuditReportEmailHtml(sampleAuditReport());
    expect(html).not.toContain('resend.dev');
  });

  it('HTML-escapes the audit domain (XSS smoke test)', () => {
    const malicious = {
      ...sampleAuditReport(),
      domain: 'evil.com</style><script>alert(1)</script>',
    };
    const html = renderAuditReportEmailHtml(malicious);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders multi-atom evidence as bulleted rows', () => {
    const sample = sampleAuditReport();
    const multi = {
      ...sample,
      findings: [
        {
          ...sample.findings[0],
          evidence: 'Dead links: 15 · Examples: "Reload" · Page: /foo · Based on: page structure',
        },
      ],
    };
    const html = renderAuditReportEmailHtml(multi);
    const evidenceSectionStart = html.indexOf('>Evidence<');
    const evidenceSectionEnd = html.indexOf('What to change', evidenceSectionStart);
    const section = html.slice(evidenceSectionStart, evidenceSectionEnd);
    expect(section.match(/•/g)?.length ?? 0).toBe(4);
    expect(section).not.toContain(' · ');
  });

  it('renders a single-sentence evidence as a plain block (no bullet)', () => {
    const sample = sampleAuditReport();
    const single = {
      ...sample,
      findings: [{ ...sample.findings[0], evidence: 'Single sentence with no separators.' }],
    };
    const html = renderAuditReportEmailHtml(single);
    const evidenceSectionStart = html.indexOf('>Evidence<');
    const evidenceSectionEnd = html.indexOf('What to change', evidenceSectionStart);
    const section = html.slice(evidenceSectionStart, evidenceSectionEnd);
    expect(section).toContain('Single sentence with no separators.');
    expect(section).not.toContain('•');
  });

  it('renders the Finding title above the Why this matters block (when both present)', () => {
    const sample = sampleAuditReport();
    // Pick a finding that has both a title and whyItMatters set.
    const sampleWithBoth = {
      ...sample,
      findings: sample.findings.filter((f) => f.whyItMatters).slice(0, 1),
    };
    expect(sampleWithBoth.findings.length).toBe(1);
    const html = renderAuditReportEmailHtml(sampleWithBoth);
    const findingLabelAt = html.indexOf('>Finding<');
    const whyLabelAt = html.indexOf('>Why this matters<');
    expect(findingLabelAt).toBeGreaterThan(-1);
    expect(whyLabelAt).toBeGreaterThan(-1);
    expect(findingLabelAt).toBeLessThan(whyLabelAt);
  });

  it('no longer renders the severity badge or estimated impact figure', () => {
    const html = renderAuditReportEmailHtml(sampleAuditReport());
    expect(html).not.toContain('Est. impact');
    expect(html).not.toMatch(/>(High|Medium|Low)</);
  });

  it('signs different emails to different sigs', () => {
    const a = renderAuditReportEmailHtml({
      ...sampleAuditReport(),
      prospect: { email: 'a@acme.com', role: 'PM' },
    });
    const b = renderAuditReportEmailHtml({
      ...sampleAuditReport(),
      prospect: { email: 'b@acme.com', role: 'PM' },
    });
    // sig now has form `<expiry>.<64-char-hex>` — compare just the hex tail
    // since the expiry timestamps will match when both renders happen in the
    // same millisecond.
    const sigA = /s=\d+\.([0-9a-f]{64})/.exec(a)?.[1];
    const sigB = /s=\d+\.([0-9a-f]{64})/.exec(b)?.[1];
    expect(sigA).toBeTruthy();
    expect(sigB).toBeTruthy();
    expect(sigA).not.toEqual(sigB);
  });
});

describe('subjectForReport', () => {
  const base = sampleAuditReport();
  it('uses the empty-state subject when there are zero findings', () => {
    expect(subjectForReport({ ...base, findings: [] })).toBe('Your acme.com audit is ready');
  });
  it('uses the singular form for a one-finding report', () => {
    expect(subjectForReport({ ...base, findings: base.findings.slice(0, 1) })).toBe(
      'One thing to fix on acme.com',
    );
  });
  it('uses the four-finding capitalized form for the common path', () => {
    expect(subjectForReport(base)).toBe('Four things to fix on acme.com');
  });
});

describe('sendAuditReportEmail', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'mock-id' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it('reads the `from` field from AUDIT_FROM_EMAIL when set', async () => {
    process.env.AUDIT_FROM_EMAIL = 'Test Sender <test@getzybit.com>';
    const { sendAuditReportEmail } = await import('../auditReportEmail');
    await sendAuditReportEmail('to@acme.com', sampleAuditReport());
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].from).toBe('Test Sender <test@getzybit.com>');
  });

  it('defaults the `from` field to a getzybit.com sender, not resend.dev', async () => {
    delete process.env.AUDIT_FROM_EMAIL;
    const { sendAuditReportEmail } = await import('../auditReportEmail');
    await sendAuditReportEmail('to@acme.com', sampleAuditReport());
    const from: string = sendMock.mock.calls[0][0].from;
    expect(from).toMatch(/@getzybit\.com/);
    expect(from).not.toContain('resend.dev');
  });
});

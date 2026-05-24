/**
 * Audit report email — the artifact for the public URL-audit lead magnet.
 *
 * Premium positioning (see `docs/sprints/url-audit-lead-magnet.md` §0):
 * the on-site teaser shows ONE finding; the full report is this email.
 * It is meant to feel like a consultancy one-pager, not a tool dump.
 *
 * Wiring is deferred to Phase B. For now this module exports:
 *   - `AuditReport` type
 *   - `renderAuditReportEmailHtml(report)` — returns the email HTML string
 *   - `sendAuditReportEmail(to, report)` — Resend send (no-op until Phase B
 *     plumbs the route)
 *   - `sampleAuditReport()` — used by `/audit/email-preview` to render mock
 *
 * The HTML uses inline styles only (no external CSS, no fonts loaded
 * from Google) so it renders consistently across Gmail / Apple Mail /
 * Outlook web. Receipt-card pattern mirrors the landing page.
 */

import { Resend } from 'resend';

export interface AuditFindingForEmail {
  id: string;
  rank: number;
  severity: 'high' | 'medium' | 'low';
  confidence: number;
  ruleId: string;
  title: string;
  /**
   * Optional PM-first business framing rendered above the title. Surfaced
   * from `prescription.whyItMatters` when the underlying rule provides it.
   * Falsy → the section is omitted, no empty placeholder is rendered.
   */
  whyItMatters: string | null;
  evidence: string;
  whatToChange: string;
  estimatedImpactMonthlyUsd: number | null;
}

export interface AuditReport {
  domain: string;
  url: string;
  prospect: {
    email: string;
    role: string;
  };
  generatedAt: string;
  pagesScanned: number;
  totalFindings: number;
  findings: AuditFindingForEmail[];
  bookCallUrl: string;
  /** Public URL of the above-fold homepage screenshot, if captured. */
  screenshotUrl?: string | null;
  /** 2-sentence AI visual observation from the screenshot, if run. */
  visionObs?: string | null;
}

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';
const HAIRLINE = 'rgba(0,0,0,0.12)';

function fmtDollars(usd: number | null): string {
  if (usd === null) return '—';
  if (usd >= 10_000) return `~$${(usd / 1000).toFixed(0)}k`;
  if (usd >= 1000) return `~$${(usd / 1000).toFixed(1)}k`;
  return `~$${usd.toFixed(0)}`;
}

function severityLabel(s: AuditFindingForEmail['severity']): string {
  return s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findingCard(f: AuditFindingForEmail): string {
  const impact = fmtDollars(f.estimatedImpactMonthlyUsd);
  // Severity-only badge — the numeric confidence score was dropped because
  // it adds no PM signal beyond what the label already conveys.
  const whyItMattersRow = f.whyItMatters
    ? `
      <tr>
        <td style="padding: 18px 18px 4px;">
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">Why this matters</div>
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: ${INK};">${escapeHtml(f.whyItMatters)}</div>
        </td>
      </tr>`
    : '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px; border-collapse: separate; border: 2px solid ${INK}; box-shadow: 6px 6px 0 ${INK}; background: ${CREAM};">
      <tr>
        <td align="right" style="padding: 12px 18px; border-bottom: 2px solid ${INK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED};">${severityLabel(f.severity)}</td>
      </tr>
      ${whyItMattersRow}
      <tr>
        <td style="padding: 18px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">Finding</div>
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 18px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; color: ${INK};">${escapeHtml(f.title)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding: 16px 18px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">Evidence</div>
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.55; color: ${INK};">${escapeHtml(f.evidence)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding: 16px 18px; border-bottom: 1px solid ${HAIRLINE};">
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 8px;">What to change</div>
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.55; color: ${INK};">${escapeHtml(f.whatToChange)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding: 16px 18px; background: ${INK}; color: ${CREAM};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6;">Est. impact</td>
              <td align="right" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 22px; font-weight: 900; letter-spacing: -0.02em; white-space: nowrap;">${impact}/mo</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function screenshotSection(report: AuditReport): string {
  if (!report.screenshotUrl) return '';

  const imgTag = `<img src="${escapeHtml(report.screenshotUrl)}" width="544" alt="Above-fold screenshot of ${escapeHtml(report.domain)}" style="display: block; width: 100%; max-width: 544px; border: 2px solid ${INK}; box-shadow: 6px 6px 0 ${INK};" />`;

  const caption = report.visionObs
    ? `<p style="margin: 10px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; line-height: 1.6; color: ${INK}; font-style: italic;">${escapeHtml(report.visionObs)}</p>`
    : '';

  return `
          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 12px;">What we saw</div>
              ${imgTag}
              ${caption}
            </td>
          </tr>
  `;
}

export function renderAuditReportEmailHtml(report: AuditReport): string {
  const findingsHtml = report.findings.map(findingCard).join('\n');
  const safeDomain = escapeHtml(report.domain);
  const safeRole = escapeHtml(report.prospect.role);
  const moreCount = Math.max(0, report.totalFindings - report.findings.length);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Zybit audit — ${safeDomain}</title>
</head>
<body style="margin: 0; padding: 0; background: #EFEEE9;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #EFEEE9;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background: ${CREAM};">

          <!-- Cover -->
          <tr>
            <td style="padding: 28px 28px 8px;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: ${MUTED};">Zybit · 60-second audit</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 28px 24px;">
              <h1 style="margin: 8px 0 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 36px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: ${INK};">${safeDomain}</h1>
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.55; color: ${INK};">
                We ran our 13 friction rules against your homepage and the ${report.pagesScanned} internal pages we could reach. The <strong>four findings below</strong> are the ones most worth fixing first — ranked by potential revenue impact and how confident we are in the call. Each one cites what we saw on your site, what to change, and a rough dollar estimate.
              </p>
            </td>
          </tr>

          <!-- Summary strip -->
          <tr>
            <td style="padding: 0 28px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid ${HAIRLINE}; border-bottom: 1px solid ${HAIRLINE};">
                <tr>
                  <td style="padding: 14px 0; width: 50%; vertical-align: top;">
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED};">Findings ranked</div>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: ${INK}; margin-top: 4px;">${report.totalFindings}</div>
                  </td>
                  <td style="padding: 14px 0; width: 50%; vertical-align: top;">
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED};">Pages scanned</div>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: ${INK}; margin-top: 4px;">${report.pagesScanned}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${screenshotSection(report)}

          <!-- Findings -->
          <tr>
            <td style="padding: 0 28px;">
              ${findingsHtml}
            </td>
          </tr>

          <!-- "more findings" note + CTA -->
          <tr>
            <td style="padding: 8px 28px 28px;">
              ${
                moreCount > 0
                  ? `<p style="margin: 0 0 22px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 14px; line-height: 1.55; color: ${MUTED};">
                <strong style="color: ${INK};">${moreCount} other findings didn&rsquo;t make the cut.</strong> They&rsquo;re lower-impact or lower-confidence — worth seeing once you&rsquo;ve fixed the four above. The full ranked list lives in Zybit, along with the things a static crawl can&rsquo;t see: flow drop-offs, session-level evidence, and rules that learn what actually works on <em>your</em> product.
              </p>`
                  : ''
              }
              <a href="${escapeHtml(report.bookCallUrl)}" style="display: inline-block; padding: 14px 28px; background: ${INK}; color: ${CREAM}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; box-shadow: 4px 4px 0 ${INK}; border: 1px solid ${INK};">Walk through these with us →</a>
              <p style="margin: 14px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 12px; line-height: 1.5; color: ${MUTED};">
                30 minutes on screen-share. We&rsquo;ll walk through each finding, answer your questions, and tell you straight whether Zybit fits your team. No pitch deck.
              </p>
            </td>
          </tr>

          <!-- Caveat: what this audit can and can't see -->
          <tr>
            <td style="padding: 0 28px 24px;">
              <div style="border: 1px dashed ${HAIRLINE}; padding: 14px 16px; background: rgba(0,0,0,0.02);">
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; margin-bottom: 6px;">Based on page structure, not your visitors yet</div>
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; line-height: 1.55; color: ${INK};">
                  The findings above come from parsing your HTML — what your page emphasizes, how the nav is structured, where the CTAs sit. They&rsquo;re real structural observations, but we can&rsquo;t see how your real users behave on the page yet. Connect PostHog (or send us your data) and the other 9 rules light up — rage-clicks, drop-offs, form abandonment, hesitation, mobile asymmetry, and the patterns you only see in session data.
                </p>
              </div>
            </td>
          </tr>

          <!-- Founder signature -->
          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="border-top: 1px solid ${HAIRLINE}; padding-top: 18px;">
                <p style="margin: 0 0 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 14px; line-height: 1.55; color: ${INK};">
                  — Asad &amp; Jad
                </p>
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${MUTED};">
                  Zybit · Built at Cornell
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 0 28px 28px;">
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; line-height: 1.55; color: #999;">
                Sent to ${escapeHtml(report.prospect.email)} (${safeRole}) because you requested a Zybit audit of <a href="${escapeHtml(report.url)}" style="color: #999;">${safeDomain}</a> on ${escapeHtml(report.generatedAt)}. We hold this audit for 90 days. Reply to this email if you'd like it removed sooner.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendAuditReportEmail(
  to: string,
  report: AuditReport,
): Promise<{ success: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { success: false, error: 'RESEND_API_KEY not set' };
  }
  try {
    const html = renderAuditReportEmailHtml(report);
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      // Sandbox sender — same caveat as auditConfirmationEmail.ts. Override
      // via AUDIT_REPORT_FROM_EMAIL once a custom domain is verified in Resend.
      from: process.env.AUDIT_REPORT_FROM_EMAIL ?? 'Asad & Jad at Zybit <onboarding@resend.dev>',
      to,
      subject: `Four things to fix on ${report.domain}`,
      html,
    });
    if (error) {
      const detail =
        typeof error === 'object' && error !== null
          ? JSON.stringify(error)
          : String(error);
      return { success: false, error: detail };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function sampleAuditReport(): AuditReport {
  return {
    domain: 'acme.com',
    url: 'https://acme.com',
    prospect: {
      email: 'priya@acme.com',
      role: 'Head of Growth',
    },
    generatedAt: 'May 23, 2026 at 4:12 PM ET',
    pagesScanned: 7,
    totalFindings: 11,
    bookCallUrl: 'https://calendly.com/asad-getzybit/30min',
    findings: [
      {
        id: 'f1',
        rank: 1,
        severity: 'high',
        confidence: 0.84,
        ruleId: 'rage-click-target',
        title: 'Visitors are rage-clicking your checkout promo-code field',
        whyItMatters: null,
        evidence:
          '847 rage-click events on #promo-code over the last 7 days. Checkout completion rate is 2.1% for sessions that interact with the field vs. 3.4% for sessions that skip it — a 38% relative drop.',
        whatToChange:
          'Collapse the promo-code input behind a "Have a code?" toggle below the primary CTA. Keeps the field reachable for the 4% who need it without making the other 96% pause on it.',
        estimatedImpactMonthlyUsd: 3200,
      },
      {
        id: 'f2',
        rank: 2,
        severity: 'high',
        confidence: 0.79,
        ruleId: 'hero-hierarchy-inversion',
        title: 'Your visitors want "Start free trial", but your homepage points them at "Book a demo"',
        whyItMatters:
          'Your visitors are reaching for "Start free trial", but your hero is pointing them at "Book a demo" with the loud filled button. Every visitor who arrives wanting the trial has to scan past the demo CTA to find the one they actually want — that\'s friction you\'re paying for on every session.',
        evidence:
          'What visitors click most: "Start free trial" · 58% of clicks · 312 clicks · What your design emphasizes: "Book a demo" in the hero with a filled background and bold weight · Page: your homepage · Based on: 538 button clicks over the last 14 days',
        whatToChange:
          'Promote "Start free trial" to the hero with the same filled background and bold weight "Book a demo" has today. Demote "Book a demo" to a secondary outlined style.',
        estimatedImpactMonthlyUsd: 5400,
      },
      {
        id: 'f3',
        rank: 3,
        severity: 'medium',
        confidence: 0.71,
        ruleId: 'cta-low-contrast',
        title: 'Pricing-page CTA fails WCAG contrast at body size',
        whyItMatters: null,
        evidence:
          'The "Choose Growth" button on /pricing uses #B8E0CC on #FAFAF8 — contrast ratio 1.9:1, well below the 4.5:1 floor. On mobile (where 62% of pricing traffic lands) the button is the smallest tap target on the page.',
        whatToChange:
          'Darken the button background to a contrast ratio ≥ 4.5:1 (e.g. #2D7A50 against the cream background) and increase the mobile tap target to ≥ 44×44 px.',
        estimatedImpactMonthlyUsd: 1800,
      },
      {
        id: 'f4',
        rank: 4,
        severity: 'medium',
        confidence: 0.66,
        ruleId: 'nav-dispersion',
        title: 'Top nav forces users to choose between 9 items',
        whyItMatters: null,
        evidence:
          'The primary nav contains 9 top-level items (Product, Features, Solutions, Use cases, Customers, Pricing, Docs, Blog, Login). Click distribution is concentrated on 3 — Pricing (41%), Docs (22%), Login (18%) — and the other 6 collectively absorb 19% of clicks. The variance is hurting discoverability.',
        whatToChange:
          'Consolidate Product/Features/Solutions/Use cases under a single "Product" dropdown. Move Customers + Blog under a "Company" dropdown. Surface Pricing, Docs, and Login as top-level only.',
        estimatedImpactMonthlyUsd: 1100,
      },
    ],
  };
}

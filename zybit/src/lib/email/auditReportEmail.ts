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
  const id = `F-${String(f.rank).padStart(4, '0')}`;
  const impact = fmtDollars(f.estimatedImpactMonthlyUsd);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px; border-collapse: separate; border: 2px solid ${INK}; box-shadow: 6px 6px 0 ${INK}; background: ${CREAM};">
      <tr>
        <td style="padding: 12px 18px; border-bottom: 2px solid ${INK};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${INK};">${id} · ${escapeHtml(f.ruleId)}</td>
              <td align="right" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: ${MUTED}; white-space: nowrap;">${severityLabel(f.severity)} · ${f.confidence.toFixed(2)}</td>
            </tr>
          </table>
        </td>
      </tr>
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
                We ran Zybit's 13 friction rules against your live homepage and the ${report.pagesScanned} internal pages we could reach. Below are the <strong>four highest-priority findings</strong>, ranked by potential revenue impact and confidence. Each one cites what we saw, what to change, and an estimate of what fixing it is worth.
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
                <strong style="color: ${INK};">+${moreCount} more findings.</strong> The four above are the highest-priority ones. The full ranked list — plus flow drop-offs, weekly digests, and the rules learning what works on <em>your</em> product — comes after you connect your analytics.
              </p>`
                  : ''
              }
              <a href="${escapeHtml(report.bookCallUrl)}" style="display: inline-block; padding: 14px 28px; background: ${INK}; color: ${CREAM}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; box-shadow: 4px 4px 0 ${INK}; border: 1px solid ${INK};">Walk through these with us →</a>
              <p style="margin: 14px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 12px; line-height: 1.5; color: ${MUTED};">
                30 minutes. We'll go through the four findings on screen-share, answer questions, and tell you whether Zybit fits your team — straight, no pitch.
              </p>
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
                  Built at Cornell · We review every audit personally
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
      from: 'Asad & Jad at Zybit <audit@resend.dev>',
      to,
      subject: `Your Zybit audit — ${report.domain}`,
      html,
    });
    if (error) {
      return { success: false, error: String(error) };
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
        title: 'Rage-clicks on checkout promo-code field',
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
        title: 'Hero gives most visual weight to the secondary action',
        evidence:
          'The "Book a demo" button uses the filled brand-blue treatment in the hero, while "Start free trial" is a plain text link. Yet 58% of all CTA clicks on the homepage go to "Start free trial". Visual emphasis is inverted relative to revealed preference.',
        whatToChange:
          'Swap the visual treatments: give "Start free trial" the bg-blue-600 + text-white styling currently held by "Book a demo", and demote "Book a demo" to a secondary outlined button.',
        estimatedImpactMonthlyUsd: 5400,
      },
      {
        id: 'f3',
        rank: 3,
        severity: 'medium',
        confidence: 0.71,
        ruleId: 'cta-low-contrast',
        title: 'Pricing-page CTA fails WCAG contrast at body size',
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
        evidence:
          'The primary nav contains 9 top-level items (Product, Features, Solutions, Use cases, Customers, Pricing, Docs, Blog, Login). Click distribution is concentrated on 3 — Pricing (41%), Docs (22%), Login (18%) — and the other 6 collectively absorb 19% of clicks. The variance is hurting discoverability.',
        whatToChange:
          'Consolidate Product/Features/Solutions/Use cases under a single "Product" dropdown. Move Customers + Blog under a "Company" dropdown. Surface Pricing, Docs, and Login as top-level only.',
        estimatedImpactMonthlyUsd: 1100,
      },
    ],
  };
}

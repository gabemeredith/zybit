/**
 * Audit confirmation email — the double opt-in step.
 *
 * Sent immediately after the prospect submits the `/audit` form.
 * **No audit has run yet.** The submitter clicks the link to confirm
 * the request is theirs; only then does the pipeline dispatch and the
 * full report (see `auditReportEmail.ts`) follow ~45s later.
 *
 * Premium positioning rules (see `docs/sprints/url-audit-lead-magnet.md` §4a A):
 * - Short, neutral, transactional. Not a marketing email.
 * - Single CTA. No alternative paths, no upsell.
 * - "You didn't request this?" footer so a wrongly-addressed recipient
 *   knows the right thing to do (ignore it).
 *
 * Inline-styled HTML for cross-client compatibility (Gmail / Apple Mail /
 * Outlook). Same visual tokens as `auditReportEmail.ts`.
 */

import { Resend } from 'resend';

export interface AuditConfirmationRequest {
  /** Bare host the prospect asked us to audit, e.g. "acme.com". */
  domain: string;
  /** The recipient — what they typed in the work-email field. */
  recipientEmail: string;
  /** Fully-qualified click-through URL. Token already embedded. */
  confirmationUrl: string;
  /** Local-time string we display in the "expires" line. */
  expiresAtHuman: string;
  /** Suppression-list one-click unsubscribe link. */
  unsubscribeUrl: string;
}

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';
const HAIRLINE = 'rgba(0,0,0,0.12)';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAuditConfirmationEmailHtml(req: AuditConfirmationRequest): string {
  const safeDomain = escapeHtml(req.domain);
  const safeUrl = escapeHtml(req.confirmationUrl);
  const safeExpires = escapeHtml(req.expiresAtHuman);
  const safeUnsub = escapeHtml(req.unsubscribeUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Confirm your Zybit audit of ${safeDomain}</title>
</head>
<body style="margin: 0; padding: 0; background: #EFEEE9;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #EFEEE9;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width: 560px; background: ${CREAM};">

          <tr>
            <td style="padding: 28px 28px 0;">
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: ${MUTED};">Zybit</div>
            </td>
          </tr>

          <tr>
            <td style="padding: 12px 28px 4px;">
              <h1 style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 24px; font-weight: 800; letter-spacing: -0.025em; line-height: 1.2; color: ${INK};">
                Did you ask for an audit of ${safeDomain}?
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding: 16px 28px 8px;">
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: ${INK};">
                Click the button below to confirm. We&rsquo;ll run our 13 friction rules against your homepage and email you the report — usually within an hour.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 28px 12px;">
              <a href="${safeUrl}" style="display: inline-block; padding: 14px 28px; background: ${INK}; color: ${CREAM}; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; box-shadow: 4px 4px 0 ${INK}; border: 1px solid ${INK};">
                Confirm &amp; run the audit →
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 6px 28px 24px;">
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 12px; line-height: 1.55; color: ${MUTED};">
                Link expires ${safeExpires}. If you didn&rsquo;t request this audit, you can safely ignore this email — we won&rsquo;t send anything else.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 28px 28px;">
              <div style="border-top: 1px solid ${HAIRLINE}; padding-top: 16px;">
                <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 11px; line-height: 1.55; color: #999;">
                  Sent to ${escapeHtml(req.recipientEmail)}. Reply to this email with any questions, or <a href="${safeUnsub}" style="color: #999;">remove this address</a> from any future Zybit audit confirmations.
                </p>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendAuditConfirmationEmail(
  req: AuditConfirmationRequest,
): Promise<{ success: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { success: false, error: 'RESEND_API_KEY not set' };
  }
  try {
    const html = renderAuditConfirmationEmailHtml(req);
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: 'Zybit <audit@resend.dev>',
      to: req.recipientEmail,
      subject: `Confirm your Zybit audit of ${req.domain}`,
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

export function sampleAuditConfirmationRequest(): AuditConfirmationRequest {
  return {
    domain: 'acme.com',
    recipientEmail: 'priya@acme.com',
    confirmationUrl: 'https://zybit.com/audit/confirm?token=8a3f2c1d9e7b4f6a',
    expiresAtHuman: 'in 24 hours',
    unsubscribeUrl: 'https://zybit.com/audit/unsubscribe?token=8a3f2c1d9e7b4f6a',
  };
}

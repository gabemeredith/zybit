/**
 * Gap 6 — First Insight Email
 *
 * Sends a notification via Resend when a site's first insight run
 * produces findings. Follows the same Resend pattern used in
 * `src/app/api/intake/route.ts`.
 *
 * Integration point: call `sendFirstInsightEmail` from the POST handler
 * in `/api/dashboard/findings/route.ts` after a successful upsert when
 * `zybitSiteMeta.lastInsightRunAt` was null before the run (first run).
 */

import { Resend } from 'resend';

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set');
  }
  return new Resend(key);
}

function fmtDollars(cents: number): string {
  const d = cents / 100;
  if (d >= 10_000) return `$${(d / 1000).toFixed(0)}k`;
  if (d >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${d.toFixed(0)}`;
}

/**
 * Send the "Your first Zybit report is ready" email.
 *
 * @param to            recipient email address
 * @param domain        site domain (e.g. "acme.com")
 * @param findingsCount number of findings in the first run
 * @param estimatedImpact optional estimated revenue at risk in cents
 */
export async function sendFirstInsightEmail(
  to: string,
  domain: string,
  findingsCount: number,
  estimatedImpact?: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const impactLine = estimatedImpact
      ? `<p style="margin: 0 0 16px; font-size: 15px; color: #111;">Estimated revenue at risk: <strong>${fmtDollars(estimatedImpact)}/mo</strong></p>`
      : '';

    const dashboardUrl = `https://app.zybit.dev/app/findings`;

    const { error } = await getResendClient().emails.send({
      from: 'Zybit <notifications@resend.dev>',
      to,
      subject: 'Your first Zybit report is ready',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
          <div style="border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #6B6B6B;">Zybit</p>
            <h1 style="margin: 6px 0 0; font-size: 22px; font-weight: 700; letter-spacing: -0.03em;">Your first report is ready.</h1>
          </div>

          <p style="margin: 0 0 8px; font-size: 15px; color: #111; line-height: 1.6;">
            Zybit finished analyzing <strong>${domain}</strong> and found
            <strong>${findingsCount} improvement${findingsCount !== 1 ? 's' : ''}</strong>
            ranked by potential impact.
          </p>

          ${impactLine}

          <p style="margin: 0 0 24px; font-size: 14px; color: #6B6B6B; line-height: 1.6;">
            Open your dashboard to review the findings, approve changes, and
            set up experiments to measure lift.
          </p>

          <a
            href="${dashboardUrl}"
            style="display: inline-block; padding: 12px 28px; border-radius: 999px; background: #111; color: #FAFAF8; text-decoration: none; font-size: 14px; font-weight: 600;"
          >
            View findings →
          </a>

          <p style="margin: 32px 0 0; font-size: 12px; color: #999; line-height: 1.5;">
            You received this because your site ${domain} completed its first insight run on Zybit.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend API Error (firstInsightEmail):', error);
      return { success: false, error: String(error) };
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to send first insight email:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

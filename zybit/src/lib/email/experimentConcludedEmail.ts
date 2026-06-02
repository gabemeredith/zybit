/**
 * Zybit-084 — PM notification when an experiment concludes.
 *
 * Sent by the compute-outcomes cron when an experiment auto-stops:
 *   - significance reached (win / loss),
 *   - duration elapsed without significance (inconclusive),
 *   - guardrail breached (stopped early).
 *
 * Follows the same Resend pattern as `firstInsightEmail.ts`. Best-effort:
 * the caller must never let a send failure block the cron or the status
 * transition.
 */

import { Resend } from 'resend';

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set');
  }
  return new Resend(key);
}

export interface ExperimentConcludedEmailParams {
  to: string;
  hypothesis: string;
  domain: string;
  /** Classified outcome: 'win' | 'loss' | 'inconclusive' | other. */
  result: string;
  controlRate: number | null;
  variantRate: number | null;
  liftPct: number;
  confidence: number;
  guardrailBreached: string | null;
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

function headline(result: string, guardrailBreached: string | null): string {
  if (guardrailBreached) return 'Experiment stopped — guardrail breached';
  if (result === 'win') return 'Your experiment won';
  if (result === 'loss') return 'Your experiment lost';
  return 'Your experiment concluded';
}

export async function sendExperimentConcludedEmail(
  params: ExperimentConcludedEmailParams,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { to, hypothesis, domain, result, controlRate, variantRate, liftPct, confidence, guardrailBreached } =
      params;

    const dashboardUrl = `https://app.zybit.dev/app/experiments`;

    const guardrailLine = guardrailBreached
      ? `<p style="margin: 0 0 16px; font-size: 15px; color: #B42318;"><strong>Guardrail breached:</strong> ${guardrailBreached}. The variant was rolled back automatically.</p>`
      : '';

    const liftSign = liftPct >= 0 ? '+' : '';

    const { error } = await getResendClient().emails.send({
      from: 'Zybit <notifications@resend.dev>',
      to,
      subject: `${headline(result, guardrailBreached)} — ${domain}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
          <div style="border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #6B6B6B;">Zybit</p>
            <h1 style="margin: 6px 0 0; font-size: 22px; font-weight: 700; letter-spacing: -0.03em;">${headline(result, guardrailBreached)}.</h1>
          </div>

          <p style="margin: 0 0 8px; font-size: 15px; color: #111; line-height: 1.6;">
            On <strong>${domain}</strong>: ${hypothesis}
          </p>

          ${guardrailLine}

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #6B6B6B;">Control rate</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${pct(controlRate)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6B6B6B;">Variant rate</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${pct(variantRate)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6B6B6B;">Relative lift</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${liftSign}${liftPct.toFixed(1)}%</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6B6B6B;">Confidence</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${(confidence * 100).toFixed(1)}%</td>
            </tr>
          </table>

          <a
            href="${dashboardUrl}"
            style="display: inline-block; padding: 12px 28px; border-radius: 999px; background: #111; color: #FAFAF8; text-decoration: none; font-size: 14px; font-weight: 600;"
          >
            View experiment →
          </a>

          <p style="margin: 32px 0 0; font-size: 12px; color: #999; line-height: 1.5;">
            You received this because an experiment on ${domain} concluded on Zybit.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend API Error (experimentConcludedEmail):', error);
      return { success: false, error: String(error) };
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to send experiment concluded email:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

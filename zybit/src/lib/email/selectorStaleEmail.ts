/**
 * Zybit-133 — PM notification when a running experiment's selectors no longer
 * match the latest page snapshot (likely a customer redesign). Sent by the
 * `check-selectors` cron. Best-effort, same Resend pattern as the other
 * senders: a send failure must never block the cron.
 */

import { Resend } from 'resend';
import type { StaleSelector } from '@/lib/experiments/selectorStaleness';

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}

export interface SelectorStaleEmailParams {
  to: string;
  domain: string;
  hypothesis: string;
  pathRef: string;
  staleSelectors: StaleSelector[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendSelectorStaleEmail(
  params: SelectorStaleEmailParams,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { to, domain, hypothesis, pathRef, staleSelectors } = params;
    const rows = staleSelectors
      .map(
        (s) =>
          `<tr><td style="padding:6px 0;font-family:monospace;">${escapeHtml(s.selector)}</td>` +
          `<td style="padding:6px 0;text-align:right;color:#B42318;">${s.reason === 'invalid_selector' ? 'invalid' : 'no match'}</td></tr>`,
      )
      .join('');

    const { error } = await getResendClient().emails.send({
      from: 'Zybit <notifications@resend.dev>',
      to,
      subject: `Experiment selectors stale on ${domain}${pathRef}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
          <div style="border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #6B6B6B;">Zybit</p>
            <h1 style="margin: 6px 0 0; font-size: 22px; font-weight: 700; letter-spacing: -0.03em;">Your variant may have stopped applying.</h1>
          </div>
          <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6;">
            On <strong>${escapeHtml(domain)}${escapeHtml(pathRef)}</strong>, the experiment
            "${escapeHtml(hypothesis)}" targets selectors that no longer match the page —
            likely a redesign. The variant may be a silent no-op, so its results can't be trusted.
          </p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 14px;">
            ${rows}
          </table>
          <a href="https://app.zybit.dev/app/experiments" style="display:inline-block;padding:12px 28px;border-radius:999px;background:#111;color:#FAFAF8;text-decoration:none;font-size:14px;font-weight:600;">
            Review experiment →
          </a>
          <p style="margin: 32px 0 0; font-size: 12px; color: #999; line-height: 1.5;">
            You received this because Zybit detected stale selectors on a running experiment.
          </p>
        </div>
      `,
    });

    if (error) return { success: false, error: String(error) };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'send failed' };
  }
}

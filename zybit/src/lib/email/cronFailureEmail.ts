/**
 * Ops alert email for cron failures (Zybit-155).
 *
 * Before this, a thrown error in a cron handler was only written to stdout —
 * ops had no signal unless they were actively reading logs. This sends an
 * internal Resend email so a failed cron is noticed.
 *
 * Best-effort: never throws. Requires RESEND_API_KEY + ALERT_EMAIL_TO
 * (same env contract as the connector disconnect alert in errorBudget.ts).
 */

import { Resend } from 'resend';
import { logger } from '@/lib/observability/logger';

export async function sendCronFailureAlert(params: {
  cronName: string;
  error: string;
}): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const alertTo = process.env.ALERT_EMAIL_TO;
    if (!apiKey || !alertTo) {
      logger.warn('Skipping cron failure alert — RESEND_API_KEY or ALERT_EMAIL_TO not set', {
        service: 'cron-sync',
        cronName: params.cronName,
      });
      return;
    }

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'Zybit Alerts <onboarding@resend.dev>',
      to: alertTo,
      subject: `[Zybit] Cron failed: ${params.cronName}`,
      text: [
        `The scheduled job "${params.cronName}" failed.`,
        '',
        `Error: ${params.error}`,
        `Time: ${new Date().toISOString()}`,
        '',
        'Check the Axiom log drain (service field) for the full structured error.',
      ].join('\n'),
    });

    logger.info('Cron failure alert email sent', {
      service: 'cron-sync',
      cronName: params.cronName,
    });
  } catch (err) {
    logger.error('Failed to send cron failure alert email', {
      service: 'cron-sync',
      cronName: params.cronName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

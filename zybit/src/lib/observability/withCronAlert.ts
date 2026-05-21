/**
 * withCronAlert — wraps a cron route handler so any failure triggers a
 * structured error log and an ops alert email (Zybit-155).
 *
 * A "failure" is either an unhandled throw or a 5xx response (most cron
 * handlers catch internally and return a 500 JSON envelope rather than
 * throwing, so both paths must be covered).
 */

import { logger } from './logger';
import { sendCronFailureAlert } from '@/lib/email/cronFailureEmail';

type CronHandler = (request: Request) => Promise<Response>;

export function withCronAlert(cronName: string, handler: CronHandler): CronHandler {
  return async (request: Request): Promise<Response> => {
    try {
      const response = await handler(request);
      if (response.status >= 500) {
        await alert(cronName, `Handler returned HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await alert(cronName, message);
      throw err;
    }
  };
}

async function alert(cronName: string, error: string): Promise<void> {
  logger.error('cron handler failed', { service: 'cron-sync', cronName, error });
  await sendCronFailureAlert({ cronName, error });
}

/**
 * Welcome email sent when a founder approves an access request.
 *
 * Carries the one-time set-password link (`/set-password?token=…`, HMAC token
 * minted by `signSetPasswordToken`) plus a "continue with Google" affordance.
 * Mirrors the Resend pattern used across the codebase (intake, audit report,
 * first-insight). Pure builder + thin sender so the approve route can unit-test
 * the HTML without sending.
 */

import { Resend } from 'resend';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WelcomeEmailInput {
  email: string;
  setPasswordUrl: string;
  googleSignInUrl: string;
}

export function buildWelcomeEmail(input: WelcomeEmailInput): { subject: string; html: string } {
  const setUrl = escapeHtml(input.setPasswordUrl);
  const googleUrl = escapeHtml(input.googleSignInUrl);
  const subject = "You're in — set up your Zybit account";
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <p style="font-size:14px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6B6B6B;margin:0 0 24px">Zybit</p>
      <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.03em;margin:0 0 16px;color:#111">You're approved.</h1>
      <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 28px">
        We've set up your Zybit account. Choose a password to finish — this link expires in 7 days and signs you straight in.
      </p>
      <a href="${setUrl}" style="display:inline-block;background:#111;color:#FAFAF8;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:14px 28px;border:2px solid #111">
        Set your password
      </a>
      <p style="font-size:13px;color:#6B6B6B;margin:24px 0 0;line-height:1.6">
        Prefer Google? <a href="${googleUrl}" style="color:#111;font-weight:600;">Continue with Google</a> using this same email.
      </p>
      <p style="font-size:12px;color:#6B6B6B;margin:24px 0 0;line-height:1.6">
        If you didn't expect this, you can safely ignore this email.
      </p>
    </div>
  `;
  return { subject, html };
}

export async function sendWelcomeEmail(input: WelcomeEmailInput): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const { subject, html } = buildWelcomeEmail(input);
  const resend = new Resend(key);
  await resend.emails.send({
    from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>',
    to: input.email,
    subject,
    html,
  });
}

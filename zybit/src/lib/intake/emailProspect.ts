import { Resend } from 'resend';
import type { IntakeFinding } from './structuralAudit';

const FOUNDERS_CALENDLY = 'https://calendly.com/asad-getzybit/30min';
const FOUNDERS_EMAIL_1 = 'asad@getzybit.com';
const FOUNDERS_EMAIL_2 = 'jad@getzybit.com';
const FROM = 'Asad at Zybit <onboarding@resend.dev>';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  _resend = new Resend(key);
  return _resend;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildProspectText(finding: IntakeFinding, _prospectEmail: string): string {
  return [
    `we looked at ${finding.domain}.`,
    '',
    `here's what we found:`,
    '',
    `- ${finding.title}`,
    '',
    `evidence: ${finding.evidence}`,
    '',
    `what to change: ${finding.prescription}`,
    '',
    `confidence: ${Math.round(finding.confidence * 100)}%`,
    '',
    `we'll have the full audit ready for you in a couple of days.`,
    `if you want to talk through it now: ${FOUNDERS_CALENDLY}`,
    '',
    'asad & jad',
    'zybit',
  ].join('\n');
}

function buildFallbackText(
  url: string,
  reason: string,
  prospectEmail: string,
): string {
  return [
    `intake submission: ${url}`,
    `prospect email: ${prospectEmail}`,
    `audit result: ${reason}`,
    '',
    `manual review needed.`,
  ].join('\n');
}

export type ProspectEmailResult = { success: true } | { success: false; error: string };

export async function emailProspect(
  prospectEmail: string,
  finding: IntakeFinding,
): Promise<ProspectEmailResult> {
  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from: FROM,
      to: prospectEmail,
      subject: `we found something on ${finding.domain}`,
      text: buildProspectText(finding, prospectEmail),
    });

    if (error) {
      console.error('Resend error (emailProspect):', error);
      return { success: false, error: error.message || 'Unknown Resend error' };
    }

    return { success: true };
  } catch (err) {
    console.error('emailProspect failed:', err);
    return { success: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function emailFoundersFallback(
  url: string,
  reason: string,
  prospectEmail: string,
): Promise<void> {
  try {
    const resend = getResend();
    await resend.emails.send({
      from: FROM,
      to: [FOUNDERS_EMAIL_1, FOUNDERS_EMAIL_2],
      subject: `[zybit intake] audit failed: ${url}`,
      text: buildFallbackText(url, reason, prospectEmail),
    });
  } catch (err) {
    console.error('emailFoundersFallback failed:', err);
  }
}

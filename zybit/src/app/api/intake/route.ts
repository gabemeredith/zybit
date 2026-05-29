import { NextResponse, after } from 'next/server';
import { Resend } from 'resend';
import { upsertAccessRequest } from '@/lib/auth/accessRequests';
import { isPersonalEmail, rejectionMessage } from '@/lib/audit/personalEmailDomains';

// randomUUID + drizzle in the access-request upsert require the Node runtime.
export const runtime = 'nodejs';

const ANALYTICS_LABELS: Record<string, string> = {
  posthog: 'PostHog',
  segment: 'Segment',
  ga4: 'GA4',
  other: 'Other / none',
};

function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set');
  }
  return new Resend(key);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, url, analytics } = body ?? {};

    if (!email || !url || !analytics) {
      return NextResponse.json(
        { error: 'Email, domain, and analytics tool are required.' },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    if (!ANALYTICS_LABELS[analytics]) {
      return NextResponse.json(
        { error: 'Please choose a valid analytics tool.' },
        { status: 400 }
      );
    }

    // Parity with the /audit funnel: this is a product-team front door, not a
    // consumer one. Personal-email addresses bounce with a helpful nudge.
    if (isPersonalEmail(email)) {
      return NextResponse.json({ error: rejectionMessage() }, { status: 400 });
    }

    // Persist the lead into the single pending queue. This is the front door
    // into the gated motion — approval happens deliberately in /admin. Keyed
    // on email so re-requests upsert rather than duplicate. Fail-soft: if the
    // DB write throws, the founder still gets the notification email below, so
    // the lead isn't lost.
    try {
      await upsertAccessRequest({
        email,
        source: 'request_form',
        domain: url,
        analyticsTool: analytics,
      });
    } catch (err) {
      console.error('[intake] access_request upsert failed:', err);
    }

    const safeEmail = escapeHtml(email);
    const safeUrl = escapeHtml(url);
    const analyticsLabel = ANALYTICS_LABELS[analytics];

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const { data, error } = await getResendClient().emails.send({
      from: process.env.AUTH_FROM_EMAIL ?? 'Zybit <noreply@mail.getzybit.com>',
      to: process.env.INTAKE_NOTIFY_EMAIL ?? 'asad@getzybit.com',
      subject: `New Zybit Survey Request — ${url}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #0E0C09;">
          <div style="border-bottom: 2px solid #0E0C09; padding-bottom: 16px; margin-bottom: 24px;">
            <h1 style="font-size: 24px; font-weight: 400; margin: 0;">New Survey Request</h1>
            <p style="font-size: 13px; color: #5A4F3A; margin: 6px 0 0; letter-spacing: 0.1em; text-transform: uppercase;">Zybit Intake · ${timestamp}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 16px;">
            <tr style="border-bottom: 1px solid #D9CFB0;">
              <td style="padding: 12px 0; color: #5A4F3A; width: 140px; vertical-align: top;">Email</td>
              <td style="padding: 12px 0;"><a href="mailto:${safeEmail}" style="color: #7A4A1A;">${safeEmail}</a></td>
            </tr>
            <tr style="border-bottom: 1px solid #D9CFB0;">
              <td style="padding: 12px 0; color: #5A4F3A; vertical-align: top;">Domain</td>
              <td style="padding: 12px 0;"><a href="${safeUrl}" style="color: #7A4A1A;">${safeUrl}</a></td>
            </tr>
            <tr>
              <td style="padding: 12px 0; color: #5A4F3A; vertical-align: top;">Analytics</td>
              <td style="padding: 12px 0;">${escapeHtml(analyticsLabel)}</td>
            </tr>
          </table>

          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #D9CFB0; font-size: 13px; color: #5A4F3A; font-style: italic;">
            Submitted via the Zybit landing page.
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('Resend API Error:', error);
      return NextResponse.json(
        { error: 'Failed to submit request. Please try again.' },
        { status: 500 }
      );
    }

    // Schedule structural audit + prospect email after the response is sent.
    // `after()` keeps the execution context alive on Vercel — safe in serverless.
    const auditSecret = process.env.INTAKE_AUDIT_SECRET;
    if (auditSecret) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      after(
        fetch(`${baseUrl}/api/intake/audit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-intake-audit-secret': auditSecret,
          },
          body: JSON.stringify({ email, url }),
        }).catch((err) => console.error('Intake audit after() failed:', err)),
      );
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (error) {
    console.error('Intake Error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

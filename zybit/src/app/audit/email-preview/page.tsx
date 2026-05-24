/**
 * /audit/email-preview — render the audit emails in iframes for design
 * review. Mock data only; no real send.
 *
 * Shows BOTH templates because the flow requires both:
 *   - confirmation email (sent immediately on submit, double opt-in)
 *   - full report email  (sent ~45s after the prospect clicks confirm)
 *
 * Disabled in production deployments.
 */

import { notFound } from 'next/navigation';
import {
  renderAuditReportEmailHtml,
  sampleAuditReport,
} from '@/lib/email/auditReportEmail';
import {
  renderAuditConfirmationEmailHtml,
  sampleAuditConfirmationRequest,
} from '@/lib/email/auditConfirmationEmail';

export const dynamic = 'force-dynamic';

type Variant = 'confirmation' | 'report';

interface SearchParams {
  v?: string;
}

export default async function AuditEmailPreviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Hide if EITHER signal says production — covers Vercel (VERCEL_ENV) and
  // non-Vercel deployments (Docker, custom server) where only NODE_ENV is set.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    notFound();
  }

  const resolved = await searchParams;
  const variant: Variant = resolved.v === 'report' ? 'report' : 'confirmation';

  const meta =
    variant === 'confirmation'
      ? (() => {
          const req = sampleAuditConfirmationRequest();
          return {
            subject: `Confirm your Zybit audit of ${req.domain}`,
            to: req.recipientEmail,
            from: 'Zybit',
            html: renderAuditConfirmationEmailHtml(req),
          };
        })()
      : (() => {
          const report = sampleAuditReport();
          return {
            subject: `Four things to fix on ${report.domain}`,
            to: report.prospect.email,
            from: 'Asad & Jad at Zybit',
            html: renderAuditReportEmailHtml(report),
          };
        })();

  return (
    <main style={{ background: '#1f1f1f', minHeight: '100vh', padding: 24 }}>
      <header
        style={{
          maxWidth: 720,
          margin: '0 auto 16px',
          color: '#FAFAF8',
          fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif',
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.6 }}>
          Email preview · sample data ·{' '}
          {variant === 'confirmation' ? (
            <>
              showing <strong>confirmation</strong> · <a href="?v=report" style={{ color: '#FAFAF8' }}>switch to full report →</a>
            </>
          ) : (
            <>
              showing <strong>full report</strong> · <a href="?v=confirmation" style={{ color: '#FAFAF8' }}>← back to confirmation</a>
            </>
          )}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
          Subject: {meta.subject}
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
          To: {meta.to} · From: {meta.from}
        </div>
      </header>
      <iframe
        title={`Audit ${variant} email preview`}
        srcDoc={meta.html}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          height: 'calc(100vh - 140px)',
          background: '#EFEEE9',
          border: 'none',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      />
    </main>
  );
}

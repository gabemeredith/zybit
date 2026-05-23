/**
 * /audit/email-preview — render the audit-report email HTML in an iframe
 * for design review. Mock data only; no real send.
 *
 * Disabled in production. Visit locally or in a dev/preview deployment.
 */

import { notFound } from 'next/navigation';
import { renderAuditReportEmailHtml, sampleAuditReport } from '@/lib/email/auditReportEmail';

export const dynamic = 'force-dynamic';

export default function AuditEmailPreviewPage() {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production') {
    notFound();
  }

  const report = sampleAuditReport();
  const html = renderAuditReportEmailHtml(report);

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
          Email preview · sample data
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>
          Subject: Your Zybit audit — {report.domain}
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
          To: {report.prospect.email} · From: Asad &amp; Jad at Zybit
        </div>
      </header>
      <iframe
        title="Audit report email preview"
        srcDoc={html}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          height: 'calc(100vh - 120px)',
          background: '#EFEEE9',
          border: 'none',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      />
    </main>
  );
}

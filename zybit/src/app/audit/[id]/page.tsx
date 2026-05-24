'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';

type AuditStatus = 'running' | 'done' | 'unreachable' | 'failed' | 'unknown';

interface StatusResponse {
  id: string;
  status: string;
  domain: string;
  completedAt: string | null;
  error: string | null;
}

function Dots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v % 3) + 1), 400);
    return () => clearInterval(id);
  }, []);
  return <span aria-hidden> {'.'.repeat(n)}</span>;
}

export default function AuditStatusPage() {
  const params = useParams();
  const auditId = typeof params?.id === 'string' ? params.id : null;

  const [status, setStatus] = useState<AuditStatus>('running');
  const [domain, setDomain] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auditId) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/audit/public/status?id=${auditId}`);
        if (!res.ok) {
          setStatus('failed');
          setError('Could not reach the audit service.');
          return;
        }
        const data: StatusResponse = await res.json();
        if (cancelled) return;

        setDomain(data.domain);

        if (data.status === 'done') {
          setStatus('done');
          return;
        }
        if (data.status === 'unreachable') {
          setStatus('unreachable');
          return;
        }
        if (data.status === 'failed') {
          setStatus('failed');
          setError(data.error ?? 'The audit pipeline encountered an error.');
          return;
        }

        // Still running — poll again in 8 seconds
        timeoutId = setTimeout(poll, 8000);
      } catch {
        if (!cancelled) {
          timeoutId = setTimeout(poll, 12000);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [auditId]);

  const bookCallUrl =
    process.env.NEXT_PUBLIC_BOOK_CALL_URL ?? 'https://calendly.com/asad-getzybit/30min';

  return (
    <main
      style={{
        minHeight: '100vh',
        background: CREAM,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif',
      }}
    >
      {status === 'running' && (
        <div
          style={{
            background: '#FFFFFF',
            border: `2px solid ${INK}`,
            boxShadow: `8px 8px 0 ${INK}`,
            padding: '36px 32px',
            maxWidth: 520,
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 12,
            }}
          >
            Zybit · Audit running{domain ? ` · ${domain}` : ''}
          </div>
          <h1
            style={{
              margin: '0 0 20px',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: INK,
            }}
          >
            Auditing your site
            <Dots />
          </h1>
          <p style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.6, color: INK }}>
            We&rsquo;re crawling your pages and running the 13 friction rules now.
            This takes 45&ndash;90 seconds. The full report will arrive in your inbox
            as soon as it&rsquo;s done.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
            You can close this tab — the audit runs on our servers and the report
            goes straight to your email.
          </p>
        </div>
      )}

      {status === 'done' && (
        <div
          style={{
            background: '#FFFFFF',
            border: `2px solid ${INK}`,
            boxShadow: `8px 8px 0 ${INK}`,
            padding: '36px 32px',
            maxWidth: 520,
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 12,
            }}
          >
            Zybit · Audit complete
          </div>
          <h1
            style={{
              margin: '0 0 16px',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: INK,
            }}
          >
            Your report is in your inbox.
          </h1>
          <p style={{ margin: '0 0 24px', fontSize: 15, lineHeight: 1.6, color: INK }}>
            We emailed you the four priority findings — evidence, what to change, and a
            rough dollar estimate for each. Want to walk through them live?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <a
              href={bookCallUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: INK,
                color: CREAM,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                boxShadow: `4px 4px 0 ${INK}`,
                border: `1px solid ${INK}`,
              }}
            >
              Book 30 minutes with us →
            </a>
            <Link
              href="/audit"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: 'transparent',
                color: INK,
                border: `1px solid ${INK}`,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Audit another site
            </Link>
          </div>
        </div>
      )}

      {status === 'unreachable' && (
        <div
          style={{
            background: '#FFFFFF',
            border: `2px solid ${INK}`,
            boxShadow: `8px 8px 0 ${INK}`,
            padding: '36px 32px',
            maxWidth: 560,
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 12,
            }}
          >
            Zybit · Couldn&rsquo;t reach your site
          </div>
          <h1
            style={{
              margin: '0 0 16px',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              color: INK,
            }}
          >
            We couldn&rsquo;t read {domain || 'your site'}.
          </h1>
          <p style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.6, color: INK }}>
            Our crawler hit a wall before it could scan a single page. We didn&rsquo;t send you a
            report — &ldquo;0 findings&rdquo; reads as &ldquo;Zybit found nothing wrong&rdquo; and that
            isn&rsquo;t what happened.
          </p>
          <div
            style={{
              padding: '12px 14px',
              background: '#FFF4E5',
              border: `1px solid ${INK}`,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: MUTED,
                marginBottom: 6,
              }}
            >
              Most common causes
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: INK }}>
              <li>Bot protection (Cloudflare, Akamai) blocked the crawler</li>
              <li>Your <code>robots.txt</code> disallows our user-agent</li>
              <li>The page is rendered entirely with JS and has no link discovery in the HTML</li>
            </ul>
          </div>
          <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, color: INK }}>
            Try a less-protected page on the same domain — often <code>/pricing</code>,{' '}
            <code>/about</code>, or a blog post will slip past where the root won&rsquo;t. Or email us
            the URL and we&rsquo;ll run it manually.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Link
              href="/audit"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: INK,
                color: CREAM,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                boxShadow: `4px 4px 0 ${INK}`,
                border: `1px solid ${INK}`,
              }}
            >
              Try a different URL →
            </Link>
            <a
              href={`mailto:jad@getzybit.com?subject=${encodeURIComponent(
                `Audit help: ${domain || 'my site'}`,
              )}`}
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: 'transparent',
                color: INK,
                border: `1px solid ${INK}`,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Email us
            </a>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div
          style={{
            background: '#FFFFFF',
            border: `2px solid ${INK}`,
            boxShadow: `8px 8px 0 ${INK}`,
            padding: '36px 32px',
            maxWidth: 520,
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 12,
            }}
          >
            Zybit · Audit failed
          </div>
          <h1
            style={{
              margin: '0 0 16px',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: INK,
            }}
          >
            Something went wrong.
          </h1>
          <p style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.6, color: INK }}>
            The audit couldn&rsquo;t complete. This sometimes happens with sites that block
            crawlers, require auth, or return errors.
          </p>
          {error && (
            <p
              style={{
                margin: '0 0 24px',
                padding: '10px 12px',
                background: '#FFF4E5',
                border: `1px solid ${INK}`,
                fontSize: 13,
                color: INK,
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>
          )}
          <p style={{ margin: '0 0 24px', fontSize: 14, color: MUTED }}>
            Email us at{' '}
            <a href="mailto:jad@getzybit.com" style={{ color: INK }}>jad@getzybit.com</a>{' '}
            and we&rsquo;ll look into it.
          </p>
          <Link
            href="/audit"
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              background: INK,
              color: CREAM,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Try again →
          </Link>
        </div>
      )}
    </main>
  );
}

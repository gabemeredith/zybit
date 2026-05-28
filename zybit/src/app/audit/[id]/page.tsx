'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { BeforeAfterSlider } from '@/components/audit/BeforeAfterSlider';
import { PUBLIC_AUDIT_RULE_COUNT } from '@/lib/audit/publicAuditRuleCount';

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';
const HAIRLINE = 'rgba(0,0,0,0.12)';
const SAFE_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

type AuditStatus = 'running' | 'done' | 'unreachable' | 'failed' | 'unknown';
type SigninState = 'sent' | 'no-account' | 'rate-limited' | null;

interface InlineFinding {
  title: string;
  severity: string;
  whyItMatters?: string;
  screenshotBeforeUrl?: string;
  screenshotAfterUrl?: string;
  fixPreviewTier?: 1 | 2 | 3;
  fixRationale?: string;
}

interface BrandDna {
  primaryColor: string | null;
  secondaryColor: string | null;
  typeScale: number[] | null;
  cssSystem: string | null;
  ctaVocabulary: string[];
}

interface StatusResponse {
  id: string;
  status: string;
  domain: string;
  completedAt: string | null;
  error: string | null;
  findings: InlineFinding[] | null;
  brandDna: BrandDna | null;
}

function Dots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v % 3) + 1), 400);
    return () => clearInterval(id);
  }, []);
  return <span aria-hidden> {'.'.repeat(n)}</span>;
}

function SigninBanner({ state, email }: { state: SigninState; email: string | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (!state || dismissed) return null;

  const palette =
    state === 'sent'
      ? { bg: '#E8F4EA', border: INK, label: 'Sign-in link sent' }
      : state === 'no-account'
        ? { bg: '#FFF4E5', border: INK, label: "Couldn't find an account" }
        : { bg: '#FFF4E5', border: INK, label: 'Too many sign-in attempts' };

  const body =
    state === 'sent'
      ? email
        ? `Check your inbox — we sent a sign-in link to ${email}.`
        : 'Check your inbox — we just sent you a sign-in link.'
      : state === 'no-account'
        ? "We couldn't find an account for this email. Email jad@getzybit.com and we'll help."
        : 'Too many sign-in attempts. Try again in a few minutes.';

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 560,
        width: 'calc(100% - 32px)',
        background: palette.bg,
        border: `2px solid ${palette.border}`,
        boxShadow: `4px 4px 0 ${INK}`,
        padding: '14px 16px',
        zIndex: 10,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 4,
          }}
        >
          {palette.label}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: INK }}>{body}</div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          color: INK,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function ColorSwatch({ hex, label }: { hex: string; label: string }) {
  if (!SAFE_HEX_RE.test(hex)) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          display: 'block',
          width: 20,
          height: 20,
          background: hex,
          border: `1px solid ${HAIRLINE}`,
          flexShrink: 0,
        }}
      />
      <span>
        <span
          style={{
            display: 'block',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: MUTED,
            lineHeight: 1,
            marginBottom: 2,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 12, color: INK }}>{hex}</span>
      </span>
    </div>
  );
}

function BrandDnaSection({ dna }: { dna: BrandDna }) {
  const hasColors = (dna.primaryColor && SAFE_HEX_RE.test(dna.primaryColor)) ||
    (dna.secondaryColor && SAFE_HEX_RE.test(dna.secondaryColor));
  const hasAnyContent = hasColors || dna.cssSystem !== null || (dna.typeScale && dna.typeScale.length > 0) || dna.ctaVocabulary.length > 0;
  if (!hasAnyContent) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: 10,
        }}
      >
        Design signals we observed
      </div>
      <div
        style={{
          border: `1px solid ${HAIRLINE}`,
          padding: '14px 16px',
          background: '#FFFFFF',
        }}
      >
        {hasColors && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            {dna.primaryColor && SAFE_HEX_RE.test(dna.primaryColor) && (
              <ColorSwatch hex={dna.primaryColor} label="CTA fill" />
            )}
            {dna.secondaryColor && SAFE_HEX_RE.test(dna.secondaryColor) && (
              <ColorSwatch hex={dna.secondaryColor} label="Heading" />
            )}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td
                style={{
                  paddingBottom: 6,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: MUTED,
                  width: '36%',
                  verticalAlign: 'top',
                  paddingTop: hasColors ? 0 : 0,
                }}
              >
                Framework
              </td>
              <td
                style={{
                  paddingBottom: 6,
                  fontSize: 12,
                  color: dna.cssSystem ? INK : MUTED,
                  verticalAlign: 'top',
                }}
              >
                {dna.cssSystem ?? 'unknown (compiled or hashed classes)'}
              </td>
            </tr>
            {dna.typeScale && dna.typeScale.length > 0 && (
              <tr>
                <td
                  style={{
                    paddingBottom: 6,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: MUTED,
                    verticalAlign: 'top',
                  }}
                >
                  Type sizes
                </td>
                <td style={{ paddingBottom: 6, fontSize: 12, color: INK, verticalAlign: 'top' }}>
                  {dna.typeScale.map((n) => `${n}px`).join(' · ')}
                </td>
              </tr>
            )}
            {dna.ctaVocabulary.length > 0 && (
              <tr>
                <td
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: MUTED,
                    verticalAlign: 'top',
                  }}
                >
                  Copy samples
                </td>
                <td style={{ fontSize: 12, color: INK, verticalAlign: 'top' }}>
                  {dna.ctaVocabulary.slice(0, 5).map((t, i) => (
                    <span key={i}>
                      {i > 0 && <span style={{ color: MUTED }}> · </span>}
                      &ldquo;{t}&rdquo;
                    </span>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p style={{ margin: '10px 0 0', fontSize: 11, lineHeight: 1.55, color: MUTED }}>
          Colors your CTAs and headings actually render with, the type sizes the page uses,
          and the conversion copy we found. The findings reference them by name.
        </p>
      </div>
    </div>
  );
}

function AuditStatusPageInner() {
  const params = useParams();
  const auditId = typeof params?.id === 'string' ? params.id : null;

  const searchParams = useSearchParams();
  const rawSignin = searchParams?.get('signin');
  const signinState: SigninState =
    rawSignin === 'sent' || rawSignin === 'no-account' || rawSignin === 'rate-limited'
      ? rawSignin
      : null;
  const signinEmail = searchParams?.get('email') ?? null;

  const [status, setStatus] = useState<AuditStatus>('running');
  const [domain, setDomain] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<InlineFinding[] | null>(null);
  const [brandDna, setBrandDna] = useState<BrandDna | null>(null);

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
        if (data.findings) setFindings(data.findings);
        if (data.brandDna) setBrandDna(data.brandDna);

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
      <SigninBanner state={signinState} email={signinEmail} />
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
            We&rsquo;re crawling your pages and running the {PUBLIC_AUDIT_RULE_COUNT}{' '}friction rules now.
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
            maxWidth: 580,
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
            Your audit of {domain || 'your site'} is ready.
          </h1>

          {brandDna && <BrandDnaSection dna={brandDna} />}

          {findings && findings.length > 0 ? (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.6, color: MUTED }}>
                Top {findings.length} {findings.length === 1 ? 'finding' : 'findings'} from this audit
                — full report is in your inbox.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {findings.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      border: `1px solid ${INK}`,
                      padding: '14px 16px',
                      background: CREAM,
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: INK }}>
                      {f.title}
                    </div>
                    {f.whyItMatters ? (
                      <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: INK }}>
                        {f.whyItMatters}
                      </p>
                    ) : null}
                    {f.screenshotBeforeUrl ? (
                      <BeforeAfterSlider
                        beforeUrl={f.screenshotBeforeUrl}
                        afterUrl={f.screenshotAfterUrl ?? null}
                        rationale={f.fixRationale ?? null}
                        badge={
                          f.fixPreviewTier === 2
                            ? 'AI visual edit'
                            : f.fixPreviewTier === 1
                              ? 'Proposed fix'
                              : undefined
                        }
                        alt={`finding ${i + 1}`}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ margin: '0 0 24px', fontSize: 15, lineHeight: 1.6, color: INK }}>
              The full report — with evidence, what to change, and fix previews for each
              finding — was emailed to the address you submitted.
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <a
              href={bookCallUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                padding: '13px 26px',
                background: INK,
                color: CREAM,
                border: `1px solid ${INK}`,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                boxShadow: `4px 4px 0 ${INK}`,
              }}
            >
              Book 30 min with us →
            </a>
            <Link
              href="/audit"
              style={{
                display: 'inline-block',
                padding: '13px 24px',
                background: 'transparent',
                color: MUTED,
                textDecoration: 'underline',
                fontSize: 13,
                letterSpacing: '0.05em',
              }}
            >
              Audit another site
            </Link>
          </div>

          <p style={{ margin: '18px 0 0', fontSize: 12, lineHeight: 1.5, color: MUTED }}>
            30 minutes on a screen-share. We&rsquo;ll walk through each finding, answer your
            questions, and tell you straight whether Zybit fits your team. No pitch deck.
          </p>
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

export default function AuditStatusPage() {
  return (
    <Suspense fallback={null}>
      <AuditStatusPageInner />
    </Suspense>
  );
}

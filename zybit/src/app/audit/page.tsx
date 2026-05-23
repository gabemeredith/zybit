'use client';

/**
 * /audit — public URL-audit lead-magnet page.
 *
 * **This is a Phase-A visual mock** (see `docs/sprints/url-audit-lead-magnet.md` §6).
 * No backend wiring: state transitions are driven by client timers that
 * mimic the ~45-second real pipeline so founders can react to the surface
 * before any backend cost. Phase B promotes this to a real polling page
 * against `/api/audit/public`.
 *
 * Brand intent: premium, scarce, personally-reviewed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { IntakeModal } from '@/components/IntakeModal';
import { isPersonalEmail, rejectionMessage } from '@/lib/audit/personalEmailDomains';

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';
const HAIRLINE = 'rgba(0,0,0,0.12)';

const ROLES = [
  'Product Manager',
  'Founder / CEO',
  'Head of Growth',
  'Head of Product',
  'Engineering Lead',
  'Designer',
  'Other',
] as const;

type Role = (typeof ROLES)[number] | '';
// idle      → form is shown
// running   → audit pipeline runs in-browser (mock timers); progress strip
// teaser    → one finding revealed; "request the full report" form below
// awaiting  → confirmation email sent; report fires only after they click
//             the link in their inbox (double opt-in — see spec §4a A)
type Stage = 'idle' | 'running' | 'teaser' | 'awaiting' | 'error';

interface FormState {
  url: string;
  email: string;
  role: Role;
}

const EMPTY: FormState = { url: '', email: '', role: '' };

interface ProgressStep {
  label: string;
  ms: number;
}

const PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Fetching homepage', ms: 4000 },
  { label: 'Parsing structure & extracting CTAs', ms: 6000 },
  { label: 'Mapping internal pages', ms: 7000 },
  { label: 'Running 13 friction rules', ms: 9000 },
  { label: 'Ranking findings by impact', ms: 5000 },
];

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProtocol);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function hostFromUrl(input: string): string {
  try {
    return new URL(input).host.replace(/^www\./, '');
  } catch {
    return input;
  }
}

export default function AuditPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progressIdx, setProgressIdx] = useState(0);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);

  // Mock pipeline: advance through PROGRESS_STEPS, then reveal teaser.
  // `submit()` resets progressIdx to 0 before flipping to 'running' so this
  // effect doesn't have to setState synchronously on mount.
  useEffect(() => {
    if (stage !== 'running') return;
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      if (i >= PROGRESS_STEPS.length) {
        setStage('teaser');
        return;
      }
      const ms = PROGRESS_STEPS[i].ms;
      i += 1;
      setTimeout(() => {
        if (cancelled) return;
        setProgressIdx(i);
        tick();
      }, ms);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const url = normalizeUrl(form.url);
    if (!url) {
      setError('That doesn’t look like a valid URL. Try acme.com or https://acme.com.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (isPersonalEmail(form.email)) {
      setError(rejectionMessage());
      return;
    }
    if (!form.role) {
      setError('Pick a role so we know who we’re writing to.');
      return;
    }

    setForm({ ...form, url });
    setProgressIdx(0);
    setStage('running');
  };

  const reset = () => {
    setStage('idle');
    setForm(EMPTY);
    setProgressIdx(0);
    setError(null);
  };

  const sendEmailMock = () => {
    // In Phase B this triggers the confirmation email — NOT the report.
    // The report follows only after the prospect clicks the confirmation
    // link in their inbox. Spec §4a A.
    setStage('awaiting');
  };

  return (
    <main className="relative w-full min-h-screen" style={{ background: CREAM, color: INK }}>
      <SiteNav onRequestAccess={() => setIsAccessModalOpen(true)} />
      <IntakeModal isOpen={isAccessModalOpen} onClose={() => setIsAccessModalOpen(false)} />

      <div className="relative z-10 max-w-[1100px] mx-auto px-6 md:px-10 pt-28 md:pt-36 pb-24">
        <Hero />

        <section className="mt-12 md:mt-16">
          {stage === 'idle' && (
            <AuditForm
              form={form}
              setForm={setForm}
              onSubmit={submit}
              error={error}
            />
          )}

          {stage === 'running' && (
            <RunningPanel form={form} progressIdx={progressIdx} />
          )}

          {stage === 'teaser' && (
            <TeaserPanel form={form} onSendEmail={sendEmailMock} />
          )}

          {stage === 'awaiting' && <AwaitingPanel form={form} onReset={reset} />}
        </section>

        <TrustStrip />
        <FAQ />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <header className="max-w-[760px]">
      <div
        className="sans-text"
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        Zybit · 60-second audit
      </div>
      <h1
        className="sans-text"
        style={{
          marginTop: 16,
          fontSize: 'clamp(2.5rem, 6vw, 5rem)',
          fontWeight: 800,
          lineHeight: 0.95,
          letterSpacing: '-0.035em',
          color: INK,
        }}
      >
        Four things to fix
        <br />
        on your homepage.
      </h1>
      <p
        className="sans-text"
        style={{
          marginTop: 24,
          fontSize: 18,
          lineHeight: 1.55,
          color: INK,
          maxWidth: 620,
        }}
      >
        Give us your URL and we&rsquo;ll run the same 13 friction rules our customers
        use — against your live site. You&rsquo;ll get a one-page report by email:
        four ranked findings, the evidence behind each, what to change, and a rough
        dollar estimate.
      </p>
      <p
        className="sans-text"
        style={{
          marginTop: 16,
          fontSize: 14,
          lineHeight: 1.55,
          color: MUTED,
          maxWidth: 620,
        }}
      >
        Work-email only. We confirm by email before sending — so audit results
        only ever reach the inbox that asked for them.
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Form (stage: idle)
// ---------------------------------------------------------------------------

function AuditForm({
  form,
  setForm,
  onSubmit,
  error,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="sans-text"
      style={{
        background: '#FFFFFF',
        border: `2px solid ${INK}`,
        boxShadow: `8px 8px 0 ${INK}`,
        padding: '28px 24px',
        maxWidth: 640,
      }}
    >
      <Field label="Your homepage URL" htmlFor="audit-url">
        <input
          id="audit-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="acme.com"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          style={inputStyle}
        />
      </Field>

      <Field label="Work email" htmlFor="audit-email" hint="We confirm by email before running anything. Personal addresses (gmail, etc.) are routed to the waitlist instead.">
        <input
          id="audit-email"
          type="email"
          autoComplete="email"
          placeholder="you@acme.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          style={inputStyle}
        />
      </Field>

      <Field label="Your role" htmlFor="audit-role">
        <select
          id="audit-role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
        >
          <option value="">Select…</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 4,
            marginBottom: 16,
            padding: '10px 12px',
            border: `1px solid ${INK}`,
            background: '#FFF4E5',
            fontSize: 13,
            lineHeight: 1.5,
            color: INK,
          }}
        >
          {error}
        </div>
      )}

      <button type="submit" className="btn-brutalist" style={{ width: '100%' }}>
        Run the audit →
      </button>

      <p
        style={{
          marginTop: 14,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: MUTED,
          textAlign: 'center',
        }}
      >
        Free · No credit card · Rate-limited to keep things sane
      </p>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: 15,
  fontFamily: 'inherit',
  color: INK,
  background: CREAM,
  border: `1px solid ${INK}`,
  outline: 'none',
  boxSizing: 'border-box',
};

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label
        htmlFor={htmlFor}
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: INK,
          marginBottom: 8,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            lineHeight: 1.45,
            color: MUTED,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running (stage: running)
// ---------------------------------------------------------------------------

function RunningPanel({ form, progressIdx }: { form: FormState; progressIdx: number }) {
  const host = hostFromUrl(form.url);
  return (
    <div
      className="sans-text"
      style={{
        background: '#FFFFFF',
        border: `2px solid ${INK}`,
        boxShadow: `8px 8px 0 ${INK}`,
        padding: '28px 24px',
        maxWidth: 640,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: 10,
        }}
      >
        Auditing {host}…
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: INK, marginBottom: 24 }}>
        Keep this tab open — about 45 seconds to go.
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {PROGRESS_STEPS.map((step, i) => {
          const isDone = i < progressIdx;
          const isActive = i === progressIdx;
          return (
            <li
              key={step.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: `1px solid ${HAIRLINE}`,
                opacity: isDone || isActive ? 1 : 0.4,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: `2px solid ${INK}`,
                  background: isDone ? INK : isActive ? '#FFE599' : 'transparent',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 14, color: INK }}>
                {step.label}
                {isActive && <Dots />}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Dots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v % 3) + 1), 400);
    return () => clearInterval(id);
  }, []);
  return <span aria-hidden> {'.'.repeat(n)}</span>;
}

// ---------------------------------------------------------------------------
// Teaser (stage: teaser) — ONE finding inline. Rest goes in the email.
// ---------------------------------------------------------------------------

function TeaserPanel({ form, onSendEmail }: { form: FormState; onSendEmail: () => void }) {
  const host = hostFromUrl(form.url);
  return (
    <div style={{ maxWidth: 760 }}>
      <div
        className="sans-text"
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: 12,
        }}
      >
        Top finding · {host}
      </div>
      <h2
        className="sans-text"
        style={{
          fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          color: INK,
          marginBottom: 8,
        }}
      >
        We found 11 things worth fixing.
        <br />
        Here&rsquo;s the most expensive one.
      </h2>
      <p
        className="sans-text"
        style={{ fontSize: 15, lineHeight: 1.55, color: MUTED, marginBottom: 24, maxWidth: 600 }}
      >
        The other three top-priority findings — plus suggested changes and dollar
        estimates — are in the report. Request it below and we&rsquo;ll send a
        confirmation link to your inbox first.
      </p>

      <TeaserCard />

      <div
        className="sans-text"
        style={{
          marginTop: 28,
          background: '#FFFFFF',
          border: `2px solid ${INK}`,
          boxShadow: `8px 8px 0 ${INK}`,
          padding: '22px 24px',
          maxWidth: 560,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 8,
          }}
        >
          Confirm to receive the report
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: INK, marginBottom: 4 }}>
          {form.email}
        </div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 18, lineHeight: 1.5 }}>
          We&rsquo;ll send a one-click confirmation link to this address. After you click,
          the full report arrives within the hour.
        </div>
        <button onClick={onSendEmail} className="btn-brutalist" style={{ width: '100%' }}>
          Email me the confirmation link →
        </button>
        <p style={{ marginTop: 12, fontSize: 12, color: MUTED, textAlign: 'center' }}>
          Wrong address? <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ background: 'none', border: 'none', textDecoration: 'underline', color: INK, cursor: 'pointer', font: 'inherit' }}
          >
            Start over
          </button>
        </p>
      </div>
    </div>
  );
}

function TeaserCard() {
  // Same receipt-card visual language as the landing page sample finding.
  return (
    <div
      className="sans-text"
      style={{
        background: CREAM,
        border: `2px solid ${INK}`,
        boxShadow: `8px 8px 0 ${INK}`,
        maxWidth: 560,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: `2px solid ${INK}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          gap: 12,
        }}
      >
        <span style={{ color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          F-0001 · hero-hierarchy-inversion
        </span>
        <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>High · 0.79</span>
      </div>
      <div style={{ padding: '18px', borderBottom: `1px solid ${HAIRLINE}` }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 8,
          }}
        >
          Finding
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em', color: INK }}>
          Hero gives most visual weight to the secondary action
        </div>
      </div>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${HAIRLINE}` }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 8,
          }}
        >
          Evidence
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: INK }}>
          The &ldquo;Book a demo&rdquo; button uses the filled brand-blue treatment in the hero,
          while &ldquo;Start free trial&rdquo; is a plain text link. Yet 58% of all CTA clicks on the homepage go
          to &ldquo;Start free trial&rdquo;. Visual emphasis is inverted relative to revealed preference.
        </div>
      </div>
      <div
        style={{
          padding: '16px 18px',
          background: INK,
          color: CREAM,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.6,
          }}
        >
          Est. impact
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>~$5.4k / month</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Awaiting confirmation (stage: awaiting)
// Double opt-in: the report only fires after the prospect clicks the link
// in the confirmation email. Keeps Zybit from becoming an unsolicited-mail
// vector for whatever address someone types into the form. Spec §4a A.
// ---------------------------------------------------------------------------

function AwaitingPanel({ form, onReset }: { form: FormState; onReset: () => void }) {
  return (
    <div
      className="sans-text"
      style={{
        background: '#FFFFFF',
        border: `2px solid ${INK}`,
        boxShadow: `8px 8px 0 ${INK}`,
        padding: '32px 28px',
        maxWidth: 640,
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
        Check your inbox
      </div>
      <h2
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: '-0.025em',
          color: INK,
          marginBottom: 14,
          lineHeight: 1.1,
        }}
      >
        We sent a confirmation link to {form.email}.
      </h2>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: INK, marginBottom: 20 }}>
        Click the link to confirm the request is yours. The full report follows
        within the hour. We do this so audit results only ever land in the inbox
        that actually asked for them.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: MUTED, marginBottom: 24 }}>
        Want to walk through the findings live once they arrive? Grab 30 minutes
        with the founders — we&rsquo;ll go through them on screen-share and tell
        you straight whether Zybit fits your team.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <a
          href="https://calendly.com/asad-getzybit/30min"
          target="_blank"
          rel="noreferrer"
          className="btn-brutalist"
        >
          Book the founders →
        </a>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: '12px 24px',
            background: 'transparent',
            color: INK,
            border: `1px solid ${INK}`,
            fontSize: 14,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          Audit another site
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trust strip + FAQ
// ---------------------------------------------------------------------------

function TrustStrip() {
  const items = useMemo(
    () => [
      { k: '13', v: 'deterministic rules' },
      { k: '~45s', v: 'audit runtime' },
      { k: '4', v: 'findings per report' },
      { k: 'Double', v: 'opt-in by email' },
    ],
    [],
  );
  return (
    <section
      className="sans-text"
      style={{
        marginTop: 80,
        paddingTop: 40,
        borderTop: `1px solid ${HAIRLINE}`,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 24,
        }}
      >
        {items.map((it) => (
          <div key={it.v}>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.025em', color: INK, lineHeight: 1 }}>
              {it.k}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: MUTED,
              }}
            >
              {it.v}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: 'Why do I have to confirm by email?',
      a: 'So Zybit only ever sends audit results to the inbox that actually asked for them. The form is open to anyone — without the confirmation step, someone could type a stranger\'s address and we\'d unwittingly send unsolicited mail. Two-second click; once-only.',
    },
    {
      q: 'Why work email only?',
      a: 'The report is for product teams — it cites your funnel, your CTAs, your conversion path. A personal address can\'t open a conversation about any of that, and gmail floods our spam reputation. Personal addresses are routed to the waitlist instead.',
    },
    {
      q: 'Will you put me on a drip campaign?',
      a: 'No. One confirmation email, one report email, and that\'s it. If you don\'t book a call or write back, you won\'t hear from us again. Every confirmation email has a one-click suppression link too.',
    },
    {
      q: 'What does Zybit actually do beyond this audit?',
      a: 'The audit is the static-crawl part. The full product connects to your analytics (PostHog, Segment, GA4), watches real user sessions, and re-ranks findings based on what actually moves your metrics — a continuous loop instead of a one-shot snapshot.',
    },
    {
      q: 'How accurate are the dollar estimates?',
      a: 'They\'re grounded in your declared (or inferred) MRR/AOV and the funnel stage each finding hits. Treat them as order-of-magnitude, not forecasts. The confidence score on each finding tells you which ones to trust most.',
    },
    {
      q: 'My site is a SPA — will the audit work?',
      a: 'Yes. If the static HTML is empty we fall back to a headless browser render. Some flow-aware findings need real session data and only appear once you connect your analytics.',
    },
    {
      q: 'Will you audit anything?',
      a: 'Almost. Public HTTPS URLs only — no internal IPs, no auth-gated pages, no private hosts. If a site asks us not to crawl them, we honour that. We rate-limit per IP, per email, per email domain, and per target hostname to keep things sane.',
    },
  ];

  return (
    <section
      className="sans-text"
      style={{ marginTop: 80, paddingTop: 40, borderTop: `1px solid ${HAIRLINE}`, maxWidth: 760 }}
    >
      <h2
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: '-0.025em',
          color: INK,
          marginBottom: 24,
        }}
      >
        Common questions.
      </h2>
      <dl style={{ margin: 0 }}>
        {faqs.map((f) => (
          <div key={f.q} style={{ padding: '20px 0', borderTop: `1px solid ${HAIRLINE}` }}>
            <dt style={{ fontSize: 16, fontWeight: 700, color: INK, marginBottom: 8 }}>{f.q}</dt>
            <dd style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: MUTED }}>{f.a}</dd>
          </div>
        ))}
      </dl>

      <p
        style={{
          marginTop: 40,
          fontSize: 12,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        Built by Asad and Jad at Cornell · <Link href="/" style={{ color: MUTED }}>Back to home</Link>
      </p>
    </section>
  );
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { IntakeModal } from '@/components/IntakeModal';
import { PUBLIC_AUDIT_RULE_COUNT, PUBLIC_AUDIT_DEFERRED_RULE_COUNT, TOTAL_AUDIT_RULE_COUNT } from '@/lib/audit/publicAuditRuleCount';
import type { IntakeFinding } from '@/lib/intake/structuralAudit';
import { useAnalytics } from '@/lib/analytics';

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
  { label: `Running ${PUBLIC_AUDIT_RULE_COUNT} friction rules`, ms: 9000 },
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
  const [teaserFinding, setTeaserFinding] = useState<IntakeFinding | null>(null);
  const analytics = useAnalytics();

  // Animate the progress strip while the submit fetch is in-flight.
  // The effect only advances progressIdx — the fetch completion sets the stage.
  useEffect(() => {
    if (stage !== 'running') return;
    let cancelled = false;
    let i = progressIdx;
    const tick = () => {
      if (cancelled || i >= PROGRESS_STEPS.length - 1) return;
      const ms = PROGRESS_STEPS[i].ms;
      i += 1;
      setTimeout(() => {
        if (cancelled) return;
        setProgressIdx(i);
        tick();
      }, ms);
    };
    tick();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const url = normalizeUrl(form.url);
    if (!url) {
      setError('That doesn\'t look like a valid URL. Try acme.com or https://acme.com.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!form.role) {
      setError('Pick a role so we know who we\'re writing to.');
      return;
    }

    const normalizedForm = { ...form, url };
    setForm(normalizedForm);
    setProgressIdx(0);
    setStage('running');
    analytics.auditFormSubmitted({ url, role: form.role });

    try {
      const res = await fetch('/api/audit/public/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, email: form.email, role: form.role }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong. Please try again.');
        setStage('idle');
        setForm(normalizedForm);
        return;
      }

      setTeaserFinding(data.teaserFinding ?? null);
      setStage('teaser');
    } catch {
      setError('Network error. Check your connection and try again.');
      setStage('idle');
      setForm(normalizedForm);
    }
  };

  const reset = () => {
    setStage('idle');
    setForm(EMPTY);
    setProgressIdx(0);
    setError(null);
    setTeaserFinding(null);
  };

  // The confirmation email was already sent during submit.
  // This just advances the UI state.
  const confirmEmail = () => {
    analytics.auditConfirmed();
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
            <TeaserPanel form={form} teaserFinding={teaserFinding} onSendEmail={confirmEmail} />
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
        Give us your URL and we&rsquo;ll run {PUBLIC_AUDIT_RULE_COUNT}{' '}of our {TOTAL_AUDIT_RULE_COUNT}{' '}friction rules against your live site right now.
        You&rsquo;ll get a one-page report by email: ranked findings, the evidence behind each, and what to change.
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
        We send a confirmation link before running anything, so your
        results go only to the inbox that asked for them.
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

      <Field label="Email" htmlFor="audit-email" hint="We send a confirmation link before running anything.">
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
        Keep this tab open. About 45 seconds to go.
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

function TeaserPanel({
  form,
  teaserFinding,
  onSendEmail,
}: {
  form: FormState;
  teaserFinding: IntakeFinding | null;
  onSendEmail: () => void;
}) {
  const host = hostFromUrl(form.url);
  const analytics = useAnalytics();
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
        {teaserFinding ? `Top finding · ${host}` : `Audit complete · ${host}`}
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
        {teaserFinding ? (
          <>
            We found something worth fixing.
            <br />
            Here&rsquo;s the most urgent one.
          </>
        ) : (
          <>
            Audit complete.
            <br />
            Confirm to receive the report.
          </>
        )}
      </h2>
      <p
        className="sans-text"
        style={{ fontSize: 15, lineHeight: 1.55, color: MUTED, marginBottom: 24, maxWidth: 600 }}
      >
        {teaserFinding
          ? 'The full ranked list is in the report, with evidence and suggested changes for each finding. Confirm below and it goes straight to your inbox.'
          : `We ran ${PUBLIC_AUDIT_RULE_COUNT} of our ${TOTAL_AUDIT_RULE_COUNT} friction rules against your homepage. The full report, with priority findings, evidence, and what to change, will arrive in your inbox once you confirm.`}
      </p>

      {teaserFinding && <TeaserCard finding={teaserFinding} />}

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
          A one-click confirmation link is on its way to this address. Click it
          and the full report arrives within the hour.
        </div>
        <button onClick={onSendEmail} className="btn-brutalist" style={{ width: '100%' }}>
          I&rsquo;ve checked my inbox →
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

function TeaserCard({ finding }: { finding: IntakeFinding }) {
  return (
    <div
      className="sans-text"
      style={{
        background: CREAM,
        border: `2px solid ${INK}`,
        boxShadow: `8px 8px 0 ${INK}`,
        maxWidth: 560,
        marginBottom: 4,
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
          F-0001 · {finding.kind}
        </span>
        <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>
          High · {finding.confidence.toFixed(2)}
        </span>
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
          {finding.title}
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
          {finding.evidence}
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
          What to change
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: INK }}>
          {finding.prescription}
        </div>
      </div>
      <div
        style={{
          padding: '14px 18px',
          background: INK,
          color: CREAM,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          opacity: 0.85,
        }}
      >
        Full report includes 3 more findings with evidence and what to change
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
  const analytics = useAnalytics();
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
        Want to walk through the findings once they arrive? Grab 30 minutes
        with the founders. We&rsquo;ll go through them on a screen share and tell
        you straight whether Zybit is a fit for your team.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <a
          href={process.env.NEXT_PUBLIC_BOOK_CALL_URL ?? 'https://calendly.com/asad-getzybit/30min'}
          target="_blank"
          rel="noreferrer"
          className="btn-brutalist"
          onClick={() => analytics.calendlyCtaClicked("audit_teaser")}
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
      { k: String(TOTAL_AUDIT_RULE_COUNT), v: 'friction rules' },
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
      a: 'The form is open to anyone. Without the confirmation step, someone could type your address and we\'d send you an unsolicited report. A quick click in your inbox keeps that from happening.',
    },
    {
      q: 'Will you put me on a drip campaign?',
      a: 'No. One confirmation email, one report email. If you do not book a call or write back, you will not hear from us again. Every email includes an unsubscribe link.',
    },
    {
      q: 'What does Zybit do beyond this audit?',
      a: `The audit runs ${PUBLIC_AUDIT_RULE_COUNT} rules from your HTML right now. The other ${PUBLIC_AUDIT_DEFERRED_RULE_COUNT} rules need your session data to fire: rage-clicks, drop-offs, form abandonment, hesitation, and the patterns you only see in real visitor behaviour. The full product connects to your analytics (PostHog, Segment, GA4) and runs all ${TOTAL_AUDIT_RULE_COUNT} rules continuously.`,
    },
    {
      q: 'How are findings ranked?',
      a: 'Each finding gets a priority score based on confidence, structural severity, and how many pages it affects. The top four are chosen for variety across pages and rule types, so you see the breadth of issues rather than four instances of the same problem.',
    },
    {
      q: 'My site is a single-page app. Will the audit work?',
      a: 'Yes. If the static HTML is thin we fall back to a headless browser render. Some flow-aware findings need real session data and only surface once you connect your analytics.',
    },
    {
      q: 'Will you audit anything?',
      a: 'Almost. Public HTTPS URLs only. No internal IPs, no auth-gated pages, no private hosts. If a site asks us not to crawl it, we respect that. Requests are rate-limited to keep the service fair.',
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

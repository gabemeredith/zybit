"use client";

import React, { useState, useCallback } from "react";

const FOUNDERS_CALENDLY = "https://calendly.com/asad-getzybit/30min";
const FOUNDERS_EMAIL = "sar367@cornell.edu";

type AnalyticsTool = '' | 'posthog' | 'segment' | 'ga4' | 'other';

interface IntakeFormData {
  email: string;
  url: string;
  analytics: AnalyticsTool;
}

const EMPTY_FORM: IntakeFormData = { email: '', url: '', analytics: '' };

export function IntakeModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [formData, setFormData] = useState<IntakeFormData>(EMPTY_FORM);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'Something went wrong.');
        setStatus('error');
        return;
      }

      setStatus('success');
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  };

  const handleClose = useCallback(() => {
    onClose();
    // Reset after animation
    setTimeout(() => {
      setStatus('idle');
      setFormData(EMPTY_FORM);
      setErrorMsg('');
    }, 300);
  }, [onClose]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        animation: 'modalFadeIn 0.3s ease-out',
      }}
    >
      {/* Backdrop */}
      <div
        className="bg-dots"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(10, 10, 8, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '480px',
          background: '#FAFAF8',
          border: '2px solid #111',
          borderRadius: '0',
          padding: '48px',
          boxShadow: '8px 8px 0px rgba(17, 17, 17, 1)',
          animation: 'modalSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            fontSize: '28px',
            color: '#6B6B6B',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
          }}
        >
          ×
        </button>

        {status === 'success' ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div className="sans-text font-bold uppercase tracking-[0.2em]" style={{ fontSize: '48px', marginBottom: '16px' }}>OK</div>
            <h3
              style={{
                fontSize: '24px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                margin: '0 0 16px',
                color: '#111',
                lineHeight: 1.25,
              }}
            >
              Got it.
            </h3>
            <p style={{ fontSize: '15px', color: '#6B6B6B', margin: '0 0 28px', lineHeight: 1.55 }}>
              We review every request personally and onboard each customer 1:1. We&rsquo;ll reach out to set up a call.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', marginBottom: '28px' }}>
              <a
                href={FOUNDERS_CALENDLY}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '14px',
                  color: '#111',
                  textDecoration: 'underline',
                  textUnderlineOffset: '4px',
                }}
              >
                Book 15 minutes with the founders
              </a>
              <a
                href={`mailto:${FOUNDERS_EMAIL}`}
                style={{
                  fontSize: '13px',
                  color: '#6B6B6B',
                  textDecoration: 'underline',
                  textUnderlineOffset: '4px',
                }}
              >
                or email us directly
              </a>
            </div>
            <button
              onClick={handleClose}
              className="btn-brutalist"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="sans-text font-bold uppercase" style={{ color: '#111', fontSize: '12px', marginBottom: '8px', letterSpacing: '0.1em' }}>
              PROVISIONING
            </div>
            <h3
              style={{
                fontSize: '28px',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                margin: '0 0 8px',
                color: '#111',
              }}
            >
              Request Access
            </h3>
            <p style={{ fontSize: '15px', color: '#6B6B6B', margin: '0 0 32px', lineHeight: 1.5 }}>
              Zybit is currently in closed rollout. Request access for your domain below.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label
                  htmlFor="intake-email"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#6B6B6B',
                    marginBottom: '6px',
                    letterSpacing: '0.02em',
                  }}
                >
                  Work email
                </label>
                <input
                  id="intake-email"
                  type="email"
                  required
                  placeholder="jane@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field"
                  style={{ boxSizing: 'border-box', borderRadius: 0, border: '1px solid #111' }}
                />
              </div>

              <div>
                <label
                  htmlFor="intake-url"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#6B6B6B',
                    marginBottom: '6px',
                    letterSpacing: '0.02em',
                  }}
                >
                  Domain
                </label>
                <input
                  id="intake-url"
                  type="url"
                  required
                  placeholder="https://yoursite.com"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="input-field"
                  style={{ boxSizing: 'border-box', borderRadius: 0, border: '1px solid #111' }}
                />
              </div>

              <div>
                <label
                  htmlFor="intake-analytics"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#6B6B6B',
                    marginBottom: '6px',
                    letterSpacing: '0.02em',
                  }}
                >
                  What analytics tool are you using?
                </label>
                <select
                  id="intake-analytics"
                  required
                  value={formData.analytics}
                  onChange={(e) => setFormData({ ...formData, analytics: e.target.value as AnalyticsTool })}
                  className="input-field"
                  style={{
                    boxSizing: 'border-box',
                    borderRadius: 0,
                    border: '1px solid #111',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    backgroundImage:
                      "url(\"data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23111' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 18px center',
                    backgroundSize: '10px 6px',
                    paddingRight: '40px',
                  }}
                >
                  <option value="" disabled>Select one</option>
                  <option value="posthog">PostHog</option>
                  <option value="segment">Segment</option>
                  <option value="ga4">GA4</option>
                  <option value="other">Other / none</option>
                </select>
              </div>

              {status === 'error' && (
                <p style={{ fontSize: '14px', color: '#d32f2f', margin: '0', padding: '8px 12px', background: 'rgba(211,47,47,0.06)' }}>
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="btn-brutalist"
                style={{
                  marginTop: '8px',
                  width: '100%',
                  opacity: status === 'submitting' ? 0.7 : 1,
                  cursor: status === 'submitting' ? 'wait' : 'pointer',
                }}
              >
                {status === 'submitting' ? 'Sending…' : 'Request Access'}
              </button>
            </form>
          </>
        )}
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

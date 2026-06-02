"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAnalytics } from "@/lib/analytics";
import type { Phase1SiteRecord } from "@/lib/phase1";
import {
  createSiteAction,
  createIntegrationAction,
  runFlowPreflightAction,
  saveSiteMetaAction,
} from "@/app/app/onboarding/actions";
import type { PreflightReport } from "@/lib/phase2/flow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;

interface WizardState {
  step: Step;
  siteId: string | null;
  siteDomain: string | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 mb-10">
      {([1, 2, 3] as Step[]).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`w-6 h-6 border-[1.5px] border-[#111] flex items-center justify-center text-[10px] font-bold transition-colors ${
              s < step
                ? "bg-[#111] text-[#FAFAF8]"
                : s === step
                ? "bg-[#111] text-[#FAFAF8]"
                : "bg-white text-[#6B6B6B]"
            }`}
          >
            {s < step ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              s
            )}
          </div>
          {s < 3 && <div className={`w-8 h-px ${s < step ? "bg-[#111]" : "bg-black/[0.1]"}`} />}
        </div>
      ))}
    </div>
  );
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="brut-label mb-2">
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="brut-action inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading && (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

function SkipLink({ onClick, label = "Skip for now" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-[#6B6B6B] hover:text-[#111] transition-colors underline underline-offset-2"
    >
      {label}
    </button>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="brut-label block mb-1.5">
      {label}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="brut-input px-3 py-2.5 text-sm text-[#111] placeholder:text-[#9B9B9B]"
    />
  );
}

// ---------------------------------------------------------------------------
// Step 1: Site URL
// ---------------------------------------------------------------------------

function Step1({
  initialDomain,
  onComplete,
}: {
  initialDomain?: string;
  onComplete: (siteId: string, domain: string) => void;
}) {
  const [domain, setDomain] = useState(initialDomain ?? "");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const analytics = useAnalytics();

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      const result = await createSiteAction(domain, name);
      if (!result.ok) {
        setError(result.error);
      } else {
        analytics.onboardingStepCompleted({ step: 1, siteId: result.site.id });
        onComplete(result.site.id, result.site.domain);
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <StepLabel>Step 1 of 3</StepLabel>
      <h1 className="text-4xl font-bold tracking-tighter text-[#111] mb-2 leading-[0.95]">
        What are we<br />analyzing?
      </h1>
      <p className="text-[#6B6B6B] text-sm mb-8 leading-relaxed max-w-sm">
        Enter your product URL. Zybit will use this to scope all analysis, screenshots, and findings.
      </p>

      <div className="space-y-4 max-w-sm">
        <div>
          <FieldLabel label="Site URL" />
          <Input
            value={domain}
            onChange={setDomain}
            placeholder="yoursite.com"
            autoFocus
          />
        </div>
        <div>
          <FieldLabel label="Site name (optional)" />
          <Input
            value={name}
            onChange={setName}
            placeholder="Acme Corp"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <PrimaryButton
          onClick={handleSubmit}
          loading={loading}
          disabled={!domain.trim()}
        >
          Continue
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Connect analytics + verify the flow graph will be informative
//
// Proxy/DNS setup moved out of the wizard to /app/settings (ProxySetupForm
// with variant="settings") — surfaced when a PM signals deploy intent. See
// docs/sprints/onboarding-redesign.md.
// ---------------------------------------------------------------------------

type AnalyticsProvider = "posthog" | "segment";

function VerificationPanel({
  report,
  onContinue,
  onRecheck,
  rechecking,
}: {
  report: PreflightReport;
  onContinue: () => void;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const tone =
    report.status === "ready"
      ? { bg: "bg-emerald-50", accent: "border-l-4 border-emerald-500", icon: "✅", text: "text-emerald-900" }
      : report.status === "thin"
        ? { bg: "bg-amber-50", accent: "border-l-4 border-amber-300", icon: "⚠️", text: "text-amber-900" }
        : { bg: "bg-rose-50", accent: "border-l-4 border-red-500", icon: "🛑", text: "text-rose-900" };

  const headline =
    report.status === "ready"
      ? `Connected — ${report.signals.distinctSessions} sessions across ${report.signals.distinctRoutes} routes in the last 7 days.`
      : report.status === "thin"
        ? `Connected — but the signal looks thin so far.`
        : `Connected — but we cannot build a flow graph from these events yet.`;

  // De-dupe by code so the same diagnostic is not shown twice.
  const seen = new Set<string>();
  const shownDiagnostics = report.diagnostics.filter((d) => {
    if (seen.has(d.code)) return false;
    seen.add(d.code);
    return d.code !== "ready"; // headline already says this
  });

  return (
    <div className={`mt-6 max-w-sm ${tone.accent} ${tone.bg} p-4`}>
      <div className={`flex items-start gap-2 ${tone.text}`}>
        <span aria-hidden className="text-base leading-none mt-0.5">{tone.icon}</span>
        <p className="text-sm font-semibold leading-snug">{headline}</p>
      </div>
      {shownDiagnostics.length > 0 && (
        <ul className={`mt-3 space-y-2 text-xs ${tone.text}`}>
          {shownDiagnostics.map((d) => (
            <li key={d.code} className="leading-relaxed">{d.message}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-4 mt-4">
        <PrimaryButton onClick={onContinue}>
          {report.status === "ready" ? "Continue" : "Continue anyway"}
        </PrimaryButton>
        <SkipLink onClick={onRecheck} label={rechecking ? "Re-checking…" : "Re-check"} />
      </div>
    </div>
  );
}

function Step2Connect({
  siteId,
  onComplete,
}: {
  siteId: string;
  onComplete: () => void;
}) {
  const [provider, setProvider] = useState<AnalyticsProvider>("posthog");
  const [host, setHost] = useState("https://app.posthog.com");
  const [projectId, setProjectId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [report, setReport] = useState<PreflightReport | null>(null);
  const [verifying, setVerifying] = useState(false);
  const analytics = useAnalytics();

  const segmentWebhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/phase2/integrations/segment-webhook-placeholder`
    : "";

  async function runVerification() {
    setVerifying(true);
    try {
      const result = await runFlowPreflightAction(siteId);
      if (result.ok) setReport(result.report);
      else setError(result.error);
    } finally {
      setVerifying(false);
    }
  }

  async function handleConnect() {
    setError("");
    setLoading(true);
    try {
      const result = await createIntegrationAction({
        siteId,
        provider,
        host: provider === "posthog" ? host : undefined,
        projectId: provider === "posthog" ? projectId : undefined,
        apiKey,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        analytics.onboardingStepCompleted({ step: 2, siteId, provider });
        await runVerification();
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = provider === "posthog"
    ? host.trim() && projectId.trim() && apiKey.trim()
    : apiKey.trim();

  return (
    <div>
      <StepLabel>Step 2 of 3</StepLabel>
      <h1 className="text-4xl font-bold tracking-tighter text-[#111] mb-2 leading-[0.95]">
        Connect your<br />analytics.
      </h1>
      <p className="text-[#6B6B6B] text-sm mb-8 leading-relaxed max-w-sm">
        Zybit reads behavioral data from your analytics provider — no SDK, no install. We will verify the connection before you continue.
      </p>

      {/* Provider tabs */}
      <div className="flex gap-1 mb-6 bg-black/[0.04] p-1 w-fit">
        {(["posthog", "segment"] as AnalyticsProvider[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => { setProvider(p); setError(""); }}
            className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
              provider === p
                ? "bg-white text-[#111] border-[1.5px] border-[#111]"
                : "text-[#6B6B6B] hover:text-[#111]"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="space-y-4 max-w-sm">
        {provider === "posthog" ? (
          <>
            <div>
              <FieldLabel label="PostHog host URL" />
              <Input value={host} onChange={setHost} placeholder="https://app.posthog.com" />
            </div>
            <div>
              <FieldLabel label="Project ID" />
              <Input value={projectId} onChange={setProjectId} placeholder="12345" />
            </div>
            <div>
              <FieldLabel label="Personal API key" />
              <Input value={apiKey} onChange={setApiKey} placeholder="phx_..." type="password" />
              <p className="text-xs text-[#9B9B9B] mt-1">
                Settings → Personal API keys → Create new key (read access required)
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <FieldLabel label="Your Zybit webhook URL" />
              <div className="relative">
                <Input value={segmentWebhookUrl} onChange={() => {}} />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(segmentWebhookUrl)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6B6B] hover:text-[#111] transition-colors"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-[#9B9B9B] mt-1">
                Add this as a webhook destination in Segment
              </p>
            </div>
            <div>
              <FieldLabel label="Webhook bearer token" />
              <Input
                value={apiKey}
                onChange={setApiKey}
                placeholder="Choose a shared secret"
                type="password"
              />
              <p className="text-xs text-[#9B9B9B] mt-1">
                Set the same value in Segment under Authorization header
              </p>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!report && (
          <div className="flex items-center gap-4 pt-1">
            <PrimaryButton onClick={handleConnect} loading={loading || verifying} disabled={!canSubmit}>
              Connect &amp; verify
            </PrimaryButton>
            <SkipLink onClick={onComplete} />
          </div>
        )}
      </div>

      {report && (
        <VerificationPanel
          report={report}
          onContinue={onComplete}
          onRecheck={runVerification}
          rechecking={verifying}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Revenue framing — now skippable
// ---------------------------------------------------------------------------

function Step3Revenue({
  siteId,
  onFinish,
}: {
  siteId: string;
  onFinish: () => void;
}) {
  const [mrr, setMrr] = useState("");
  const [aov, setAov] = useState("");
  const [loading, setLoading] = useState(false);

  const mrrNum = mrr.trim() === "" ? null : parseFloat(mrr);
  const aovNum = aov.trim() === "" ? null : parseFloat(aov);
  const hasValidValue =
    (mrrNum !== null && Number.isFinite(mrrNum) && mrrNum > 0) ||
    (aovNum !== null && Number.isFinite(aovNum) && aovNum > 0);

  const analytics = useAnalytics();

  async function handleFinish(saveNumbers: boolean) {
    setLoading(true);
    try {
      if (saveNumbers && hasValidValue) {
        const mrrCents = mrrNum !== null && mrrNum > 0 ? Math.round(mrrNum * 100) : null;
        const aovCents = aovNum !== null && aovNum > 0 ? Math.round(aovNum * 100) : null;
        await saveSiteMetaAction(siteId, mrrCents, aovCents);
      }
      analytics.onboardingStepCompleted({ step: 3, siteId });
      onFinish();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <StepLabel>Step 3 of 3</StepLabel>
      <h1 className="text-4xl font-bold tracking-tighter text-[#111] mb-2 leading-[0.95]">
        Unlock dollar&#8209;impact<br />findings.
      </h1>
      <p className="text-[#6B6B6B] text-sm mb-2 leading-relaxed max-w-sm">
        When Zybit knows your revenue, every finding gets an estimated impact in dollars — not just severity labels.
      </p>
      <p className="text-xs text-[#9B9B9B] mb-8 max-w-sm">
        Estimates only. Used for prioritization framing, never shared. You can add these later in settings.
      </p>

      <div className="space-y-4 max-w-sm">
        <div>
          <FieldLabel label="Monthly revenue (MRR or GMV)" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B6B6B]">$</span>
            <input
              type="number"
              value={mrr}
              onChange={(e) => setMrr(e.target.value)}
              placeholder="50,000"
              min="0"
              className="brut-input pl-7 pr-3 py-2.5 text-sm text-[#111] placeholder:text-[#9B9B9B]"
            />
          </div>
        </div>
        <div>
          <FieldLabel label="Average order / conversion value" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B6B6B]">$</span>
            <input
              type="number"
              value={aov}
              onChange={(e) => setAov(e.target.value)}
              placeholder="120"
              min="0"
              className="brut-input pl-7 pr-3 py-2.5 text-sm text-[#111] placeholder:text-[#9B9B9B]"
            />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-1">
          <PrimaryButton
            onClick={() => handleFinish(true)}
            loading={loading}
            disabled={!hasValidValue}
          >
            See my flow graph
          </PrimaryButton>
          <SkipLink onClick={() => handleFinish(false)} label="I'll add these later" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard shell
// ---------------------------------------------------------------------------

export default function OnboardingWizard({
  existingSite,
  hasIntegration,
  initialStep = null,
}: {
  existingSite: Phase1SiteRecord | null;
  hasIntegration: boolean;
  initialStep?: Step | null;
}) {
  const router = useRouter();

  // Inferred step from persisted state. Proxy/DNS lives in /app/settings now,
  // so the wizard skips straight from site to analytics.
  let inferredStep: Step;
  if (!existingSite) {
    inferredStep = 1;
  } else if (!hasIntegration) {
    inferredStep = 2;
  } else {
    inferredStep = 3;
  }
  const startStep: Step =
    initialStep && (initialStep === 1 || existingSite) ? initialStep : inferredStep;

  const [state, setState] = useState<WizardState>({
    step: startStep,
    siteId: existingSite?.id ?? null,
    siteDomain: existingSite?.domain ?? null,
  });

  function advance(to: Step, patch?: Partial<WizardState>) {
    setState((prev) => ({ ...prev, step: to, ...patch }));
  }

  function finish() {
    router.push("/app/flow");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-start justify-center pt-20 px-6">
      <div className="w-full max-w-xl">
        <ProgressBar step={state.step} />

        {state.step === 1 && (
          <Step1
            initialDomain={state.siteDomain ?? ""}
            onComplete={(siteId, domain) =>
              advance(2, { siteId, siteDomain: domain })
            }
          />
        )}

        {state.step === 2 && state.siteId && (
          <Step2Connect
            siteId={state.siteId}
            onComplete={() => advance(3)}
          />
        )}

        {state.step === 3 && state.siteId && (
          <Step3Revenue
            siteId={state.siteId}
            onFinish={finish}
          />
        )}
      </div>
    </div>
  );
}

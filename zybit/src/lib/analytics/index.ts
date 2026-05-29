"use client";

import { useMemo } from "react";
import { usePostHog } from "posthog-js/react";

export function useAnalytics() {
  const ph = usePostHog();

  return useMemo(() => ({
    // Auth — no raw email on pre-auth events (PII: anonymous session)
    signInRequested: () =>
      ph?.capture("sign_in_requested"),
    magicLinkSent: () =>
      ph?.capture("magic_link_sent"),
    signInError: (reason: string) =>
      ph?.capture("sign_in_error", { reason }),
    calendlyCtaClicked: (source: string) =>
      ph?.capture("calendly_cta_clicked", { source }),

    // Public audit funnel
    auditFormSubmitted: (props: { url: string; role: string }) =>
      ph?.capture("audit_form_submitted", props),
    auditConfirmed: () =>
      ph?.capture("audit_confirmed"),
    auditReportViewed: (props: { auditId: string; domain: string }) =>
      ph?.capture("audit_report_viewed", props),
    auditCtaClicked: (props: {
      cta: "book_call" | "audit_another";
      auditId?: string;
      source: string;
    }) => ph?.capture("audit_cta_clicked", props),

    // Onboarding
    onboardingStepCompleted: (props: {
      step: number;
      siteId?: string;
      provider?: string;
    }) => ph?.capture("onboarding_step_completed", props),

    // Experiment lifecycle
    experimentLaunched: (props: { experimentId: string; hadOverlap: boolean }) =>
      ph?.capture("experiment_launched", props),
    experimentStopped: (props: { experimentId: string; finalStatus: string }) =>
      ph?.capture("experiment_stopped", props),
    experimentResultsRecorded: (props: {
      experimentId: string;
      liftPct: number;
      confidence: number;
      participants: number;
    }) => ph?.capture("experiment_results_recorded", props),

    // AI Variant Advisor
    aiAdvisorRequested: (props: { findingId: string }) =>
      ph?.capture("ai_advisor_requested", props),
    aiAdvisorResponded: (props: {
      findingId: string;
      proposalCount: number;
      dailyUsed: number;
    }) => ph?.capture("ai_advisor_responded", props),
    aiAdvisorRateLimited: (props: { findingId: string }) =>
      ph?.capture("ai_advisor_rate_limited", props),
    aiAdvisorError: (props: { findingId: string; code?: string }) =>
      ph?.capture("ai_advisor_error", props),
  }), [ph]);
}

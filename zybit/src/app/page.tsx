"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ParticleCanvas } from "@/components/particle-background";

import { IntakeModal } from "@/components/IntakeModal";
import { SiteNav } from "@/components/SiteNav";
import { PUBLIC_AUDIT_RULE_COUNT } from "@/lib/audit/publicAuditRuleCount";

// ---------------------------------------------------------------------------
// Main Application
// ---------------------------------------------------------------------------

function MinimalDOM({ openModal }: { openModal: () => void }) {
  return (
    <div className="w-full text-[#111]">
      {/* Hero: Data Core is compact, text can sit close below */}
      <section className="h-screen w-full flex flex-col justify-end md:justify-center px-6 md:px-24 pb-10 md:pb-0 pointer-events-none">
        <div className="w-full max-w-[700px] bg-[#FAFAF8] p-4 md:bg-transparent md:p-0">
          <div className="sans-text text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4 md:mb-6">
            For product managers
          </div>
          <h1 className="sans-text text-[2.5rem] sm:text-6xl md:text-8xl lg:text-9xl font-bold tracking-tighter mb-4 md:mb-8 leading-[0.9]">
            Clarity over<br />
            intuition.
          </h1>
          <div className="sans-text text-sm sm:text-xl md:text-2xl font-medium text-[#6B6B6B] leading-relaxed md:leading-snug space-y-3 md:space-y-4">
            <p className="text-[#111]">
              Zybit reads how customers move through your product: every click, every drop-off, ranked by revenue impact.
            </p>
            <p>
              Every finding ships with the evidence trail and a dollar estimate. No opinions. No generic checklists.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: DNA — on mobile text starts below the helix */}
      <section className="h-screen w-full flex flex-col pt-[40vh] md:pt-0 md:justify-start md:items-start px-6 md:px-24 pointer-events-none">
        <div className="relative w-full md:max-w-[500px] md:mt-[20vh]">
          {/* Gradient fade — softens the hard bg edge against the particle field on mobile */}
          <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-b from-transparent to-[#FAFAF8] md:hidden" aria-hidden="true" />
          <div className="bg-[#FAFAF8] p-4 md:bg-transparent md:p-0">
            <h2 className="sans-text text-3xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-3 md:mb-6">Friction is already in your data.</h2>
            <div className="sans-text text-sm sm:text-xl md:text-2xl text-[#6B6B6B] leading-relaxed md:leading-snug space-y-3 md:space-y-4">
              <p>Dead-end sessions, rage taps, missed CTAs. The events tell you exactly where customers stall.</p>
              <p className="text-[#111]">Zybit reads the signal and turns it into a ranked, defensible action list.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Jet — text sits below the jet silhouette */}
      <section className="h-screen w-full flex flex-col pt-[40vh] md:pt-0 md:justify-start md:items-end px-6 md:px-24 md:text-right pointer-events-none">
        <div className="relative w-full md:max-w-[500px] md:mt-[20vh]">
          <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-b from-transparent to-[#FAFAF8] md:hidden" aria-hidden="true" />
          <div className="bg-[#FAFAF8] p-4 md:bg-transparent md:p-0">
            <h2 className="sans-text text-3xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-3 md:mb-6">Ship what moves the metric.</h2>
            <div className="sans-text text-sm sm:text-xl md:text-2xl text-[#6B6B6B] leading-relaxed md:leading-snug space-y-3 md:space-y-4">
              <p>Findings are ordered by estimated revenue impact, not severity score or gut feel.</p>
              <p className="text-[#111]">Every prescription carries the evidence trail — defensible in standup, in the roadmap review, in the board deck.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Microchip — text near top, chip rendered below */}
      <section className="h-screen w-full flex flex-col pt-[12vh] md:pt-0 md:justify-start md:items-start px-6 md:px-24 pointer-events-none">
        <div className="relative w-full md:max-w-[500px] md:mt-[15vh]">
          <div className="absolute -top-8 left-0 right-0 h-8 bg-gradient-to-b from-transparent to-[#FAFAF8] md:hidden" aria-hidden="true" />
          <div className="bg-[#FAFAF8] p-4 md:bg-transparent md:p-0">
            <h2 className="sans-text text-3xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-3 md:mb-6">Built on behavior.</h2>
            <div className="sans-text text-sm sm:text-xl md:text-2xl text-[#6B6B6B] leading-relaxed md:leading-snug space-y-3 md:space-y-4">
              <p>
                <span className="text-[#111]">Behavior in.</span> Ranked, explainable priorities out.
              </p>
              <p className="text-[#111]">Your data decides what ships — not opinions, not redesigns, not benchmarks.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 5: Sample Finding — screenshot + receipt card */}
      <section className="min-h-screen w-full flex items-center justify-center px-6 py-16 pointer-events-none bg-[#FAFAF8]">
        <div className="w-full max-w-5xl">
          <div className="sans-text text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-8 md:mb-10 text-center">
            Sample finding
          </div>

          {/* Mobile hero — shows the headline stat before the card */}
          <div className="lg:hidden text-center mb-8">
            <div className="sans-text text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-3">Estimated monthly impact</div>
            <div className="sans-text text-[3.75rem] sm:text-7xl font-black tracking-tighter text-[#111] leading-none">$3.2k</div>
            <div className="sans-text text-sm text-[#6B6B6B] mt-2">found from a single friction point</div>
          </div>

          {/* Two-column on desktop, card-only on mobile */}
          <div className="flex flex-col lg:flex-row items-start gap-8 lg:gap-10">

            {/* Left: product screenshot in browser frame — desktop only */}
            <div className="hidden lg:block w-full lg:flex-1">
              <div
                className="border-2 border-[#111] overflow-hidden"
                style={{ boxShadow: '8px 8px 0px #111' }}
              >
                <div className="bg-[#111] flex items-center gap-1.5 px-4 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-[#3a3a3a]" />
                  <div className="w-2 h-2 rounded-full bg-[#4a4a4a]" />
                  <div className="w-2 h-2 rounded-full bg-[#5a5a5a]" />
                  <div className="ml-3 flex-1 bg-[#1c1c1c] rounded-sm text-[9px] font-mono text-[#555] px-3 py-1 truncate">
                    app.getzybit.com · rage-click-target analysis
                  </div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screenshot-analysis.png"
                  alt="Zybit flagging a rage-click friction point in the product"
                  className="w-full block"
                  width={720}
                  height={450}
                />
              </div>
              <p className="sans-text text-[10px] text-[#6B6B6B] mt-2.5 leading-relaxed">
                Zybit maps rage-click density to the exact element during analysis — before the receipt is issued.
              </p>
            </div>

            {/* Right: receipt card — full width on mobile */}
            <div className="w-full lg:w-[360px] flex-shrink-0">
              <div
                className="sans-text bg-[#FAFAF8] border-2 border-[#111]"
                style={{ boxShadow: '8px 8px 0px #111' }}
              >
                <div className="flex items-center justify-between px-5 py-3.5 border-b-2 border-[#111] text-[10px] font-bold uppercase tracking-[0.18em] text-[#111] gap-3">
                  <span className="truncate">F-0042 · rage-click-target</span>
                  <span className="whitespace-nowrap text-[#6B6B6B] flex-shrink-0">High · 0.84</span>
                </div>
                <div className="px-5 py-5 border-b border-[#111]/15">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6B6B] mb-2">
                    Finding
                  </div>
                  <div className="text-lg md:text-lg font-bold leading-snug tracking-tight text-[#111]">
                    Rage-clicks on checkout promo-code field
                  </div>
                </div>
                <div className="px-5 py-4 border-b border-[#111]/15">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6B6B] mb-2">
                    Evidence · PostHog · 7d
                  </div>
                  <div className="text-base text-[#111] leading-relaxed">
                    <span className="font-bold text-[#111]">847</span> rage-click events on{' '}
                    <span className="font-mono text-[0.85em] bg-black/[0.06] px-1 rounded-sm">#promo-code</span>{' '}
                    over 7 days. Checkout completion 2.1% with field vs 3.4% without.
                  </div>
                </div>
                <div className="px-5 py-4 border-b border-[#111]/15">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6B6B] mb-2">
                    Change
                  </div>
                  <div className="text-base text-[#111] leading-relaxed">
                    Collapse promo-code behind a &ldquo;Have a code?&rdquo; toggle below the primary CTA.
                  </div>
                </div>
                <div className="px-5 py-5 flex items-center justify-between bg-[#111] text-[#FAFAF8]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">
                    Est. impact
                  </div>
                  <div className="text-2xl lg:text-xl font-black tracking-tight">
                    ~$3.2k / month
                  </div>
                </div>
              </div>
              <p className="sans-text text-[10px] text-[#6B6B6B] mt-2.5 leading-relaxed">
                Every finding ships with traceable evidence. No invented numbers.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Section 6: CTA — primary path is Request access (the gated 1:1 motion);
          the free audit is the lower-commitment path that feeds the same queue.
          A single solid backdrop (instead of per-element chiclets) so the type
          breathes against the particle field. */}
      <section className="h-screen w-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-full max-w-2xl bg-[#FAFAF8] px-6 py-8 md:px-8 md:py-10 pointer-events-none">
          <div className="sans-text text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-5">
            Closed rollout · onboarded 1:1
          </div>
          <h2 className="sans-text text-[2rem] sm:text-5xl md:text-7xl font-bold tracking-tighter mb-5 md:mb-6 leading-[0.95]">
            See where your{" "}
            <span className="md:block">funnel leaks.</span>
          </h2>
          <p className="sans-text mb-0 mx-auto text-sm text-[#6B6B6B] md:text-lg leading-relaxed">
            We onboard every customer personally. Request access and we&rsquo;ll reach out to set up a call. Not ready to talk? Run a free audit and see the four highest-impact fixes on your site first &mdash; {PUBLIC_AUDIT_RULE_COUNT} friction rules, evidence, and what to change.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4 mt-8 pointer-events-auto">
          <button onClick={openModal} className="btn-brutalist">
            Request access
          </button>
          <Link
            href="/audit"
            className="sans-text text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6B6B] hover:text-[#111] transition-colors underline underline-offset-4 decoration-[#6B6B6B] hover:decoration-[#111]"
          >
            Or run a free audit &rarr;
          </Link>
        </div>
      </section>

      {/* Footer: founder signature. Kept deliberately. */}
      <footer className="relative z-20 w-full bg-[#FAFAF8] border-t border-black/[0.06] px-6 py-6 text-center pointer-events-none">
        <p className="sans-text text-[10px] md:text-[11px] font-medium uppercase tracking-[0.18em] md:tracking-[0.2em] text-[#6B6B6B]">
          <span className="block md:inline">Built by founders.</span>
          <span className="hidden md:inline"> </span>
          <span className="block md:inline">Every audit is reviewed personally.</span>
        </p>
      </footer>
    </div>
  );
}

// --- Main Application ---

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  return (
    <main className="relative w-full bg-[#FAFAF8] text-[#111]">
      <SiteNav onRequestAccess={openModal} />

      <ParticleCanvas />

      <div className="relative z-10 w-full">
        <MinimalDOM openModal={openModal} />
      </div>

      <IntakeModal isOpen={isModalOpen} onClose={closeModal} />
    </main>
  );
}

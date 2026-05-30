"use client";

import Link from "next/link";

interface WelcomeStateProps {
  domain: string;
  sessionsObserved: number;
  threshold: number;
  siteId: string;
}

function ActionCard({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <Link href={href} className="block group outline-none">
      <div className="h-full bg-white/50 backdrop-blur-sm border border-black/[0.04] rounded-[1.5rem] p-6 lg:p-8 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] group-hover:bg-white group-focus-visible:ring-2 group-focus-visible:ring-[#111]">
        <h3 className="text-lg font-bold tracking-tight text-[#111] mb-2 group-hover:text-black">
          {title}
        </h3>
        <p className="text-sm text-[#6B6B6B] leading-relaxed mb-8 flex-grow">
          {description}
        </p>
        <div className="flex items-center text-sm font-bold text-[#111] tracking-tight">
          <span>{label}</span>
          <svg 
            className="w-4 h-4 ml-1.5 transition-transform duration-300 group-hover:translate-x-1" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

export default function WelcomeState({
  domain,
  sessionsObserved,
  threshold,
  siteId,
}: WelcomeStateProps) {
  const percent = threshold > 0 ? Math.min(100, Math.round((sessionsObserved / threshold) * 100)) : 0;

  return (
    <div className="sans-text w-full max-w-[1200px] mx-auto py-8">
      {/* Progress section */}
      <div className="relative overflow-hidden bg-[#111] text-[#FAFAF8] rounded-[2rem] p-8 md:p-12 lg:p-16 mb-12 shadow-2xl">
        {/* Subtle decorative mesh/gradient in background */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-white/10 to-transparent rounded-full blur-3xl opacity-50 -translate-y-1/2 translate-x-1/3 pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row gap-12 md:gap-8 justify-between items-start md:items-end mb-16">
          <div className="max-w-[500px]">
            <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/50 mb-4">
              Baseline Learning
            </p>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter leading-[1.1] mb-6">
              Analyzing<br />{domain}
            </h2>
            <p className="text-lg text-white/70 leading-relaxed">
              Once the significance threshold is met, Zybit will generate your first ranked product findings based on real user stalls.
            </p>
          </div>

          <div className="text-left md:text-right w-full md:w-auto">
            <div className="text-7xl lg:text-[7rem] font-bold tracking-tighter leading-none tabular-nums">
              {percent}%
            </div>
            <div className="text-sm font-medium text-white/50 mt-2 tracking-wide uppercase">
              {sessionsObserved.toLocaleString()} / {threshold.toLocaleString()} sessions
            </div>
          </div>
        </div>

        {/* Animated Progress bar */}
        <div className="relative z-10 w-full h-2 md:h-3 rounded-full bg-white/10 overflow-hidden backdrop-blur-md">
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-white transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* While you wait */}
      <div>
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#6B6B6B] mb-6 px-2">
          While you wait
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ActionCard
            title="Set revenue context"
            description="Adding your MRR unlocks dollar-impact framing on every finding, so you can prioritize by business value."
            href={`/app/settings?siteId=${siteId}`}
            label="Add revenue data"
          />
          <ActionCard
            title="Invite your team"
            description="Bring in stakeholders so they can review findings, approve experiments, and track impact together."
            href="/app/settings"
            label="Manage team"
          />
          <ActionCard
            title="Add another site"
            description="Connect additional domains to analyze multiple properties from a single workspace."
            href="/app/settings"
            label="Connect a site"
          />
        </div>
      </div>
    </div>
  );
}

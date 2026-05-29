"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface AppShellProps {
  domain: string | null;
  children: React.ReactNode;
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

function FindingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h8M2 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ExperimentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 2v5L2 13h12L10 7V2M6 2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7.5C7 7.5 8 5 11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 8.5C7 8.5 8 11 11 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { label: "Cockpit", href: "/app", icon: <GridIcon /> },
  { label: "Findings", href: "/app/findings", icon: <FindingsIcon /> },
  { label: "Flow", href: "/app/flow", icon: <FlowIcon /> },
  { label: "Experiments", href: "/app/experiments", icon: <ExperimentsIcon /> },
];

const BOTTOM_NAV: NavItem[] = [
  { label: "Settings", href: "/app/settings", icon: <SettingsIcon /> },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2.5 mono-text text-[11px] font-bold uppercase tracking-[0.12em] border-l-2 transition-colors ${
        active
          ? "border-l-white bg-white/[0.08] text-white"
          : "border-l-transparent text-white/45 hover:text-white/85 hover:bg-white/[0.04]"
      }`}
    >
      <span className={active ? "text-white" : "text-white/40"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

export default function AppShell({ domain, children }: AppShellProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8] sans-text overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 flex flex-col bg-[#111] border-r-2 border-[#111]">
        {/* Logo + site */}
        <div className="px-4 pt-5 pb-4 border-b border-white/[0.08]">
          <Link href="/app" className="flex items-center gap-2.5 mb-3">
            <Logo className="w-5 h-5 text-white" />
            <span className="text-white font-bold text-base tracking-tighter">Zybit</span>
          </Link>
          {domain && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-400 shrink-0" />
              <span className="mono-text text-white/45 text-[11px] truncate">{domain}</span>
            </div>
          )}
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>

        {/* Bottom nav */}
        <div className="px-2 pb-4 pt-2 border-t border-white/[0.08] space-y-0.5">
          {BOTTOM_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
          <form action="/api/auth/sign-out" method="post" className="w-full">
            <button
              type="submit"
              className="flex items-center gap-3 w-full px-3 py-2.5 border-l-2 border-l-transparent mono-text text-[11px] font-bold uppercase tracking-[0.12em] text-white/45 hover:text-white/85 hover:bg-white/[0.04] transition-colors"
            >
              <span className="text-white/40">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

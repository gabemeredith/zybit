"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";

const FOUNDERS_CALENDLY = "https://calendly.com/asad-getzybit/30min";

const MOBILE_QUERY = "(max-width: 767px)";
const SCROLL_THRESHOLD = 6;
const HIDE_NAV_THRESHOLD = 48;

// Shared across the landing page and the interactive demo so the nav never
// diverges again. Toned-down: thin bordered chips instead of heavy brutalist
// drop-shadow buttons, tighter padding. On mobile (< md) the bar slides up
// out of view while scrolling down and returns on scroll-up or near the top.
export function SiteNav({ onRequestAccess }: { onRequestAccess: () => void }) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    lastY.current = window.scrollY;

    const handleScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      const isMobile = mql.matches;

      if (!isMobile || y < HIDE_NAV_THRESHOLD) {
        setHidden(false);
      } else if (delta > SCROLL_THRESHOLD) {
        setHidden(true);
      } else if (delta < -SCROLL_THRESHOLD) {
        setHidden(false);
      }
      lastY.current = y;
    };

    // Desktop must always show the bar even if it was hidden on a narrow viewport.
    const handleViewportChange = () => {
      if (!mql.matches) setHidden(false);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    mql.addEventListener("change", handleViewportChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      mql.removeEventListener("change", handleViewportChange);
    };
  }, []);

  const chip =
    "text-[10px] font-bold uppercase tracking-[0.16em] text-[#111] border border-[#111] transition-colors hover:bg-[#111] hover:text-[#FAFAF8]";
  const subtleLink =
    "text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] transition-colors hover:text-[#111]";

  return (
    <header
      className={`fixed top-0 left-0 w-full z-50 pointer-events-auto backdrop-blur-md bg-[rgba(250,250,248,0.85)] border-b border-black/[0.04] transition-transform duration-300 will-change-transform ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      {/* ── Mobile (< 768px): two compact rows ── */}
      <div className="md:hidden">
        <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
          <Link href="/" className="flex items-center gap-2 no-underline">
            <Logo className="w-4 h-4 text-[#111]" />
            <span className="text-[15px] font-bold tracking-tight text-[#111] sans-text">Zybit</span>
          </Link>
          <nav className="flex items-center gap-4 sans-text" aria-label="Secondary">
            <Link href="/sign-in" className={subtleLink}>
              Sign in
            </Link>
            <Link href="/audit" className={subtleLink}>
              Free audit
            </Link>
          </nav>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-2.5 sans-text">
          <a
            href={FOUNDERS_CALENDLY}
            target="_blank"
            rel="noreferrer"
            className={`${chip} py-2 text-center whitespace-nowrap`}
          >
            Founders
          </a>
          <button onClick={onRequestAccess} className={`${chip} py-2 w-full whitespace-nowrap`}>
            Access
          </button>
        </div>
      </div>

      {/* ── Desktop (md+): single row ── */}
      <div className="hidden md:flex items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <Logo className="w-5 h-5 text-[#111]" />
          <span className="text-base font-bold tracking-tight text-[#111] sans-text">Zybit</span>
        </Link>
        <nav className="flex items-center gap-5 sans-text" aria-label="Primary">
          <a
            href={FOUNDERS_CALENDLY}
            target="_blank"
            rel="noreferrer"
            className={`${chip} px-3.5 py-1.5`}
          >
            Talk to founders
          </a>
          <button onClick={onRequestAccess} className={`${chip} px-3.5 py-1.5`}>
            Request Access
          </button>
          <Link href="/sign-in" className={subtleLink}>
            Sign in
          </Link>
          <Link href="/audit" className={subtleLink}>
            Free audit
          </Link>
        </nav>
      </div>
    </header>
  );
}

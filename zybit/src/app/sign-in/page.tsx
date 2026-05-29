"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthParticleCanvas } from "@/components/particle-background";
import { Logo } from "@/components/logo";
import { useAnalytics } from "@/lib/analytics";

function noticeCopy(notice: string | null, error: string | null): string | null {
  if (notice === "pending") {
    return "We haven't approved you yet — we'll be in touch soon.";
  }
  if (notice === "no-account") {
    return "We couldn't find an approved account for that Google email. Request access and we'll set you up.";
  }
  if (error === "google-failed") {
    return "Google sign-in didn't complete. Please try again.";
  }
  if (error === "google-mismatch") {
    return "That email is linked to a different Google account. Sign in with your password instead.";
  }
  if (error === "google-unavailable") {
    return "Google sign-in isn't available right now. Use your email and password instead.";
  }
  return null;
}

function SignInForm() {
  const searchParams = useSearchParams();
  const notice = noticeCopy(searchParams.get("notice"), searchParams.get("error"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const analytics = useAnalytics();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");
    analytics.signInRequested();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Full navigation so the session cookie is picked up by /app's
        // server-side auth gate.
        window.location.assign("/app");
        return;
      }
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? "Invalid email or password.");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Something went wrong.";
      analytics.signInError(reason);
      setErrorMsg(reason);
      setState("error");
    }
  }

  return (
    <>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4">
        Sign in
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-[#111] mb-6">
        Welcome back.
      </h1>

      {notice && (
        <p className="text-sm text-[#111] mb-4 p-3 border border-[#111] bg-[#F4F3EE]">
          {notice}
        </p>
      )}

      <a
        href="/api/auth/google/start"
        className="flex items-center justify-center gap-2.5 w-full border-2 border-[#111] bg-white px-4 py-3 text-[13px] font-bold text-[#111] no-underline transition-colors hover:bg-[#111] hover:text-[#FAFAF8]"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
        </svg>
        Continue with Google
      </a>

      <div className="flex items-center gap-3 my-5">
        <span className="h-px flex-1 bg-[#ddd]" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#aaa]">or</span>
        <span className="h-px flex-1 bg-[#ddd]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          className="w-full border-2 border-[#111] bg-white px-4 py-3 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full border-2 border-[#111] bg-white px-4 py-3 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="w-full btn-brutalist text-[11px] py-3 disabled:opacity-50"
        >
          {state === "loading" ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {state === "error" && (
        <p className="mt-4 text-sm text-red-600">{errorMsg}</p>
      )}

      <p className="mt-6 text-[11px] text-[#6B6B6B] text-center leading-relaxed">
        Not a customer yet?{" "}
        <Link
          href="/"
          className="font-semibold text-[#111] no-underline border-b border-[#111]"
        >
          Request access
        </Link>
        {" · "}
        <Link
          href="/audit"
          className="font-semibold text-[#111] no-underline border-b border-[#111]"
          onClick={() => analytics.calendlyCtaClicked("sign_in")}
        >
          Run a free audit
        </Link>
      </p>
    </>
  );
}

export default function SignInPage() {
  return (
    <div className="relative min-h-screen bg-[#FAFAF8] flex flex-col">
      <AuthParticleCanvas />

      <header className="relative z-50 w-full px-6 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <Logo className="w-5 h-5 text-[#111]" />
          <span className="sans-text text-lg font-bold tracking-tight text-[#111]">Zybit</span>
        </Link>
      </header>

      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div
            className="sans-text bg-[#FFFFFF] border-2 border-[#111] p-8"
            style={{ boxShadow: "8px 8px 0px #111" }}
          >
            <Suspense fallback={null}>
              <SignInForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthParticleCanvas } from "@/components/particle-background";
import { Logo } from "@/components/logo";
import { useAnalytics } from "@/lib/analytics";

function SignInForm() {
  const searchParams = useSearchParams();
  const invalid = searchParams.get("error") === "invalid";

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const analytics = useAnalytics();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");
    analytics.signInRequested(email);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Something went wrong.");
      }
      analytics.magicLinkSent(email);
      setState("sent");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Something went wrong.";
      analytics.signInError(reason);
      setErrorMsg(reason);
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4">
          Check your inbox
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-[#111] mb-3">Link sent.</h1>
        <p className="text-sm text-[#6B6B6B] leading-relaxed">
          We emailed a sign-in link to <strong className="text-[#111]">{email}</strong>.
          It expires in 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4">
        Sign in
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-[#111] mb-6">
        Enter your email.
      </h1>

      {invalid && (
        <p className="text-sm text-red-600 mb-4 p-3 border border-red-200 bg-red-50">
          That sign-in link has expired or already been used. Request a new one below.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full border-2 border-[#111] bg-white px-4 py-3 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="w-full btn-brutalist text-[11px] py-3 disabled:opacity-50"
        >
          {state === "loading" ? "Sending…" : "Send sign-in link"}
        </button>
      </form>

      {state === "error" && (
        <p className="mt-4 text-sm text-red-600">{errorMsg}</p>
      )}

      <p className="mt-6 text-[11px] text-[#6B6B6B] text-center leading-relaxed">
        No account yet?{" "}
        <a
          href="https://calendly.com/asad-getzybit/30min"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-[#111] no-underline border-b border-[#111]"
          onClick={() => analytics.calendlyCtaClicked("sign_in")}
        >
          Book a call with us first.
        </a>
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

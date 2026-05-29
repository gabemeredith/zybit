"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthParticleCanvas } from "@/components/particle-background";
import { Logo } from "@/components/logo";

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[#111] mb-3">Missing link.</h1>
        <p className="text-sm text-[#6B6B6B] leading-relaxed">
          This page needs the secure link from your welcome email. Open that email and click the
          button again.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      setState("error");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords don't match.");
      setState("error");
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        window.location.assign("/app");
        return;
      }
      const data = (await res.json()) as { error?: string };
      setErrorMsg(data.error ?? "Something went wrong.");
      setState("error");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  }

  return (
    <>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B] mb-4">
        You&rsquo;re approved
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-[#111] mb-6">Set your password.</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          className="w-full border-2 border-[#111] bg-white px-4 py-3 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
        />
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
          className="w-full border-2 border-[#111] bg-white px-4 py-3 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="w-full btn-brutalist text-[11px] py-3 disabled:opacity-50"
        >
          {state === "loading" ? "Saving…" : "Set password & sign in"}
        </button>
      </form>

      {state === "error" && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}

      <p className="mt-6 text-[11px] text-[#6B6B6B] text-center leading-relaxed">
        Prefer Google?{" "}
        <a
          href="/api/auth/google/start"
          className="font-semibold text-[#111] no-underline border-b border-[#111]"
        >
          Continue with Google
        </a>
      </p>
    </>
  );
}

export default function SetPasswordPage() {
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
              <SetPasswordForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

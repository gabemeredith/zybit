"use client";

import { useState } from "react";

/**
 * Shared, unstyled-but-themed UI atoms used by the onboarding wizard and the
 * proxy/DNS setup form. Kept in one place so both surfaces stay visually in sync.
 */

export function PrimaryButton({
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
      className="inline-flex items-center gap-2 bg-[#111] text-[#FAFAF8] px-6 py-3 font-bold text-sm uppercase tracking-[0.08em] hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
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

export function SkipLink({
  onClick,
  label = "Skip for now",
}: {
  onClick: () => void;
  label?: string;
}) {
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

export function FieldLabel({ label }: { label: string }) {
  return (
    <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-[#6B6B6B] mb-1.5">
      {label}
    </label>
  );
}

export function Input({
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
      className="w-full border border-black/[0.12] rounded-lg px-3 py-2.5 text-sm text-[#111] placeholder:text-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#111]/20 focus:border-[#111]/30 transition-all"
    />
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="absolute top-3 right-3 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6B6B] hover:text-[#111] transition-colors px-2 py-1 rounded bg-white border border-black/[0.08]"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

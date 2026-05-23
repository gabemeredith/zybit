"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";

type AppUser = {
  id: string;
  email: string;
  organizationId: string;
  role: string;
  status: string;
  createdAt: Date;
};

export default function AdminDashboard({ initialUsers }: { initialUsers: AppUser[] }) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [addState, setAddState] = useState<"idle" | "loading" | "error">("idle");
  const [addError, setAddError] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddState("loading");
    setAddError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, orgName }),
      });
      const data = await res.json() as { error?: string; userId?: string; orgId?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add user.");
      setEmail("");
      setOrgName("");
      setAddState("idle");
      // Refresh list
      const listRes = await fetch("/api/admin/users");
      const listData = await listRes.json() as { users?: AppUser[] };
      if (listData.users) setUsers(listData.users);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add user.");
      setAddState("error");
    }
  }

  async function handleRevoke(userId: string) {
    if (!confirm("Revoke access for this user? Their active sessions will end immediately.")) return;
    await fetch("/api/admin/users/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, status: "revoked" } : u))
    );
  }

  const active = users.filter((u) => u.status === "approved");
  const revoked = users.filter((u) => u.status === "revoked");

  return (
    <div className="min-h-screen bg-[#FAFAF8] sans-text">
      <header className="border-b border-black/[0.08] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="w-5 h-5 text-[#111]" />
          <span className="text-base font-bold tracking-tight text-[#111]">Zybit Admin</span>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href="/admin/ops"
            className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] hover:text-[#111] transition-colors"
          >
            Ops
          </Link>
          <form action="/api/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] hover:text-[#111] transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">

        {/* Add user */}
        <section>
          <h2 className="text-lg font-bold tracking-tight text-[#111] mb-5">Grant access</h2>
          <form
            onSubmit={handleAdd}
            className="border-2 border-[#111] p-6 space-y-4 bg-white"
            style={{ boxShadow: "6px 6px 0px #111" }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@company.com"
                  className="w-full border-2 border-[#111] px-3 py-2.5 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] mb-1.5">
                  Organization name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Inc. (optional)"
                  className="w-full border-2 border-[#111] px-3 py-2.5 text-sm text-[#111] placeholder-[#aaa] outline-none focus:ring-2 focus:ring-[#111]/20"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={addState === "loading"}
              className="btn-brutalist text-[10px] px-5 py-2.5 disabled:opacity-50"
            >
              {addState === "loading" ? "Adding…" : "Add approved user"}
            </button>
            {addState === "error" && (
              <p className="text-sm text-red-600">{addError}</p>
            )}
          </form>
        </section>

        {/* Active users */}
        <section>
          <h2 className="text-lg font-bold tracking-tight text-[#111] mb-4">
            Active users <span className="text-[#6B6B6B] font-normal text-sm">({active.length})</span>
          </h2>
          {active.length === 0 ? (
            <p className="text-sm text-[#6B6B6B]">No active users yet.</p>
          ) : (
            <div className="space-y-2">
              {active.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between border border-black/[0.1] bg-white px-4 py-3 gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#111] truncate">{u.email}</p>
                    <p className="text-[11px] text-[#6B6B6B] font-mono mt-0.5 truncate">
                      {u.organizationId}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(u.id)}
                    className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-600 hover:text-red-800 border border-red-200 px-3 py-1.5 shrink-0 transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Revoked users */}
        {revoked.length > 0 && (
          <section>
            <h2 className="text-lg font-bold tracking-tight text-[#6B6B6B] mb-4">
              Revoked <span className="font-normal text-sm">({revoked.length})</span>
            </h2>
            <div className="space-y-2">
              {revoked.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-4 border border-black/[0.06] bg-[#F5F5F3] px-4 py-3 opacity-60"
                >
                  <p className="text-sm text-[#6B6B6B] truncate">{u.email}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

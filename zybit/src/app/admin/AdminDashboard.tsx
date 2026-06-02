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

type AccessRequest = {
  id: string;
  email: string;
  domain: string | null;
  roleTitle: string | null;
  analyticsTool: string | null;
  source: string;
  status: string;
  stripePaymentLink: string | null;
  requestedAt: Date;
};

export default function AdminDashboard({
  initialUsers,
  initialRequests = [],
}: {
  initialUsers: AppUser[];
  initialRequests?: AccessRequest[];
}) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [requests, setRequests] = useState<AccessRequest[]>(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [addState, setAddState] = useState<"idle" | "loading" | "error">("idle");
  const [addError, setAddError] = useState("");

  async function refreshAll() {
    const [uRes, rRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/access-requests"),
    ]);
    const uData = (await uRes.json()) as { users?: AppUser[] };
    const rData = (await rRes.json()) as { requests?: AccessRequest[] };
    if (uData.users) setUsers(uData.users);
    if (rData.requests) setRequests(rData.requests);
  }

  async function handleQueueAction(
    id: string,
    action: "approve" | "reject" | "save-payment-link",
    extra: { orgName?: string; stripePaymentLink?: string } = {},
  ) {
    if (action === "reject" && !confirm("Reject this access request?")) return;
    setBusyId(id);
    setQueueError("");
    try {
      const res = await fetch("/api/admin/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const data = (await res.json()) as { error?: string; emailSent?: boolean };
      if (!res.ok) throw new Error(data.error ?? "Action failed.");
      if (action === "approve" && data.emailSent === false) {
        setQueueError("User provisioned, but the welcome email failed to send. Resend manually.");
      }
      await refreshAll();
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

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
          <Link
            href="/admin/leads"
            className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] hover:text-[#111] transition-colors"
          >
            Leads
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

        {/* Pending access requests — the single queue (request form + audit) */}
        <PendingQueue
          requests={requests}
          busyId={busyId}
          error={queueError}
          onAction={handleQueueAction}
        />

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

function sourceLabel(source: string): string {
  if (source === "request_form") return "Request form";
  if (source === "public_audit") return "Free audit";
  return source;
}

function PendingQueue({
  requests,
  busyId,
  error,
  onAction,
}: {
  requests: AccessRequest[];
  busyId: string | null;
  error: string;
  onAction: (
    id: string,
    action: "approve" | "reject" | "save-payment-link",
    extra?: { orgName?: string; stripePaymentLink?: string },
  ) => void;
}) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <section>
      <h2 className="text-lg font-bold tracking-tight text-[#111] mb-1">
        Pending requests{" "}
        <span className="text-[#6B6B6B] font-normal text-sm">({pending.length})</span>
      </h2>
      <p className="text-[12px] text-[#6B6B6B] mb-4">
        One queue for the request form and the free audit. Approving mints an org + user and
        emails a set-password link.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {pending.length === 0 ? (
        <p className="text-sm text-[#6B6B6B]">No pending requests.</p>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => (
            <PendingRequestCard key={r.id} req={r} busy={busyId === r.id} onAction={onAction} />
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6B6B6B] mb-2">
            Reviewed ({decided.length})
          </h3>
          <div className="space-y-1.5">
            {decided.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border border-black/[0.06] bg-[#F5F5F3] px-3 py-2 gap-3 text-[12px]"
              >
                <span className="text-[#111] truncate">{r.email}</span>
                <span className="text-[#6B6B6B] uppercase tracking-[0.1em] text-[10px] font-bold shrink-0">
                  {r.status} · {sourceLabel(r.source)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PendingRequestCard({
  req,
  busy,
  onAction,
}: {
  req: AccessRequest;
  busy: boolean;
  onAction: (
    id: string,
    action: "approve" | "reject" | "save-payment-link",
    extra?: { orgName?: string; stripePaymentLink?: string },
  ) => void;
}) {
  const [orgName, setOrgName] = useState(req.domain ?? "");
  const [stripeLink, setStripeLink] = useState(req.stripePaymentLink ?? "");

  return (
    <div className="border-2 border-[#111] bg-white p-4" style={{ boxShadow: "4px 4px 0px #111" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#111] truncate">{req.email}</p>
          <p className="text-[11px] text-[#6B6B6B] mt-0.5 truncate">
            {sourceLabel(req.source)}
            {req.domain ? ` · ${req.domain}` : ""}
            {req.roleTitle ? ` · ${req.roleTitle}` : ""}
            {req.analyticsTool ? ` · ${req.analyticsTool}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <input
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Org name (defaults to domain)"
          className="w-full border border-[#111] px-2.5 py-2 text-[13px] text-[#111] placeholder-[#aaa] outline-none"
        />
        <div className="flex gap-2">
          <input
            type="url"
            value={stripeLink}
            onChange={(e) => setStripeLink(e.target.value)}
            placeholder="Stripe payment link (optional)"
            className="w-full border border-[#111] px-2.5 py-2 text-[13px] text-[#111] placeholder-[#aaa] outline-none"
          />
          <button
            onClick={() => onAction(req.id, "save-payment-link", { stripePaymentLink: stripeLink })}
            disabled={busy}
            className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6B6B] border border-black/[0.2] px-2 shrink-0 hover:text-[#111] disabled:opacity-50"
            title="Save the payment link without approving"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onAction(req.id, "approve", { orgName, stripePaymentLink: stripeLink })}
          disabled={busy}
          className="btn-brutalist text-[10px] px-4 py-2 disabled:opacity-50"
        >
          {busy ? "Working…" : "Approve & invite"}
        </button>
        <button
          onClick={() => onAction(req.id, "reject")}
          disabled={busy}
          className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-600 hover:text-red-800 border border-red-200 px-3 py-2 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

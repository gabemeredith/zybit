/**
 * Tests for saveProxySetupAction — the slug-uniqueness collision path is the
 * one piece of behavior we definitely want covered, per the project constraint.
 *
 * Strategy: mock getDb so we control whether the UPDATE throws a Postgres
 * unique-constraint error (code 23505). Then assert the action returns a
 * suggested alternative slug derived from the existing taken set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks (must be declared before importing the action) -----------

const mockResendSend = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockSelectWhere = vi.hoisted(() => vi.fn());

vi.mock("resend", () => {
  class MockResend {
    emails = { send: mockResendSend };
  }
  return { Resend: MockResend };
});

vi.mock("@/lib/auth/serverAuth", () => ({
  getServerAuth: vi.fn(async () => ({ ok: true, orgId: "org-1" })),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockReturning,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: mockSelectWhere,
      }),
    }),
  }),
}));

process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "founder@example.com";

import { saveProxySetupAction } from "../proxyActions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveProxySetupAction — happy path", () => {
  it("updates the site row, fires the founder alert, returns ok", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "site-1", domain: "acme.com" }]);
    mockResendSend.mockResolvedValueOnce({ data: { id: "msg-1" }, error: null });

    const result = await saveProxySetupAction("site-1", "acme", "experiments.acme.com");

    expect(result).toEqual({ ok: true });
    expect(mockResendSend).toHaveBeenCalledOnce();
    const call = mockResendSend.mock.calls[0][0];
    expect(call.to).toBe("founder@example.com");
    expect(call.subject).toContain("experiments.acme.com");
  });
});

describe("saveProxySetupAction — slug collision", () => {
  it("returns slug_taken with a suggestion derived from the taken set", async () => {
    // Simulate Postgres throwing on unique constraint violation.
    mockReturning.mockRejectedValueOnce({ code: "23505" });
    // pickFreeSlug then SELECTs candidates; only 'acme' is in the taken set, so
    // suggestAlternativeSlug should return 'acme-2'.
    mockSelectWhere.mockResolvedValueOnce([{ proxySlug: "acme" }]);

    const result = await saveProxySetupAction("site-1", "acme", "experiments.acme.com");

    expect(result).toEqual({ ok: false, error: "slug_taken", suggestion: "acme-2" });
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("skips taken alternatives when suggesting", async () => {
    mockReturning.mockRejectedValueOnce({ code: "23505" });
    mockSelectWhere.mockResolvedValueOnce([
      { proxySlug: "acme" },
      { proxySlug: "acme-2" },
      { proxySlug: "acme-3" },
    ]);

    const result = await saveProxySetupAction("site-1", "acme", "experiments.acme.com");

    expect(result).toEqual({ ok: false, error: "slug_taken", suggestion: "acme-4" });
  });
});

describe("saveProxySetupAction — input validation", () => {
  it("rejects an invalid slug before touching the DB", async () => {
    const result = await saveProxySetupAction("site-1", "AB", "experiments.acme.com");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_slug");
    expect(mockReturning).not.toHaveBeenCalled();
  });

  it("rejects a customer subdomain missing a dot", async () => {
    const result = await saveProxySetupAction("site-1", "acme", "experiments");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_slug");
  });
});

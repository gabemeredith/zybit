import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkAuthRateLimit = vi.fn();
const createMagicLink = vi.fn();
const sendEmail = vi.fn();

vi.mock('@/lib/auth/rateLimit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => checkAuthRateLimit(...args),
}));

vi.mock('@/lib/auth/session', () => ({
  createMagicLink: (...args: unknown[]) => createMagicLink(...args),
}));

vi.mock('resend', () => {
  class MockResend {
    emails = { send: (...args: unknown[]) => sendEmail(...args) };
  }
  return { Resend: MockResend };
});

process.env.APP_BASE_URL = 'https://app.example.com';
process.env.RESEND_API_KEY = 'test-resend-key';

import { POST } from '../route';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.com/api/auth/request-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  checkAuthRateLimit.mockReset();
  createMagicLink.mockReset();
  sendEmail.mockReset();
  checkAuthRateLimit.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/request-link', () => {
  it('rejects a body without a string email', async () => {
    const res = await POST(makeRequest({ email: 42 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid email.');
    expect(checkAuthRateLimit).not.toHaveBeenCalled();
  });

  it('rejects an email without an @ character', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-JSON body', async () => {
    const res = await POST(makeRequest('not-json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body.');
  });

  it('returns 429 with Retry-After header when the rate limit is exceeded', async () => {
    checkAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });

    const res = await POST(
      makeRequest({ email: 'foo@example.com' }, { 'x-forwarded-for': '1.2.3.4' }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(createMagicLink).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns generic OK without sending email when the account does not exist (anti-enumeration)', async () => {
    createMagicLink.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ email: 'unknown@example.com' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/sign-in link/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('normalizes the email (trim + lowercase) before rate-limit and token issuance', async () => {
    createMagicLink.mockResolvedValueOnce('magic-123');
    sendEmail.mockResolvedValueOnce({});

    await POST(makeRequest({ email: '  Foo@Example.COM  ' }));

    expect(checkAuthRateLimit).toHaveBeenCalledWith('foo@example.com', expect.any(String));
    expect(createMagicLink).toHaveBeenCalledWith('foo@example.com');
  });

  it('sends the magic link email and returns the generic OK envelope on success', async () => {
    createMagicLink.mockResolvedValueOnce('magic-token-xyz');
    sendEmail.mockResolvedValueOnce({});

    const res = await POST(makeRequest({ email: 'real@example.com' }));

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0] as { to: string; html: string };
    expect(call.to).toBe('real@example.com');
    expect(call.html).toContain('magic-token-xyz');
  });

  it('still returns 200 OK when the email provider throws, and logs the failure server-side', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createMagicLink.mockResolvedValueOnce('magic-token-xyz');
    sendEmail.mockRejectedValueOnce(new Error('resend down'));

    const res = await POST(makeRequest({ email: 'real@example.com' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/sign-in link/);
    expect(consoleSpy).toHaveBeenCalled();
    const firstArg = consoleSpy.mock.calls[0]?.[0];
    expect(String(firstArg)).toContain('auth/request-link');
    consoleSpy.mockRestore();
  });

  it('uses the leftmost address from x-forwarded-for for IP-based rate limiting', async () => {
    createMagicLink.mockResolvedValueOnce(null);

    await POST(
      makeRequest(
        { email: 'foo@example.com' },
        { 'x-forwarded-for': '203.0.113.1, 10.0.0.1, 10.0.0.2' },
      ),
    );

    expect(checkAuthRateLimit).toHaveBeenCalledWith('foo@example.com', '203.0.113.1');
  });
});

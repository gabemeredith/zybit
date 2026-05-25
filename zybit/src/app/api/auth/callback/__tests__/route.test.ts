import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const consumeMagicLink = vi.fn();

vi.mock('@/lib/auth/session', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    consumeMagicLink: (...args: unknown[]) => consumeMagicLink(...args),
  };
});

import { GET } from '../route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(new Request(url));
}

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    consumeMagicLink.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /sign-in?error=invalid when token query param is missing', async () => {
    const res = await GET(makeRequest('https://app.example.com/api/auth/callback'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/sign-in?error=invalid');
    expect(consumeMagicLink).not.toHaveBeenCalled();
  });

  it('redirects to /sign-in?error=invalid when the token is expired or unknown', async () => {
    consumeMagicLink.mockResolvedValueOnce(null);

    const res = await GET(
      makeRequest('https://app.example.com/api/auth/callback?token=deadbeef'),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/sign-in?error=invalid');
    expect(consumeMagicLink).toHaveBeenCalledWith('deadbeef');
  });

  it('sets the session cookie and redirects to /app on a valid token', async () => {
    consumeMagicLink.mockResolvedValueOnce('session-token-abc');

    const res = await GET(
      makeRequest('https://app.example.com/api/auth/callback?token=valid-token'),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/app');

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('zb_session=session-token-abc');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
  });
});

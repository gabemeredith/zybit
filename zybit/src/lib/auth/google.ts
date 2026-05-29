// Hand-rolled Google OAuth 2.0 authorization-code flow. Deliberately small —
// keeps the owned session model (authSessions + zb_session) instead of pulling
// in Auth.js/Better Auth, which would replace it. See the "auth is owned"
// doctrine in AGENTS.md.
//
// Two endpoints consume this: /api/auth/google/start (redirect to Google) and
// /api/auth/google/callback (verify state, exchange code, fetch userinfo).

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const OAUTH_STATE_COOKIE = 'zb_oauth_state';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUrl = process.env.GOOGLE_OAUTH_REDIRECT_URL;
  if (!clientId || !clientSecret || !redirectUrl) return null;
  return { clientId, clientSecret, redirectUrl };
}

export function buildGoogleAuthUrl(config: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Exchange an authorization code for an access token. Returns null on failure. */
export async function exchangeGoogleCode(
  config: GoogleConfig,
  code: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUrl,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

/** Fetch the OIDC userinfo for an access token. Returns null on failure. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!json.sub || !json.email) return null;
  return {
    sub: json.sub,
    email: json.email.trim().toLowerCase(),
    emailVerified: json.email_verified === true,
    name: json.name,
  };
}

import { NextResponse } from 'next/server';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

type OrgIdentityMode = 'dev' | 'header_required';

export function success<T>(data: T, status = 200): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function badRequest(message: string, code = 'BAD_REQUEST'): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status: 400 }
  );
}

export function unauthorized(
  message: string,
  code = 'UNAUTHORIZED'
): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status: 401 }
  );
}

export function forbidden(
  message: string,
  code = 'FORBIDDEN'
): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status: 403 }
  );
}

export function planLimitExceeded(
  resource: string,
  detail: { current: number; limit: number; plan: string }
): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `Your ${detail.plan} plan allows ${detail.limit} ${resource} (currently ${detail.current}). Upgrade to add more.`,
      },
    },
    { status: 402 }
  );
}

export function freeExperimentUsed(): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'FREE_EXPERIMENT_USED',
        message: 'Your free experiment has been used. Upgrade to launch more.',
      },
    },
    { status: 402 }
  );
}

export function serverError(message = 'Internal server error.'): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    },
    { status: 500 }
  );
}

export function mapRouteError(error: unknown): NextResponse<ApiEnvelope<never>> {
  if (error instanceof Error) {
    return serverError(error.message);
  }
  return serverError();
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getDefaultOrgId(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? 'org_default';
}

function getOrgIdentityMode(): OrgIdentityMode {
  const raw = (process.env.PHASE1_ORG_IDENTITY_MODE ?? 'dev').toLowerCase();
  return raw === 'header_required' ? 'header_required' : 'dev';
}

export function resolveOrganizationContext(
  request: Request,
  options?: {
    bodyOrganizationId?: unknown;
    allowQueryFallback?: boolean;
    fallbackOrganizationId?: string;
  }
): { ok: true; organizationId: string } | { ok: false; response: NextResponse<ApiEnvelope<never>> } {
  const mode = getOrgIdentityMode();
  const url = new URL(request.url);
  const headerOrgId = parseOptionalString(request.headers.get('x-org-id'));
  if (headerOrgId) return { ok: true, organizationId: headerOrgId };

  if (mode === 'header_required') {
    return {
      ok: false,
      response: unauthorized(
        'Missing organization context. Send x-org-id header.',
        'MISSING_ORG_CONTEXT'
      ),
    };
  }

  const allowQueryFallback = options?.allowQueryFallback ?? true;
  if (allowQueryFallback) {
    const queryOrgId = parseOptionalString(url.searchParams.get('organizationId'));
    if (queryOrgId) return { ok: true, organizationId: queryOrgId };
  }

  const bodyOrgId = parseOptionalString(options?.bodyOrganizationId);
  if (bodyOrgId) return { ok: true, organizationId: bodyOrgId };

  return {
    ok: true,
    organizationId: options?.fallbackOrganizationId ?? getDefaultOrgId(),
  };
}

export function parsePositiveInt(
  value: string | null,
  defaultValue: number,
  max = 500
): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

export async function parseJsonObject(
  request: Request
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const parsed = await request.json();
    const object = asObject(parsed);
    if (!object) {
      return { ok: false, message: 'Request body must be a JSON object.' };
    }
    return { ok: true, value: object };
  } catch {
    return { ok: false, message: 'Request body must be valid JSON.' };
  }
}

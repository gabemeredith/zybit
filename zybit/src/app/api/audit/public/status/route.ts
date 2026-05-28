import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  AUDIT_CONFIRMED_COOKIE,
  verifyAuditCookie,
} from '@/lib/audit/cookies';

// Mirror of run/route.ts maxDuration. A 'running' audit older than this could
// not still be in-flight on the same invocation, so it is safe to assume the
// after() dispatch died and lazy-flip the row to 'failed' on read.
const RUN_MAX_DURATION_MS = 5 * 60 * 1000;

type AuditStatusRow = {
  id: string;
  email: string;
  status: string;
  domain: string;
  confirmed_at: string | null;
  completed_at: string | null;
  error: string | null;
  findings: unknown;
};

// Mirrors the trimmed finding shape rendered by /audit/[id] — title +
// severity + the human-readable summary. Anything richer (full evidence,
// internal scores) stays server-side. `screenshotBefore/AfterUrl` and
// `fixPreviewTier` come from `generateFixPreviews` (lib/audit/fixPreview)
// and let the audit page render the before/after swipe inline.
type PublicFinding = {
  title: string;
  severity: string;
  whyItMatters?: string;
  screenshotBeforeUrl?: string;
  screenshotAfterUrl?: string;
  fixPreviewTier?: 1 | 2 | 3;
  fixRationale?: string;
};

export type PublicBrandDna = {
  primaryColor: string | null;
  secondaryColor: string | null;
  typeScale: number[] | null;
  cssSystem: string | null;
  ctaVocabulary: string[];
};

// Findings are stored in two formats:
//   v1 (legacy): bare array of finding objects
//   v2 (current): { v: 2, items: [...], brandDna: {...} | null }
// Both formats are supported so old audit rows keep working.
function unpackFindings(raw: unknown): { items: unknown[]; brandDna: PublicBrandDna | null } {
  if (Array.isArray(raw)) return { items: raw, brandDna: null };
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).v === 2) {
    const r = raw as Record<string, unknown>;
    const items = Array.isArray(r.items) ? r.items : [];
    const bd = r.brandDna && typeof r.brandDna === 'object' ? (r.brandDna as Record<string, unknown>) : null;
    const brandDna: PublicBrandDna | null = bd
      ? {
          primaryColor: typeof bd.primaryColor === 'string' ? bd.primaryColor : null,
          secondaryColor: typeof bd.secondaryColor === 'string' ? bd.secondaryColor : null,
          typeScale: Array.isArray(bd.typeScale) ? (bd.typeScale as number[]) : null,
          cssSystem: typeof bd.cssSystem === 'string' ? bd.cssSystem : null,
          ctaVocabulary: Array.isArray(bd.ctaVocabulary) ? (bd.ctaVocabulary as string[]) : [],
        }
      : null;
    return { items, brandDna };
  }
  return { items: [], brandDna: null };
}

function pickPublicFindings(items: unknown[]): PublicFinding[] {
  return items.slice(0, 2).map((f) => {
    const r = (f ?? {}) as Record<string, unknown>;
    const out: PublicFinding = {
      title: typeof r.title === 'string' ? r.title : 'Finding',
      severity: typeof r.severity === 'string' ? r.severity : 'medium',
    };
    if (typeof r.whyItMatters === 'string') out.whyItMatters = r.whyItMatters;
    if (typeof r.screenshotBeforeUrl === 'string') {
      out.screenshotBeforeUrl = r.screenshotBeforeUrl;
    }
    if (typeof r.screenshotAfterUrl === 'string') {
      out.screenshotAfterUrl = r.screenshotAfterUrl;
    }
    if (r.fixPreviewTier === 1 || r.fixPreviewTier === 2 || r.fixPreviewTier === 3) {
      out.fixPreviewTier = r.fixPreviewTier;
    }
    if (typeof r.fixRationale === 'string') out.fixRationale = r.fixRationale;
    return out;
  });
}

// Don't pipe raw pipeline error strings to the browser — they can contain
// provider names, request IDs, stack fragments, or partial credentials. Keep
// the raw text in the DB for operators (read via `/admin/ops` or psql) and
// return a small bounded set of user-friendly categories instead.
function userFacingError(status: string, raw: string | null): string | null {
  if (status === 'unreachable') {
    return 'No pages could be crawled — likely bot protection, robots.txt, or JS-only navigation.';
  }
  if (status !== 'failed') return null;
  if (!raw) return 'The audit pipeline encountered an error.';

  const lower = raw.toLowerCase();
  if (lower.includes('url re-validation failed')) {
    return 'The site\'s DNS changed between submission and run. Please try again.';
  }
  if (lower.includes('report email failed')) {
    return 'The audit finished but the report email failed to send. We\'ll resend it shortly.';
  }
  if (lower.includes('daily audit capacity')) {
    return 'Daily audit capacity is full. Please try again tomorrow.';
  }
  return 'The audit pipeline encountered an error. Email us if it keeps happening.';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^pub_[0-9a-f]{24}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  }

  const db = getDb();
  const result = await db.execute<AuditStatusRow>(sql`
    SELECT id, email, status, domain, confirmed_at, completed_at, error, findings
    FROM public_audits WHERE id = ${id} LIMIT 1
  `);

  const row = result.rows[0] as AuditStatusRow | undefined;
  if (!row) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Lazy recovery: if the row has been stuck in 'running' past the run
  // route's maxDuration, the after() dispatch in /confirm almost certainly
  // died (cold-start race, function killed, or run route 5xx that was
  // silently swallowed). Flip to 'failed' on read so the poller stops
  // spinning and the user sees a real error.
  let status = row.status;
  let error = row.error;
  if (status === 'running' && row.confirmed_at) {
    const startedAt = new Date(row.confirmed_at).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt > RUN_MAX_DURATION_MS) {
      await db.execute(sql`
        UPDATE public_audits
        SET status = 'failed',
            error = ${'Pipeline dispatch timed out — audit did not complete within the run window.'},
            completed_at = now()
        WHERE id = ${id} AND status = 'running'
      `);
      status = 'failed';
      error = 'Pipeline dispatch timed out — audit did not complete within the run window.';
    }
  }

  // Cookie gate: findings bodies are only returned to the user who actually
  // confirmed their audit. Forwarding /audit/[id] to a teammate gives them
  // the "ready" state but no finding text. The /admin/ops view + the
  // operator can still read raw rows directly from the DB.
  const cookieValue = req.cookies.get(AUDIT_CONFIRMED_COOKIE)?.value;
  const confirmed = verifyAuditCookie(cookieValue, id);

  let findings: PublicFinding[] | null = null;
  let brandDna: PublicBrandDna | null = null;
  if (confirmed && status === 'done') {
    const unpacked = unpackFindings(row.findings);
    findings = pickPublicFindings(unpacked.items);
    brandDna = unpacked.brandDna;
  }

  return NextResponse.json({
    id: row.id,
    status,
    domain: row.domain,
    completedAt: row.completed_at ?? null,
    error: userFacingError(status, error),
    findings,
    brandDna,
  });
}

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { verifyAdminCookie, ADMIN_COOKIE } from '@/lib/auth/adminSession';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

type LeadRow = {
  id: string;
  email: string;
  domain: string;
  role: string;
  status: string;
  submitted_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  industry: string | null;
  role_title: string | null;
  provisioned: boolean;
};

function badge(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    pending:     { bg: '#FEF3C7', color: '#92400E' },
    running:     { bg: '#DBEAFE', color: '#1E40AF' },
    done:        { bg: '#D1FAE5', color: '#065F46' },
    failed:      { bg: '#FEE2E2', color: '#991B1B' },
    unreachable: { bg: '#F3F4F6', color: '#374151' },
  };
  const s = map[status] ?? { bg: '#F3F4F6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    }}>
      {status}
    </span>
  );
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' UTC';
}

export default async function LeadsPage() {
  const cookieStore = await cookies();
  if (!verifyAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect('/admin/login');
  }

  const db = getDb();

  // Join public_audits with app_users via source_audit_id to get enriched
  // profile data (industry, role_title) alongside the raw submission fields.
  const result = await db.execute<LeadRow>(sql`
    SELECT
      pa.id,
      pa.email,
      pa.domain,
      pa.role,
      pa.status,
      pa.submitted_at,
      pa.confirmed_at,
      pa.completed_at,
      au.industry,
      au.role_title,
      (au.id IS NOT NULL) AS provisioned
    FROM public_audits pa
    LEFT JOIN app_users au ON au.source_audit_id = pa.id
    ORDER BY pa.submitted_at DESC
    LIMIT 200
  `);

  const leads = result.rows as LeadRow[];

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '1px solid #E5E7EB',
    fontSize: 13,
    color: '#111827',
    verticalAlign: 'top',
  };
  const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '2px solid #E5E7EB',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#6B7280',
    textAlign: 'left',
    background: '#F9FAFB',
    whiteSpace: 'nowrap',
  };

  const done = leads.filter(l => l.status === 'done').length;
  const provisioned = leads.filter(l => l.provisioned).length;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-4 flex items-center gap-3 text-xs text-zinc-500">
          <Link href="/admin" className="hover:text-zinc-900">← Admin</Link>
          <span>/</span>
          <span className="text-zinc-700">Leads</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>
            Public audit leads
          </h1>
          <span style={{ fontSize: 13, color: '#6B7280' }}>
            {leads.length} total · {done} completed · {provisioned} provisioned
          </span>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Domain</th>
                  <th style={thStyle}>Form role</th>
                  <th style={thStyle}>Industry</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Submitted</th>
                  <th style={thStyle}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, color: '#9CA3AF', textAlign: 'center', padding: 32 }}>
                      No audit submissions yet.
                    </td>
                  </tr>
                )}
                {leads.map(lead => (
                  <tr key={lead.id} style={{ background: lead.status === 'done' ? '#fff' : '#FAFAFA' }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 500 }}>{lead.email}</span>
                      {!lead.provisioned && (
                        <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                          not provisioned
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>{lead.domain}</td>
                    <td style={tdStyle}>
                      {/* role_title is populated post-confirm; fall back to
                          the raw form value from public_audits.role */}
                      {lead.role_title ?? lead.role ?? '—'}
                    </td>
                    <td style={tdStyle}>{lead.industry ?? '—'}</td>
                    <td style={tdStyle}>{badge(lead.status)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#6B7280', fontSize: 12 }}>
                      {fmt(lead.submitted_at)}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#6B7280', fontSize: 12 }}>
                      {fmt(lead.completed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ marginTop: 12, fontSize: 12, color: '#9CA3AF' }}>
          Showing latest 200. Industry and role_title populate after the audit pipeline completes.
        </p>
      </div>
    </div>
  );
}

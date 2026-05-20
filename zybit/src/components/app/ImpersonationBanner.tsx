/**
 * Amber bar that renders above /app/* page content when the current
 * session belongs to a Lighthouse-synthetic organization (orgId prefix
 * `lighthouse_org_`).
 *
 * The Lighthouse harness mints a real zb_session for a fake app_users
 * row so the operator can walk the PM dashboard with synthetic data.
 * Without this banner there is nothing in /app/* to distinguish that
 * state from a real customer view, which is dangerous if anyone ever
 * confuses the two (especially if the synthetic org is sharing a DB
 * with real customers).
 *
 * Server component on purpose: no client JS, no flicker.
 */

const LIGHTHOUSE_ORG_PREFIX = 'lighthouse_org_';

interface ImpersonationBannerProps {
  orgId: string;
}

export default function ImpersonationBanner({ orgId }: ImpersonationBannerProps) {
  if (!orgId.startsWith(LIGHTHOUSE_ORG_PREFIX)) return null;

  return (
    <div
      role="status"
      style={{
        background: '#fef3c7',
        color: '#78350f',
        borderBottom: '1px solid #fcd34d',
        padding: '0.55rem 1rem',
        fontSize: '0.85rem',
        lineHeight: 1.4,
        textAlign: 'center',
      }}
    >
      <strong>Synthetic Lighthouse PM view</strong> ({orgId}) — generated data, not a real customer.
    </div>
  );
}

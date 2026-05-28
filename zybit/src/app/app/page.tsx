import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/auth/serverAuth";
import { createPhase1Repository } from "@/lib/phase1";
import Link from "next/link";
import { getCockpitData } from "@/lib/dashboard/cockpit";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import CockpitView from "@/components/app/CockpitView";

const INK = '#111';
const CREAM = '#FAFAF8';
const MUTED = '#6B6B6B';

export default async function CockpitPage() {
  const authResult = await getServerAuth();
  if (!authResult.ok) redirect("/sign-in");

  if (authResult.orgId === DEMO_ORG_ID) {
    const data = await getCockpitData(authResult.orgId);
    return <CockpitView data={data} orgId={authResult.orgId} />;
  }

  const repository = createPhase1Repository();
  const sites = await repository.listSites({ organizationId: authResult.orgId, limit: 1 });
  const domain = sites[0]?.domain ?? null;

  const bookCallUrl = process.env.NEXT_PUBLIC_BOOK_CALL_URL ?? 'https://calendly.com/asad-getzybit/30min';

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif',
      }}
    >
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 16,
          }}
        >
          Zybit · Early access{domain ? ` · ${domain}` : ''}
        </div>

        <h1
          style={{
            margin: '0 0 16px',
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: '-0.025em',
            lineHeight: 1.1,
            color: INK,
          }}
        >
          Your audit results are in your inbox.
        </h1>

        <p style={{ margin: '0 0 32px', fontSize: 15, lineHeight: 1.65, color: INK }}>
          We ran {domain ? (
            <strong>{domain}</strong>
          ) : (
            'your site'
          )} through our full friction analysis. The report — findings, evidence,
          and fix previews — is in the email you confirmed with.
        </p>

        <p style={{ margin: '0 0 24px', fontSize: 15, lineHeight: 1.65, color: INK }}>
          The best next step is a 30-minute call with us. We&rsquo;ll walk through what we found,
          answer your questions, and tell you straight whether Zybit fits your team.
          No pitch deck.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <a
            href={bookCallUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-block',
              padding: '13px 28px',
              background: INK,
              color: CREAM,
              border: `1px solid ${INK}`,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              boxShadow: `4px 4px 0 ${INK}`,
            }}
          >
            Book 30 min →
          </a>
          <Link
            href="/audit"
            style={{
              display: 'inline-block',
              padding: '13px 20px',
              background: 'transparent',
              color: MUTED,
              textDecoration: 'underline',
              fontSize: 13,
              letterSpacing: '0.05em',
            }}
          >
            Audit another site
          </Link>
        </div>

        <p style={{ margin: '28px 0 0', fontSize: 12, lineHeight: 1.5, color: MUTED }}>
          The full Zybit platform — continuous monitoring, flow-level analytics, and A/B
          testing — is coming to early-access customers soon. We&rsquo;ll be in touch.
        </p>
      </div>
    </div>
  );
}

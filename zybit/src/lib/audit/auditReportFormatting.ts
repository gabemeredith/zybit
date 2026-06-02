/**
 * Formatting helpers shared between the production audit-run route and
 * the operator-side `resend-audit-report.ts` script. Both render the same
 * email; both must agree on the severity bucket boundaries and the
 * generated-at timestamp format. Duplicating these in two places caused
 * a real drift bug (resend showed "low" for findings the original email
 * showed as "medium") — keep them here.
 */

export function severityFromScore(priorityScore: number): 'high' | 'medium' | 'low' {
  if (priorityScore >= 0.6) return 'high';
  if (priorityScore >= 0.3) return 'medium';
  return 'low';
}

export function formatAuditDate(d: Date): string {
  return (
    d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    }) + ' ET'
  );
}

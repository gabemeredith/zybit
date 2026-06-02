/**
 * Defense-in-depth scrub for public-audit findings.
 *
 * The primary legitimacy guarantee on public audits comes from the
 * `AuditMode = 'public-audit'` orchestrator in `runAuditRules` — rules
 * without a declared `publicAuditBehavior` emit nothing, and rules declared
 * `'structural-only'` get their findings rewritten in-place before
 * persistence. This module is the second line: it strips findings whose
 * evidence still mentions `(unnamed button)` or `(unnamed CTA)` after
 * everything upstream had a chance to bail.
 *
 * Both surfaces that emit findings on the public-audit path import this:
 *   - `/api/audit/public/run` (the prospect-facing HTTP route)
 *   - `runUrlAudit` (the lighthouse runner used internally + by the route)
 *
 * Keeping the policy here — not inlined in either surface — closes
 * handover §13.3 (lighthouse runner used to bypass the scrub).
 */

import type { AuditFinding, AuditFindingEvidence } from '@/lib/phase2/rules/types';

const FORBIDDEN_SUBSTRINGS = ['(unnamed button)', '(unnamed CTA)'];

/**
 * `true` when the finding's title/summary/evidence contains a string the
 * prospect surface should never render. Used both to filter the
 * persisted-findings list and as the predicate behind any debug surface
 * that wants to count fabrications-prevented.
 */
export function isFabricatedFinding(finding: AuditFinding): boolean {
  const haystack = [
    finding.title,
    finding.summary,
    ...(finding.evidence ?? []).map((e: AuditFindingEvidence) => `${e.label}: ${e.value}`),
  ].join(' ');
  return FORBIDDEN_SUBSTRINGS.some((needle) => haystack.includes(needle));
}

/**
 * Returns the findings list with any fabricated-evidence findings removed.
 * Pure — does not mutate input.
 */
export function applyDefenseInDepthScrub(findings: AuditFinding[]): AuditFinding[] {
  return findings.filter((f) => !isFabricatedFinding(f));
}

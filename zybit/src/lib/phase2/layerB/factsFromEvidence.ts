/**
 * Derive a Layer B `factsJson` blob from a finding's already-structured
 * fields, for rules not yet converted to the Layer A/B contract.
 *
 * The insight: a finding's `evidence` rows ARE its structured facts — each is
 * a `{label, value}` pair the deterministic rule computed, and the
 * `impactEstimate` carries the headline number. So any finding can be made
 * Layer-B-eligible without hand-writing a `factsJson` first. This is what
 * powers Lighthouse "Compare mode" (LLM vs template across the whole audit)
 * before Step 5 converts each rule individually.
 *
 * Pure + deterministic: same finding in, same facts out. The numeric-grounding
 * verifier (`verifyOutputAgainstFacts`) reads numbers out of these values —
 * including numbers embedded in string values like "22.3%" — so the wedge
 * (every number a PM sees is grounded) holds for derived facts too.
 */

import type { AuditFinding } from '@/lib/phase2/rules/types';

/** "Thrash rate" -> "thrashRate"; "Bounce rate" -> "bounceRate". */
function keyForLabel(label: string): string {
  const words = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

export function factsFromEvidence(finding: AuditFinding): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  if (finding.pathRef) facts.pathRef = finding.pathRef;

  for (const row of finding.evidence ?? []) {
    if (!row?.label) continue;
    const key = keyForLabel(row.label);
    if (!key || key in facts) continue;
    facts[key] = row.value;
  }

  if (finding.impactEstimate) {
    // The headline number + its unit, as a number so grounding sees it.
    facts.impact = {
      value: finding.impactEstimate.value,
      unit: finding.impactEstimate.unit,
      period: finding.impactEstimate.period,
    };
  }

  return facts;
}

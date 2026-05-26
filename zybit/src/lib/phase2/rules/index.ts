/**
 * Phase 2 — Audit rules barrel.
 *
 * Three layers live here:
 *   - **Design rules** (Layer C): hierarchy/fold/nav/asymmetry findings
 *     grounded in page snapshots + click distribution.
 *   - **Pain rules**   (Layer D): abandonment / help-seeking / hesitation /
 *     bounce / error / thrash / cohort-pain findings grounded in session
 *     traces + structured PostHog signals.
 *   - **Structural rules** (Layer E): accessibility + SEO findings grounded
 *     entirely in snapshot data — no behavioral events required. These fire
 *     on every site from the first snapshot, even before PostHog data exists.
 *
 * Each rule is a pure `AuditRule` that consumes a `AuditRuleContext` and
 * returns zero or more `AuditFinding`s. `runAuditRules` is the orchestration
 * helper the route handler uses; it isolates per-rule errors so a thrown
 * exception in one rule never prevents the others from contributing.
 */

import type {
  AuditFinding,
  AuditFindingSeverity,
  AuditFindingsReport,
  AuditRule,
  AuditRuleContext,
  AuditRuleDiagnostic,
} from "./types";

// Design rules
import { aboveFoldCoverage } from "./aboveFoldCoverage";
import { heroHierarchyInversion } from "./heroHierarchyInversion";
import { mobileEngagementAsymmetry } from "./mobileEngagementAsymmetry";
import { navDispersion } from "./navDispersion";
import { rageClickTarget } from "./rageClickTarget";

// Pain rules
import { bounceOnKeyPage } from "./bounceOnKeyPage";
import { cohortPainAsymmetry } from "./cohortPainAsymmetry";
import { errorExposure } from "./errorExposure";
import { formAbandonment } from "./formAbandonment";
import { helpSeekingSpike } from "./helpSeekingSpike";
import { hesitationPattern } from "./hesitationPattern";
import { returnVisitThrash } from "./returnVisitThrash";

// Flow rules
import { flowInterStepDropoff } from "./flowInterStepDropoff";

// Structural rules (Layer E) — snapshot-only, no behavioral events required
import { headingHierarchyJump } from "./headingHierarchyJump";
import { formLabelMissing } from "./formLabelMissing";
import { imageAltTextMissing } from "./imageAltTextMissing";
import { linkTextGeneric } from "./linkTextGeneric";
import { missingMetaDescription } from "./missingMetaDescription";
import { missingCanonicalUrl } from "./missingCanonicalUrl";
import { deadClickTarget } from "./deadClickTarget";

export { aboveFoldCoverage } from "./aboveFoldCoverage";
export { heroHierarchyInversion } from "./heroHierarchyInversion";
export { mobileEngagementAsymmetry } from "./mobileEngagementAsymmetry";
export { navDispersion } from "./navDispersion";
export { rageClickTarget } from "./rageClickTarget";
export { bounceOnKeyPage } from "./bounceOnKeyPage";
export { cohortPainAsymmetry } from "./cohortPainAsymmetry";
export { errorExposure } from "./errorExposure";
export { formAbandonment } from "./formAbandonment";
export { helpSeekingSpike } from "./helpSeekingSpike";
export { hesitationPattern } from "./hesitationPattern";
export { returnVisitThrash } from "./returnVisitThrash";
export { flowInterStepDropoff } from "./flowInterStepDropoff";
export { headingHierarchyJump } from "./headingHierarchyJump";
export { formLabelMissing } from "./formLabelMissing";
export { imageAltTextMissing } from "./imageAltTextMissing";
export { linkTextGeneric } from "./linkTextGeneric";
export { missingMetaDescription } from "./missingMetaDescription";
export { missingCanonicalUrl } from "./missingCanonicalUrl";
export { deadClickTarget } from "./deadClickTarget";

export function getRuleById(ruleId: string): AuditRule | null {
  return ALL_AUDIT_RULES.find((r) => r.id === ruleId) ?? null;
}

export const ALL_AUDIT_RULES: readonly AuditRule[] = [
  // Design (Layer C)
  heroHierarchyInversion,
  aboveFoldCoverage,
  rageClickTarget,
  mobileEngagementAsymmetry,
  navDispersion,
  // Pain (Layer D)
  errorExposure,
  formAbandonment,
  bounceOnKeyPage,
  helpSeekingSpike,
  hesitationPattern,
  returnVisitThrash,
  cohortPainAsymmetry,
  // Flow rules
  flowInterStepDropoff,
  // Structural / accessibility / SEO (Layer E) — snapshot-only
  headingHierarchyJump,
  formLabelMissing,
  imageAltTextMissing,
  linkTextGeneric,
  missingMetaDescription,
  missingCanonicalUrl,
  deadClickTarget,
];

const SEVERITY_RANK: Record<AuditFindingSeverity, number> = {
  critical: 2,
  warn: 1,
  info: 0,
};

export function runAuditRules(ctx: AuditRuleContext): AuditFindingsReport {
  const findings: AuditFinding[] = [];
  const diagnostics: AuditRuleDiagnostic[] = [];

  for (const rule of ALL_AUDIT_RULES) {
    try {
      const out = rule.evaluate(ctx);
      const cal = ctx.calibration?.get(rule.id);
      // Annotate each finding with the calibration that was active when the
      // rule ran so the PM surface can show "Tuned for your site" receipts.
      if (cal && cal.direction !== 'neutral') {
        for (const f of out) {
          f.calibration = {
            direction: cal.direction,
            multiplier: cal.multiplier,
            reason: cal.reason,
            conclusiveCount: cal.conclusiveCount,
          };
        }
      }
      findings.push(...out);
      diagnostics.push({
        ruleId: rule.id,
        emitted: out.length,
        ...(cal && cal.direction !== 'neutral'
          ? {
              calibration: {
                multiplier: cal.multiplier,
                direction: cal.direction,
                reason: cal.reason,
              },
            }
          : {}),
      });
    } catch (err) {
      diagnostics.push({
        ruleId: rule.id,
        emitted: 0,
        skippedReason:
          err instanceof Error ? `THREW:${err.message}` : "THREW",
      });
    }
  }

  findings.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    return b.confidence - a.confidence;
  });

  return {
    findings,
    diagnostics,
    groundedInSnapshots: ctx.pageSnapshots.length > 0,
  };
}

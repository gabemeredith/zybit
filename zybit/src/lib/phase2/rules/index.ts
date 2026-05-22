/**
 * Phase 2 — Audit rules barrel.
 *
 * Two flavors live here:
 *   - **Design rules** (Layer C): hierarchy/fold/nav/asymmetry findings
 *     grounded in page snapshots + click distribution.
 *   - **Pain rules**   (Layer D): abandonment / help-seeking / hesitation /
 *     bounce / error / thrash / cohort-pain findings grounded in session
 *     traces + structured PostHog signals.
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
  // Flow (Layer E)
  flowInterStepDropoff,
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

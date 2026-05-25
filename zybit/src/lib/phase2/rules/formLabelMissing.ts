/**
 * Rule: form-label-missing
 *
 * Fires when a form has one or more inputs without an associated label.
 * Unlabelled inputs fail WCAG 1.3.1 (Info and Relationships) and make forms
 * harder to complete — users relying on screen readers can't identify the
 * field, and on mobile the field's purpose is unclear when the placeholder
 * disappears on focus.
 *
 * Skips hidden, submit, button, reset, and checkbox/radio inputs where
 * labelling patterns differ. Focuses on text-like fields where a visible
 * label is the expected affordance.
 *
 * Pure snapshot rule: no behavioral events required.
 */

import type { AuditFinding, AuditFindingEvidence, AuditRule, AuditRuleContext } from './types';
import type { FormInputItem } from '../snapshots/types';

const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'hidden', 'image']);

function isLabelRequired(input: FormInputItem): boolean {
  return !SKIP_TYPES.has(input.type.toLowerCase());
}

export const formLabelMissing: AuditRule = {
  id: 'form-label-missing',
  category: 'accessibility',
  name: 'Form inputs missing labels',

  evaluate(ctx: AuditRuleContext): AuditFinding[] {
    const findings: AuditFinding[] = [];

    for (const snapshot of ctx.pageSnapshots) {
      for (const form of snapshot.data.forms) {
        const labelRequired = form.inputs.filter(isLabelRequired);
        const unlabelled = labelRequired.filter((i) => !i.labelText);

        if (unlabelled.length === 0) continue;

        const evidence: AuditFindingEvidence[] = [
          {
            label: 'Unlabelled inputs',
            value: unlabelled.length,
            context: unlabelled.map((i) => i.name ?? i.type).join(', '),
          },
          { label: 'Total form fields', value: form.fieldCount },
        ];

        const unlabelledRate = unlabelled.length / Math.max(labelRequired.length, 1);
        const severity = unlabelledRate >= 0.5 ? 'warn' : 'info';

        findings.push({
          id: `form-label-missing:${snapshot.pathRef}:${form.ref}`,
          ruleId: 'form-label-missing',
          category: 'accessibility',
          severity,
          confidence: 0.9,
          priorityScore: 0.4,
          pathRef: snapshot.pathRef,
          title: `${unlabelled.length} unlabelled input${unlabelled.length > 1 ? 's' : ''} in form on ${snapshot.pathRef}`,
          summary: `A form on ${snapshot.pathRef} has ${unlabelled.length} field${unlabelled.length > 1 ? 's' : ''} (${unlabelled.map((i) => `"${i.name ?? i.type}"`).join(', ')}) with no associated <label>. Screen readers announce the field type only, leaving the user to guess its purpose. On mobile, placeholders vanish on focus — making unlabelled fields inaccessible.`,
          recommendation: [
            `Add <label for="..."> elements associated via matching id attributes to each unlabelled field: ${unlabelled.map((i) => i.name ?? i.type).join(', ')}.`,
            `If using floating labels or placeholder-only patterns, ensure the label remains visible when the field is focused.`,
          ],
          evidence,
          prescription: {
            whatToChange: `Wrap each unlabelled input in a <label> or add a <label for="fieldId"> pointing to the input's id.`,
            whyItWorks: `Visible labels reduce form abandonment by making field purpose unambiguous at all times. They also unlock browser autofill for labelled fields, cutting time-to-complete.`,
            experimentVariantDescription: `Variant adds visible labels above each unlabelled field. Measure form completion rate and time-on-form.`,
          },
          refs: { snapshotId: snapshot.id, formRef: form.ref },
        });
      }
    }

    return findings;
  },
};

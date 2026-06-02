import { describe, expect, it } from 'vitest';
import { ALL_AUDIT_RULES } from '@/lib/phase2/rules';
import {
  PUBLIC_AUDIT_DEFERRED_RULE_COUNT,
  PUBLIC_AUDIT_RULE_COUNT,
} from '@/lib/audit/publicAuditRuleCount';

describe('public-audit rule counts', () => {
  it('PUBLIC_AUDIT_RULE_COUNT matches rules that fire in public-audit mode', () => {
    const runtimeCount = ALL_AUDIT_RULES.filter(
      (r) => (r.publicAuditBehavior ?? 'empty') !== 'empty',
    ).length;
    expect(PUBLIC_AUDIT_RULE_COUNT).toBe(runtimeCount);
  });

  it('PUBLIC_AUDIT_DEFERRED_RULE_COUNT matches rules that stay dark without PostHog', () => {
    const runtimeDeferred = ALL_AUDIT_RULES.filter(
      (r) => (r.publicAuditBehavior ?? 'empty') === 'empty',
    ).length;
    expect(PUBLIC_AUDIT_DEFERRED_RULE_COUNT).toBe(runtimeDeferred);
  });
});

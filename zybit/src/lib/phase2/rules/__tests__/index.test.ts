import { describe, it, expect } from 'vitest';
import { ALL_AUDIT_RULES, getRuleById, heroHierarchyInversion } from '@/lib/phase2/rules';

describe('getRuleById', () => {
  it('returns the rule object for a known ruleId', () => {
    expect(getRuleById('hero-hierarchy-inversion')).toBe(heroHierarchyInversion);
  });

  it('returns null for an unknown ruleId', () => {
    expect(getRuleById('not-a-real-rule')).toBeNull();
  });

  it('every entry in ALL_AUDIT_RULES is resolvable via getRuleById', () => {
    for (const rule of ALL_AUDIT_RULES) {
      expect(getRuleById(rule.id)).toBe(rule);
    }
  });
});

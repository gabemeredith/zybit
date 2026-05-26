import { describe, it, expect } from 'vitest';
import { applyDefenseInDepthScrub, isFabricatedFinding } from '../publicAuditScrub';
import type { AuditFinding } from '@/lib/phase2/rules/types';

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 'finding-1',
    ruleId: 'rule-1',
    category: 'hierarchy',
    severity: 'warn',
    confidence: 0.8,
    priorityScore: 0.5,
    pathRef: '/',
    title: 'Clean title',
    summary: 'Clean summary',
    recommendation: ['Do something'],
    evidence: [{ label: 'Page', value: '/' }],
    ...overrides,
  };
}

describe('isFabricatedFinding', () => {
  it('returns false for a clean finding', () => {
    expect(isFabricatedFinding(makeFinding())).toBe(false);
  });

  it('flags findings with (unnamed button) in evidence', () => {
    const f = makeFinding({
      evidence: [{ label: 'CTA', value: '(unnamed button)' }],
    });
    expect(isFabricatedFinding(f)).toBe(true);
  });

  it('flags findings with (unnamed CTA) in title', () => {
    const f = makeFinding({ title: 'Promote (unnamed CTA) above the fold' });
    expect(isFabricatedFinding(f)).toBe(true);
  });

  it('flags findings with (unnamed button) in summary', () => {
    const f = makeFinding({ summary: 'Your hero leads with (unnamed button)' });
    expect(isFabricatedFinding(f)).toBe(true);
  });
});

describe('applyDefenseInDepthScrub', () => {
  it('drops fabricated findings and keeps clean ones', () => {
    const findings: AuditFinding[] = [
      makeFinding({ id: 'keep-1' }),
      makeFinding({ id: 'drop-1', evidence: [{ label: 'CTA', value: '(unnamed CTA)' }] }),
      makeFinding({ id: 'keep-2' }),
    ];
    const out = applyDefenseInDepthScrub(findings);
    expect(out.map((f) => f.id)).toEqual(['keep-1', 'keep-2']);
  });

  it('is pure — does not mutate input', () => {
    const findings: AuditFinding[] = [makeFinding()];
    const before = JSON.stringify(findings);
    applyDefenseInDepthScrub(findings);
    expect(JSON.stringify(findings)).toBe(before);
  });

  it('returns empty array when all findings are fabricated', () => {
    const findings: AuditFinding[] = [
      makeFinding({ id: 'drop-1', title: '(unnamed button) finding' }),
      makeFinding({ id: 'drop-2', summary: '(unnamed CTA) again' }),
    ];
    expect(applyDefenseInDepthScrub(findings)).toEqual([]);
  });
});

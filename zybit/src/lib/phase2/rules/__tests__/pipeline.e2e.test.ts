/**
 * E2E integration tests for runAuditRules.
 * Builds synthetic events across multiple paths and verifies the full pipeline
 * from raw events → AuditFindingsReport.
 */

import { describe, it, expect } from 'vitest';
import { runAuditRules } from '@/lib/phase2/rules/index';
import {
  makeContext,
  makePageView,
  makeRageClick,
  makeErrorEvent,
  makeCtaClick,
  makeSnapshot,
  makeCta,
  makeForm,
  makeGoalConfig,
} from './fixtures';
import type { CanonicalEvent } from '@/lib/phase2/types';

// -----------------------------------------------------------------------
// Helpers to build rich synthetic datasets
// -----------------------------------------------------------------------

function buildSyntheticEvents(): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  const PATHS = ['/pricing', '/signup', '/app', '/docs', '/checkout'];

  // ~50 sessions per path
  for (let p = 0; p < PATHS.length; p++) {
    const path = PATHS[p];
    for (let s = 0; s < 50; s++) {
      const sid = `e2e-session-${p}-${s}`;
      events.push(makePageView(path, sid, { scrollFraction: 0.3 + (s % 7) * 0.1 }));
      // A few rage clicks
      if (s % 5 === 0) {
        events.push(makeRageClick(path, 'Submit', sid));
      }
      // A few errors
      if (s % 8 === 0) {
        events.push(makeErrorEvent(path, 'TypeError', 'undefined ref', sid));
      }
      // CTA clicks
      if (s % 3 === 0) {
        events.push(makeCtaClick(path, 'Get started', sid));
      }
    }
  }

  return events;
}

function buildSnapshots() {
  const cta1 = makeCta('Get started', 0.9, 'below', 'cta-main');
  const cta2 = makeCta('Learn more', 0.4, 'above', 'cta-secondary');
  const form = makeForm('form-signup', [
    { name: 'email', required: true, labelText: 'Email' },
    { name: 'password', required: true, labelText: 'Password' },
    { name: 'company', required: false, labelText: 'Company' },
  ]);

  return [
    makeSnapshot('/pricing', [cta1, cta2], [{ level: 1, text: 'Choose your plan' }]),
    makeSnapshot('/signup', [cta1], [{ level: 1, text: 'Create an account' }], [form]),
    makeSnapshot('/app', [cta2], [{ level: 1, text: 'Dashboard' }]),
  ];
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('runAuditRules pipeline E2E', () => {
  it('returns AuditFindingsReport shape', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    const report = runAuditRules(ctx);

    expect(Array.isArray(report.findings)).toBe(true);
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(typeof report.groundedInSnapshots).toBe('boolean');
  });

  it('groundedInSnapshots is true when snapshots provided', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    expect(runAuditRules(ctx).groundedInSnapshots).toBe(true);
  });

  it('groundedInSnapshots is false when no snapshots', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events);
    expect(runAuditRules(ctx).groundedInSnapshots).toBe(false);
  });

  it('every finding has prescription with all three fields', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    const { findings } = runAuditRules(ctx);
    for (const f of findings) {
      expect(f.prescription, `finding ${f.id} missing prescription`).toBeDefined();
      expect(f.prescription!.whatToChange.length, `${f.id}.whatToChange empty`).toBeGreaterThan(0);
      expect(f.prescription!.whyItWorks.length, `${f.id}.whyItWorks empty`).toBeGreaterThan(0);
      expect(f.prescription!.experimentVariantDescription.length, `${f.id}.experimentVariantDescription empty`).toBeGreaterThan(0);
    }
  });

  it('every finding has non-empty evidence array', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    for (const f of runAuditRules(ctx).findings) {
      expect(f.evidence.length, `${f.id} has empty evidence`).toBeGreaterThan(0);
    }
  });

  it('every finding has valid severity', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    const VALID: string[] = ['critical', 'warn', 'info'];
    for (const f of runAuditRules(ctx).findings) {
      expect(VALID, `${f.id} has invalid severity`).toContain(f.severity);
    }
  });

  it('finding ids are unique', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    const { findings } = runAuditRules(ctx);
    const ids = findings.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('revenue mode: findings with impactEstimate have unit=conversions (no dollar figures)', () => {
    const events = buildSyntheticEvents();
    const config = makeGoalConfig('revenue');
    const ctx = makeContext(events, buildSnapshots(), config);
    const { findings } = runAuditRules(ctx);
    for (const f of findings) {
      if (f.impactEstimate) {
        expect(f.impactEstimate.unit).toBe('conversions');
        expect(f.impactEstimate.formatted).not.toContain('$');
      }
    }
  });

  it('growth mode: impactEstimate unit matches conversionLabel', () => {
    const events = buildSyntheticEvents();
    const config = makeGoalConfig('growth', { conversionLabel: 'trials' });
    const ctx = makeContext(events, buildSnapshots(), config);
    const { findings } = runAuditRules(ctx);
    for (const f of findings) {
      if (f.impactEstimate) {
        expect(f.impactEstimate.unit).toBe('trials');
        expect(f.impactEstimate.formatted).toContain('trials/month');
      }
    }
  });

  it('no config: impactEstimate unit is sessions or no impactEstimate', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots()); // no goalType/goalConfig
    const { findings } = runAuditRules(ctx);
    for (const f of findings) {
      if (f.impactEstimate) {
        expect(f.impactEstimate.unit).toBe('sessions');
      }
    }
  });

  it('empty events → returns empty findings array', () => {
    const ctx = makeContext([]);
    const { findings } = runAuditRules(ctx);
    expect(findings).toEqual([]);
  });

  it('single session → rules requiring min_sessions return []', () => {
    const sid = 'single-session';
    const events = [
      makePageView('/pricing', sid),
      makePageView('/signup', sid),
    ];
    const ctx = makeContext(events);
    const { findings } = runAuditRules(ctx);
    // Most rules need 30-100+ sessions — a single session should produce 0 findings
    expect(findings.length).toBe(0);
  });

  it('diagnostics cover all 12 rules', () => {
    const ctx = makeContext(buildSyntheticEvents(), buildSnapshots());
    const { diagnostics } = runAuditRules(ctx);
    const expectedRuleIds = [
      'hero-hierarchy-inversion',
      'above-fold-coverage',
      'rage-click-target',
      'mobile-engagement-asymmetry',
      'nav-dispersion',
      'error-exposure',
      'form-abandonment',
      'bounce-on-key-page',
      'help-seeking-spike',
      'hesitation-pattern',
      'return-visit-thrash',
      'cohort-pain-asymmetry',
    ];
    const observedIds = diagnostics.map((d) => d.ruleId);
    for (const id of expectedRuleIds) {
      expect(observedIds, `missing diagnostic for rule: ${id}`).toContain(id);
    }
  });

  it('no rule throws — all diagnostics have emitted (no THREW)', () => {
    const ctx = makeContext(buildSyntheticEvents(), buildSnapshots());
    const { diagnostics } = runAuditRules(ctx);
    for (const d of diagnostics) {
      const threw = d.skippedReason?.startsWith('THREW') ?? false;
      expect(threw, `rule ${d.ruleId} threw an exception`).toBe(false);
    }
  });

  it('findings are sorted by priorityScore descending', () => {
    const events = buildSyntheticEvents();
    const ctx = makeContext(events, buildSnapshots());
    const { findings } = runAuditRules(ctx);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i - 1].priorityScore).toBeGreaterThanOrEqual(findings[i].priorityScore);
    }
  });
});

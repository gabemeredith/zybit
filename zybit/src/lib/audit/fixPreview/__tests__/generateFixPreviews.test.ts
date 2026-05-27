import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateFixPreviews } from '../generateFixPreviews';
import type { FindingForFixPreview, FixPreviewDeps } from '../generateFixPreviews';
import type { VariantModification } from '@/lib/experiments/types';

const FINDING: FindingForFixPreview = {
  id: 'f_1',
  ruleId: 'link-text-generic',
  title: 'Generic link text',
  pathRef: '/',
  prescription: {
    whyItMatters: 'Generic link text dilutes click intent.',
    whatToChange: 'Use action-led copy.',
    whyItWorks: 'Outcome-named CTAs convert better.',
    experimentVariantDescription: 'Sentence-case action copy.',
  },
};

const STUB_MODS: VariantModification[] = [
  { type: 'text-replace', selector: 'a.cta', text: 'Get started' },
];

function makeDeps(overrides: Partial<FixPreviewDeps> = {}): FixPreviewDeps {
  return {
    suggestAuditFix: vi.fn(async () => ({
      modifications: STUB_MODS,
      rationale: 'Replaced generic copy.',
      droppedCount: 0,
    })),
    renderBeforeAfter: vi.fn(async () => ({
      beforeUrl: 'https://blob/before.png',
      afterUrl: 'https://blob/after.png',
      beforeBuffer: Buffer.from('before'),
    })),
    renderBeforeOnly: vi.fn(async () => ({
      beforeUrl: 'https://blob/before-only.png',
      beforeBuffer: Buffer.from('before-only'),
    })),
    inpaintFixAfter: vi.fn(async () => ({
      beforeUrl: 'https://blob/before-only.png',
      afterUrl: 'https://blob/after-inpaint.png',
      rationale: 'AI-edited the hero.',
    })),
    lookupDomain: vi.fn(async () => 'example.com'),
    lookupDesign: vi.fn(async () => ({ designTokens: { primaryColor: '#1A73E8' }, cssSystem: 'tailwind' })),
    persist: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.AUDIT_FIX_PREVIEW_ENABLED = '1';
});

afterEach(() => {
  delete process.env.AUDIT_FIX_PREVIEW_ENABLED;
  vi.restoreAllMocks();
});

describe('generateFixPreviews — feature flag', () => {
  it('returns tier3-fallback outcomes when AUDIT_FIX_PREVIEW_ENABLED is off', async () => {
    delete process.env.AUDIT_FIX_PREVIEW_ENABLED;
    const deps = makeDeps();
    const outcomes = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcomes).toEqual([
      { findingId: 'f_1', preview: null, reason: 'tier3-fallback' },
    ]);
    expect(deps.suggestAuditFix).not.toHaveBeenCalled();
  });
});

describe('generateFixPreviews — tier ladder', () => {
  it('tier 1: advisor returns mods + render succeeds → tier-1 preview', async () => {
    const deps = makeDeps();
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcome.reason).toBe('ok');
    expect(outcome.preview).not.toBeNull();
    expect(outcome.preview?.tier).toBe(1);
    expect(outcome.preview?.beforeUrl).toBe('https://blob/before.png');
    expect(outcome.preview?.afterUrl).toBe('https://blob/after.png');
    expect(outcome.preview?.rationale).toBe('Replaced generic copy.');
    expect(outcome.preview?.modifications).toEqual(STUB_MODS);
    // Persist was called with the tier-1 preview.
    expect(deps.persist).toHaveBeenCalledTimes(1);
    expect(deps.renderBeforeOnly).not.toHaveBeenCalled();
    expect(deps.inpaintFixAfter).not.toHaveBeenCalled();
  });

  it('tier 2: tier-1 render declines (no-op apply) → falls back to inpaint', async () => {
    const deps = makeDeps({
      // renderBeforeAfter returns null = "no-op apply, no after worth showing"
      renderBeforeAfter: vi.fn(async () => null),
    });
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcome.preview?.tier).toBe(2);
    expect(outcome.preview?.afterUrl).toBe('https://blob/after-inpaint.png');
    expect(deps.renderBeforeOnly).toHaveBeenCalledTimes(1);
    expect(deps.inpaintFixAfter).toHaveBeenCalledTimes(1);
  });

  it('tier 2: advisor returns zero mods → still attempts inpaint', async () => {
    const deps = makeDeps({
      suggestAuditFix: vi.fn(async () => ({
        modifications: [],
        rationale: null,
        droppedCount: 3,
      })),
    });
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcome.preview?.tier).toBe(2);
    // Tier 1 render never ran — no mods to apply.
    expect(deps.renderBeforeAfter).not.toHaveBeenCalled();
    expect(deps.inpaintFixAfter).toHaveBeenCalledTimes(1);
  });

  it('tier 3: inpaint fails but before render succeeded → tier-3 fallback with before-only URL', async () => {
    const deps = makeDeps({
      renderBeforeAfter: vi.fn(async () => null),
      inpaintFixAfter: vi.fn(async () => null),
    });
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcome.preview?.tier).toBe(3);
    expect(outcome.preview?.beforeUrl).toBe('https://blob/before-only.png');
    expect(outcome.preview?.afterUrl).toBeNull();
    expect(outcome.reason).toBe('inpaint-failed');
  });

  it('no-html: domain lookup fails → outcome without preview', async () => {
    const deps = makeDeps({ lookupDomain: vi.fn(async () => null) });
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcome.preview).toBeNull();
    expect(outcome.reason).toBe('no-html');
    expect(deps.suggestAuditFix).not.toHaveBeenCalled();
  });

  it('no-html: total Browserless wipeout → outcome without preview', async () => {
    const deps = makeDeps({
      renderBeforeAfter: vi.fn(async () => null),
      renderBeforeOnly: vi.fn(async () => null),
    });
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [FINDING],
      },
      deps,
    );
    expect(outcome.preview).toBeNull();
    expect(outcome.reason).toBe('no-html');
    expect(deps.inpaintFixAfter).not.toHaveBeenCalled();
  });

  it('caps at maxFindings', async () => {
    const deps = makeDeps();
    const findings = Array.from({ length: 6 }, (_, i) => ({
      ...FINDING,
      id: `f_${i}`,
    }));
    const outcomes = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings,
        maxFindings: 2,
      },
      deps,
    );
    expect(outcomes).toHaveLength(2);
    expect(deps.suggestAuditFix).toHaveBeenCalledTimes(2);
  });

  it('skips findings without a pathRef', async () => {
    const deps = makeDeps();
    const orphan = { ...FINDING, id: 'f_orphan', pathRef: null };
    const [outcome] = await generateFixPreviews(
      {
        organizationId: 'org_1',
        siteId: 'site_1',
        auditUrl: 'https://example.com',
        findings: [orphan],
      },
      deps,
    );
    expect(outcome.preview).toBeNull();
    expect(outcome.reason).toBe('no-html');
    expect(deps.suggestAuditFix).not.toHaveBeenCalled();
  });
});

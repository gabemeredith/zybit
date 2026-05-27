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
      beforeBuffer: Buffer.from('before-only-bytes'),
      fetchedHtml: '<html><body>live</body></html>',
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
  it('tier 1: before-render succeeds → screenshot fed to advisor + HTML reused for after render', async () => {
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
    expect(outcome.preview?.tier).toBe(1);
    expect(outcome.preview?.beforeUrl).toBe('https://blob/before.png');
    expect(outcome.preview?.afterUrl).toBe('https://blob/after.png');
    expect(outcome.preview?.rationale).toBe('Replaced generic copy.');
    expect(outcome.preview?.modifications).toEqual(STUB_MODS);
    expect(deps.persist).toHaveBeenCalledTimes(1);

    // Before render runs FIRST so its screenshot can ground the advisor.
    expect(deps.renderBeforeOnly).toHaveBeenCalledTimes(1);
    // Advisor receives the base64-encoded before-screenshot bytes.
    const advisorInput = vi.mocked(deps.suggestAuditFix!).mock.calls[0][0];
    expect(advisorInput.beforeScreenshotBase64).toBe(
      Buffer.from('before-only-bytes').toString('base64'),
    );
    // After render skips re-fetching the origin — receives the HTML the
    // before render already pulled.
    const afterInput = vi.mocked(deps.renderBeforeAfter!).mock.calls[0][0];
    expect(afterInput.prefetchedHtml).toBe('<html><body>live</body></html>');

    expect(deps.inpaintFixAfter).not.toHaveBeenCalled();
  });

  it('tier 2: tier-1 render declines (no-op apply) → falls back to inpaint with the same before buffer', async () => {
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
    // Before render still runs once — Tier 2 reuses its buffer.
    expect(deps.renderBeforeOnly).toHaveBeenCalledTimes(1);
    expect(deps.inpaintFixAfter).toHaveBeenCalledTimes(1);
    const inpaintArgs = vi.mocked(deps.inpaintFixAfter!).mock.calls[0][0];
    expect(inpaintArgs.beforeBuffer.toString()).toBe('before-only-bytes');
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
    // Tier 1 after render never ran — no mods to apply.
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
    // Without a domain we can't even attempt the before render.
    expect(deps.renderBeforeOnly).not.toHaveBeenCalled();
  });

  it('no-html: before render fails → bail without calling advisor or inpaint', async () => {
    const deps = makeDeps({
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
    // The whole tier ladder is gated on having a before screenshot now.
    expect(deps.suggestAuditFix).not.toHaveBeenCalled();
    expect(deps.renderBeforeAfter).not.toHaveBeenCalled();
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
    expect(deps.renderBeforeOnly).not.toHaveBeenCalled();
  });
});

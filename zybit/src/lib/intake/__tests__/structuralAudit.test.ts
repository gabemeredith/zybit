import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunSnapshotResult } from '@/lib/phase2/snapshots';
import { SnapshotError } from '@/lib/phase2/snapshots';

vi.mock('@/lib/phase2/snapshots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/phase2/snapshots')>();
  return { ...actual, runSnapshot: vi.fn() };
});

import { runSnapshot } from '@/lib/phase2/snapshots';
import { runStructuralAudit } from '../structuralAudit';

const mockRunSnapshot = vi.mocked(runSnapshot);

function makeSnapshotResult(overrides: Partial<RunSnapshotResult> = {}): RunSnapshotResult {
  return {
    finalUrl: 'https://example.com',
    byteSize: 50_000,
    data: {
      schemaVersion: 1,
      meta: {
        title: null, ogTitle: null, ogDescription: null, ogImage: null,
        description: null, canonical: null, lang: null, charset: null,
        themeColor: null, viewport: null, robotsMeta: null,
      },
      headings: [{ level: 1, text: 'Hello world', documentIndex: 0, cssSelector: null }],
      ctas: [
        {
          ref: 'cta-1', cssSelector: null, tag: 'button', text: 'Get started', href: null,
          ariaLabel: null, landmark: 'main', visualWeight: 0.8,
          visualWeightSignals: ['bg-black'], foldGuess: 'above',
          domDepth: 3, documentIndex: 0, disabled: false,
        },
      ],
      forms: [],
      contentHash: 'abc123',
      rawByteSize: 50_000,
      parsedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('runStructuralAudit — SPA detection', () => {
  it('returns spa when HTML is thin with no headings or CTAs', async () => {
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        byteSize: 2_000,
        data: {
          ...makeSnapshotResult().data,
          headings: [],
          ctas: [],
        },
      }),
    );
    const result = await runStructuralAudit('https://spa-app.com');
    expect(result.status).toBe('spa');
  });

  it('does not flag as SPA when byteSize is large even with no headings', async () => {
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        byteSize: 80_000,
        data: {
          ...makeSnapshotResult().data,
          headings: [],
          ctas: [],
        },
      }),
    );
    // Will hit no_h1 finding instead
    const result = await runStructuralAudit('https://large-page.com');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.finding.kind).toBe('no_h1');
    }
  });
});

describe('runStructuralAudit — no_h1 finding', () => {
  it('returns no_h1 when page has no H1', async () => {
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        data: {
          ...makeSnapshotResult().data,
          headings: [{ level: 2, text: 'Subheading', documentIndex: 0, cssSelector: null }],
        },
      }),
    );
    const result = await runStructuralAudit('https://example.com');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.finding.kind).toBe('no_h1');
      expect(result.finding.confidence).toBeGreaterThan(0.8);
      expect(result.finding.domain).toBe('example.com');
    }
  });
});

describe('runStructuralAudit — no_above_fold_cta finding', () => {
  it('returns no_above_fold_cta when all CTAs are below fold', async () => {
    const base = makeSnapshotResult();
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        data: {
          ...base.data,
          ctas: [
            {
              ...base.data.ctas[0],
              foldGuess: 'below',
            },
          ],
        },
      }),
    );
    const result = await runStructuralAudit('https://example.com');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.finding.kind).toBe('no_above_fold_cta');
    }
  });

  it('returns no_above_fold_cta when above-fold CTA has low visual weight', async () => {
    const base = makeSnapshotResult();
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        data: {
          ...base.data,
          ctas: [
            {
              ...base.data.ctas[0],
              foldGuess: 'above',
              visualWeight: 0.1,
            },
          ],
        },
      }),
    );
    const result = await runStructuralAudit('https://example.com');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.finding.kind).toBe('no_above_fold_cta');
    }
  });

  it('returns no_finding when a strong above-fold CTA exists', async () => {
    mockRunSnapshot.mockResolvedValueOnce(makeSnapshotResult());
    const result = await runStructuralAudit('https://example.com');
    expect(result.status).toBe('no_finding');
  });
});

describe('runStructuralAudit — heavy_form finding', () => {
  it('returns heavy_form when a form has 6+ fields', async () => {
    const base = makeSnapshotResult();
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        data: {
          ...base.data,
          forms: [
            {
              ref: 'form-1',
              cssSelector: null,
              landmark: 'main',
              fieldCount: 8,
              inputs: [],
              documentIndex: 0,
              hasSubmitButton: true,
            },
          ],
        },
      }),
    );
    const result = await runStructuralAudit('https://example.com');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.finding.kind).toBe('heavy_form');
      expect(result.finding.evidence).toContain('8');
    }
  });

  it('does not flag form with 5 fields', async () => {
    const base = makeSnapshotResult();
    mockRunSnapshot.mockResolvedValueOnce(
      makeSnapshotResult({
        data: {
          ...base.data,
          forms: [
            {
              ref: 'form-1',
              cssSelector: null,
              landmark: 'main',
              fieldCount: 5,
              inputs: [],
              documentIndex: 0,
              hasSubmitButton: true,
            },
          ],
        },
      }),
    );
    const result = await runStructuralAudit('https://example.com');
    expect(result.status).toBe('no_finding');
  });
});

describe('runStructuralAudit — error handling', () => {
  it('returns error on SnapshotError', async () => {
    mockRunSnapshot.mockRejectedValueOnce(
      new SnapshotError('TIMEOUT', 'request timed out'),
    );
    const result = await runStructuralAudit('https://slow.com');
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).toContain('TIMEOUT');
    }
  });

  it('returns error on unparseable URL (empty string)', async () => {
    const result = await runStructuralAudit('');
    expect(result.status).toBe('error');
  });

  it('accepts protocol-less input by prepending https://', async () => {
    mockRunSnapshot.mockResolvedValueOnce(makeSnapshotResult());
    const result = await runStructuralAudit('example.com');
    expect(result.status).toBe('no_finding');
    expect(mockRunSnapshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ timeoutMs: 12_000 }),
    );
  });

  it('returns error on unexpected exception', async () => {
    mockRunSnapshot.mockRejectedValueOnce(new Error('network failure'));
    const result = await runStructuralAudit('https://broken.com');
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason).toContain('network failure');
    }
  });
});

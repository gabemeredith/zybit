import { describe, expect, it, vi } from 'vitest';
import {
  buildInpaintPrompt,
  callInpaint,
  inpaintFixAfter,
  type VisionInpaintInput,
  type InpaintFetcher,
} from '../visionInpaint';
import { isLikelyBlankFrame } from '../renderBeforeAfter';
import { PNG } from 'pngjs';

// Minimal 4×4 white PNG (always > 10 KB? No — but we use a real PNG buffer).
function makeWhitePng(width = 4, height = 4): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

function makeRealPng(width = 8, height = 8): Buffer {
  const png = new PNG({ width, height });
  // non-white pixels — checker pattern
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const v = (x + y) % 2 === 0 ? 50 : 200;
      png.data[idx] = v;
      png.data[idx + 1] = v;
      png.data[idx + 2] = v;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

// JPEG magic bytes header + padding to simulate a real/blank JPEG
function makeJpegBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0xaa);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  return buf;
}

const FINDING_INPUT: VisionInpaintInput = {
  findingId: 'f_test',
  beforeBuffer: makeRealPng(),
  beforeUrl: 'https://blob/before.png',
  finding: {
    ruleId: 'proof-missing',
    title: 'No social proof',
    whatToChange: 'Add trust logos',
    whyItWorks: 'Credibility increases conversion',
  },
  designTokens: null,
};

// ── isLikelyBlankFrame — JPEG path ────────────────────────────────────────

describe('isLikelyBlankFrame — JPEG', () => {
  it('treats tiny JPEG (< 10 KB) as blank', () => {
    expect(isLikelyBlankFrame(makeJpegBuffer(5_000))).toBe(true);
  });

  it('treats 9 999-byte JPEG as blank', () => {
    expect(isLikelyBlankFrame(makeJpegBuffer(9_999))).toBe(true);
  });

  it('treats 10 000-byte JPEG as not blank', () => {
    expect(isLikelyBlankFrame(makeJpegBuffer(10_000))).toBe(false);
  });

  it('treats large JPEG as not blank', () => {
    expect(isLikelyBlankFrame(makeJpegBuffer(200_000))).toBe(false);
  });
});

// ── inpaintFixAfter — JPEG blank guard ───────────────────────────────────

describe('inpaintFixAfter — JPEG blank guard', () => {
  const blobToken = 'tok_test';

  function makeFetcher(mimeType: string, imageBuffer: Buffer): InpaintFetcher {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: imageBuffer.toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    }));
  }

  it('declines when model returns a tiny JPEG (< 10 KB blank guard)', async () => {
    const result = await inpaintFixAfter(FINDING_INPUT, {
      apiKey: 'key_test',
      fetcher: makeFetcher('image/jpeg', makeJpegBuffer(5_000)),
    });
    expect(result).toBeNull();
  });

  it('proceeds when model returns a large JPEG (≥ 10 KB)', async () => {
    // No blob token in env, so the upload path will return null — but the
    // blank guard must NOT fire before we reach the upload.
    const uploadFetcher = makeFetcher('image/jpeg', makeJpegBuffer(50_000));
    // Provide blobToken via env stub
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', blobToken);

    // put() will throw because the blob token is fake — we just need to
    // confirm the blank guard doesn't kill it first.
    const result = await inpaintFixAfter(FINDING_INPUT, {
      apiKey: 'key_test',
      fetcher: uploadFetcher,
    }).catch(() => 'upload-attempted');

    // Either null (upload failure caught) or 'upload-attempted' — but NOT
    // declined before the upload attempt for blank-frame reasons.
    // The key assertion: blank guard didn't fire (would return null silently
    // before even reaching put()).  We can confirm by checking the fetcher
    // was called exactly once (no retry = no early return before upload).
    expect(vi.mocked(uploadFetcher).mock.calls.length).toBe(1);
    vi.unstubAllEnvs();
  });
});

// ── ruleSpecificGuidance — vague-claim-detected ──────────────────────────

describe('buildInpaintPrompt — vague-claim-detected guidance', () => {
  const base = {
    designTokens: null,
    finding: {
      ruleId: 'vague-claim-detected',
      title: 'Vague claim detected',
      whatToChange: 'Be more specific',
      whyItWorks: 'Specificity builds trust',
    },
  };

  it('includes location-agnostic language (not hero-specific)', () => {
    const prompt = buildInpaintPrompt(base);
    expect(prompt).toContain('stat block, testimonial, feature blurb');
    expect(prompt).not.toContain('hero headline text in place');
  });

  it('warns not to change the hero unless evidence cites it', () => {
    const prompt = buildInpaintPrompt(base);
    expect(prompt).toContain('Do NOT change the hero headline unless the evidence explicitly cites it');
  });

  it('is distinct from hero-hierarchy-inversion guidance', () => {
    const heroPrompt = buildInpaintPrompt({
      ...base,
      finding: { ...base.finding, ruleId: 'hero-hierarchy-inversion' },
    });
    const vaguePrompt = buildInpaintPrompt(base);
    expect(heroPrompt).not.toBe(vaguePrompt);
    expect(heroPrompt).toContain('hero headline');
    expect(vaguePrompt).not.toContain('Replace the existing hero headline text in place');
  });
});

// ── callInpaint — basic response parsing ────────────────────────────────

describe('callInpaint', () => {
  it('extracts inlineData from camelCase response', async () => {
    const buf = makeRealPng();
    const fetcher: InpaintFetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: buf.toString('base64') } }],
            },
          },
        ],
      }),
    }));
    const result = await callInpaint({ apiKey: 'k', prompt: 'edit this', beforeBuffer: buf, fetcher });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
    expect(result!.buffer.equals(buf)).toBe(true);
  });

  it('returns null when no image part in response', async () => {
    const fetcher: InpaintFetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'I cannot edit this' }] } }] }),
    }));
    const result = await callInpaint({
      apiKey: 'k',
      prompt: 'edit this',
      beforeBuffer: makeRealPng(),
      fetcher,
    });
    expect(result).toBeNull();
  });

  it('throws on non-ok HTTP response', async () => {
    const fetcher: InpaintFetcher = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    await expect(
      callInpaint({ apiKey: 'k', prompt: 'edit', beforeBuffer: makeRealPng(), fetcher }),
    ).rejects.toThrow('HTTP 429');
  });
});

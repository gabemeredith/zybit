/**
 * Unit tests for the perceptual diff helper that gates the Tier 1 render
 * from returning a "pair" the prospect would read as identical. The
 * surrounding Browserless / Blob plumbing is exercised live by
 * `scripts/live-fix-preview.ts`; here we cover only the pure pixel logic.
 */

import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { isVisiblyChanged, PIXEL_DIFF_THRESHOLD } from '../renderBeforeAfter';

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

/** Flip the alpha channel of N consecutive pixels — minimum-effort diff. */
function patchPixels(base: Buffer, count: number, color: [number, number, number]): Buffer {
  const png = PNG.sync.read(base);
  for (let i = 0; i < count; i++) {
    const idx = i << 2;
    png.data[idx] = color[0];
    png.data[idx + 1] = color[1];
    png.data[idx + 2] = color[2];
  }
  return PNG.sync.write(png);
}

describe('isVisiblyChanged', () => {
  it('returns false for two identical PNGs', () => {
    const a = solidPng(64, 64, [255, 255, 255, 255]);
    const b = solidPng(64, 64, [255, 255, 255, 255]);
    expect(isVisiblyChanged(a, b)).toBe(false);
  });

  it('returns true when more than PIXEL_DIFF_THRESHOLD pixels differ', () => {
    const a = solidPng(64, 64, [255, 255, 255, 255]);
    // Patch more than threshold pixels (PIXEL_DIFF_THRESHOLD + 100) to ensure we're above
    const b = patchPixels(a, PIXEL_DIFF_THRESHOLD + 100, [0, 0, 0]);
    expect(isVisiblyChanged(a, b)).toBe(true);
  });

  it('returns false when fewer than PIXEL_DIFF_THRESHOLD pixels differ (sub-pixel / ghost change)', () => {
    const a = solidPng(64, 64, [255, 255, 255, 255]);
    // 172 px is the "Vercel ghost" case — host CSS overrides the injection,
    // render jitter produces tiny diff that isn't visible to a human.
    const b = patchPixels(a, 172, [0, 0, 0]);
    expect(isVisiblyChanged(a, b)).toBe(false);
  });

  it('returns true when dimensions differ', () => {
    const a = solidPng(64, 64, [255, 255, 255, 255]);
    const b = solidPng(64, 65, [255, 255, 255, 255]);
    expect(isVisiblyChanged(a, b)).toBe(true);
  });

  it('returns true (safe default) when input is not a valid PNG', () => {
    const good = solidPng(64, 64, [255, 255, 255, 255]);
    expect(isVisiblyChanged(good, Buffer.from('not-a-png'))).toBe(true);
  });
});

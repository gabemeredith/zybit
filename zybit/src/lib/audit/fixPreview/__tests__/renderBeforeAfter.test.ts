/**
 * Unit tests for the perceptual diff helper that gates the Tier 1 render
 * from returning a "pair" the prospect would read as identical. The
 * surrounding Browserless / Blob plumbing is exercised live by
 * `scripts/live-fix-preview.ts`; here we cover only the pure pixel logic.
 */

import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { isVisiblyChanged } from '../renderBeforeAfter';

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

  it('returns true when more than 100 pixels differ', () => {
    const a = solidPng(64, 64, [255, 255, 255, 255]);
    const b = patchPixels(a, 200, [0, 0, 0]);
    expect(isVisiblyChanged(a, b)).toBe(true);
  });

  it('returns false when fewer than 100 pixels differ (sub-pixel jitter)', () => {
    const a = solidPng(64, 64, [255, 255, 255, 255]);
    const b = patchPixels(a, 50, [0, 0, 0]);
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

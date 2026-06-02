import { describe, it, expect } from 'vitest';
import { guardSegmentBatch, MAX_SEGMENT_BATCH_SIZE } from '../mapping';

describe('guardSegmentBatch', () => {
  it('rejects non-object/non-array bodies', () => {
    for (const bad of [null, undefined, 'str', 42, true]) {
      const r = guardSegmentBatch(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('SEGMENT_PAYLOAD_INVALID');
    }
  });

  it('accepts a single message object and wraps it', () => {
    const r = guardSegmentBatch({ type: 'page' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(1);
  });

  it('unwraps a { batch: [...] } envelope', () => {
    const r = guardSegmentBatch({ batch: [{ type: 'track' }, { type: 'page' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(2);
  });

  it('accepts a bare array', () => {
    const r = guardSegmentBatch([{ type: 'track' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(1);
  });

  it('rejects an oversized batch', () => {
    const big = Array.from({ length: MAX_SEGMENT_BATCH_SIZE + 1 }, () => ({ type: 'track' }));
    const r = guardSegmentBatch({ batch: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SEGMENT_BATCH_TOO_LARGE');
  });

  it('accepts a batch exactly at the limit', () => {
    const atLimit = Array.from({ length: MAX_SEGMENT_BATCH_SIZE }, () => ({ type: 'track' }));
    expect(guardSegmentBatch({ batch: atLimit }).ok).toBe(true);
  });
});

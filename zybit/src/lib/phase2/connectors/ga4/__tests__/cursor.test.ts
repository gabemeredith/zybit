import { describe, expect, it } from 'vitest';
import { advanceCursor, filterAfterCursor, readCursor, writeCursor } from '../cursor';
import type { GA4EventRow } from '../types';

function row(ts: string, path: string): GA4EventRow {
  const [date, rest] = ['20260519', ts];
  return {
    eventName: 'page_view',
    sessionId: '',
    userId: null,
    timestamp: rest,
    pagePath: path,
    dimensions: { date, hour: '10', minute: '30' },
  };
}

describe('readCursor / writeCursor', () => {
  it('round-trips and tolerates missing fields', () => {
    expect(readCursor(null)).toEqual({ afterTimestamp: '', lastKey: '' });
    const c = { afterTimestamp: '2026-05-19T10:30:00.000Z', lastKey: 'k' };
    expect(readCursor(writeCursor(c))).toEqual(c);
  });
});

describe('advanceCursor', () => {
  it('takes the max (timestamp, grainKey) across rows and current', () => {
    const c = advanceCursor(
      { afterTimestamp: '', lastKey: '' },
      [row('2026-05-19T10:30:00.000Z', '/a'), row('2026-05-19T11:00:00.000Z', '/b')],
    );
    expect(c.afterTimestamp).toBe('2026-05-19T11:00:00.000Z');
  });

  it('breaks ties on the grain key, not just timestamp', () => {
    const same = '2026-05-19T10:30:00.000Z';
    const c = advanceCursor({ afterTimestamp: '', lastKey: '' }, [
      row(same, '/a'),
      row(same, '/z'),
    ]);
    expect(c.afterTimestamp).toBe(same);
    expect(c.lastKey).toContain('%2Fz');
  });

  it('never regresses below the incoming cursor', () => {
    const c = advanceCursor(
      { afterTimestamp: '2026-05-19T12:00:00.000Z', lastKey: 'zzz' },
      [row('2026-05-19T09:00:00.000Z', '/a')],
    );
    expect(c.afterTimestamp).toBe('2026-05-19T12:00:00.000Z');
  });
});

describe('filterAfterCursor', () => {
  it('returns all rows when the cursor is empty', () => {
    const rows = [row('2026-05-19T10:30:00.000Z', '/a')];
    expect(filterAfterCursor(rows, { afterTimestamp: '', lastKey: '' })).toHaveLength(1);
  });

  it('drops rows at or before the cursor; keeps strictly-after', () => {
    const rows = [
      row('2026-05-19T09:00:00.000Z', '/old'),
      row('2026-05-19T10:30:00.000Z', '/at'),
      row('2026-05-19T11:00:00.000Z', '/new'),
    ];
    const out = filterAfterCursor(rows, {
      afterTimestamp: '2026-05-19T10:30:00.000Z',
      lastKey: 'zzzzzzzzzz',
    });
    expect(out.map((r) => r.pagePath)).toEqual(['/new']);
  });
});

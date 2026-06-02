import { describe, expect, it } from 'vitest';
import { deriveIntegrationHealth, deriveBridgeHealth } from '../cockpit';

const NOW = new Date('2026-05-19T12:00:00Z').getTime();

describe('deriveIntegrationHealth', () => {
  it('reports "Zybit is watching" for a recently synced active integration', () => {
    const h = deriveIntegrationHealth(
      { status: 'active', lastSyncedAt: '2026-05-19T11:30:00Z', lastErrorCode: null },
      NOW,
    );
    expect(h.state).toBe('watching');
    expect(h.tone).toBe('green');
    expect(h.label).toBe('Zybit is watching');
  });

  it('reports "No data yet" when never synced', () => {
    const h = deriveIntegrationHealth(
      { status: 'pending', lastSyncedAt: null, lastErrorCode: null },
      NOW,
    );
    expect(h.state).toBe('no-data');
    expect(h.tone).toBe('amber');
  });

  it('reports degraded with the error code when an error is present', () => {
    const h = deriveIntegrationHealth(
      { status: 'error', lastSyncedAt: '2026-05-19T11:30:00Z', lastErrorCode: 'AUTH_FAILED' },
      NOW,
    );
    expect(h.state).toBe('degraded');
    expect(h.tone).toBe('red');
    expect(h.label).toContain('AUTH_FAILED');
  });

  it('reports degraded when the last sync is stale (> 2h)', () => {
    const h = deriveIntegrationHealth(
      { status: 'active', lastSyncedAt: '2026-05-19T08:00:00Z', lastErrorCode: null },
      NOW,
    );
    expect(h.state).toBe('degraded');
    expect(h.label).toContain('stale');
  });

  it('reports disconnected when disabled', () => {
    const h = deriveIntegrationHealth(
      { status: 'disabled', lastSyncedAt: '2026-05-19T11:30:00Z', lastErrorCode: null },
      NOW,
    );
    expect(h.state).toBe('disconnected');
    expect(h.tone).toBe('gray');
  });
});

describe('deriveBridgeHealth', () => {
  it('is inactive (gray) when there is no experiment traffic', () => {
    const b = deriveBridgeHealth(0, 0);
    expect(b.state).toBe('inactive');
    expect(b.tone).toBe('gray');
  });

  it('flags not-detected (amber) once enough visitors are assigned but none bridged', () => {
    const b = deriveBridgeHealth(50, 0);
    expect(b.state).toBe('not-detected');
    expect(b.tone).toBe('amber');
    expect(b.label).toContain('not detected');
  });

  it('stays healthy on low assignment volume to avoid first-hit flapping', () => {
    const b = deriveBridgeHealth(5, 0);
    expect(b.state).toBe('healthy');
  });

  it('is healthy (green) when assigned visitors join conversions', () => {
    const b = deriveBridgeHealth(50, 12);
    expect(b.state).toBe('healthy');
    expect(b.tone).toBe('green');
    expect(b.bridgedVisitors).toBe(12);
  });
});

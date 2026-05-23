import { describe, expect, it } from 'vitest';
import {
  connectorHealth,
  formatTimeAgo,
  siteHealth,
  type OpsConnector,
  type OpsRow,
} from '../opsQueries';

const NOW = Date.parse('2026-05-23T12:00:00Z');

function connector(overrides: Partial<OpsConnector> = {}): OpsConnector {
  return {
    provider: 'posthog',
    status: 'active',
    consecutiveFailures: 0,
    lastSyncedAt: '2026-05-23T11:30:00Z',
    lastErrorCode: null,
    ...overrides,
  };
}

function row(overrides: Partial<OpsRow> = {}): OpsRow {
  return {
    organizationId: 'org-1',
    organizationName: 'Acme',
    plan: 'starter',
    siteId: 'site-1',
    siteDomain: 'acme.com',
    siteCreatedAt: '2026-05-01T00:00:00Z',
    connectors: [connector()],
    lastEventAt: '2026-05-23T11:55:00Z',
    snapshotAgeDays: 1,
    snapshotCount: 5,
    openFindings: 2,
    ...overrides,
  };
}

describe('formatTimeAgo', () => {
  it('returns "never" for null', () => {
    expect(formatTimeAgo(null, NOW)).toBe('never');
  });

  it('returns "just now" inside the first minute', () => {
    expect(formatTimeAgo('2026-05-23T11:59:30Z', NOW)).toBe('just now');
  });

  it('returns minutes when under an hour', () => {
    expect(formatTimeAgo('2026-05-23T11:45:00Z', NOW)).toBe('15m ago');
  });

  it('returns hours when under a day', () => {
    expect(formatTimeAgo('2026-05-23T06:00:00Z', NOW)).toBe('6h ago');
  });

  it('returns days when under a month', () => {
    expect(formatTimeAgo('2026-05-20T12:00:00Z', NOW)).toBe('3d ago');
  });

  it('returns months when older', () => {
    expect(formatTimeAgo('2026-02-20T12:00:00Z', NOW)).toBe('3mo ago');
  });

  it('returns "—" for a future timestamp (clock skew)', () => {
    expect(formatTimeAgo('2026-05-24T00:00:00Z', NOW)).toBe('—');
  });
});

describe('connectorHealth', () => {
  it('maps status="active" to healthy', () => {
    expect(connectorHealth(connector({ status: 'active' }))).toBe('healthy');
  });

  it('maps status="connected" to healthy too', () => {
    expect(connectorHealth(connector({ status: 'connected' }))).toBe('healthy');
  });

  it('maps status="degraded" to degraded', () => {
    expect(connectorHealth(connector({ status: 'degraded' }))).toBe('degraded');
  });

  it('promotes a healthy-status connector with 3+ failures to degraded', () => {
    expect(
      connectorHealth(connector({ status: 'active', consecutiveFailures: 3 })),
    ).toBe('degraded');
  });

  it('maps status="disconnected" to disconnected', () => {
    expect(connectorHealth(connector({ status: 'disconnected' }))).toBe('disconnected');
  });

  it('returns unknown for an unrecognised status', () => {
    expect(connectorHealth(connector({ status: 'paused' }))).toBe('unknown');
  });
});

describe('siteHealth', () => {
  it('returns inactive when no connectors are configured', () => {
    expect(siteHealth(row({ connectors: [] }), NOW)).toBe('inactive');
  });

  it('returns green for a healthy connector + recent events', () => {
    expect(siteHealth(row(), NOW)).toBe('green');
  });

  it('returns amber when the last event is older than 24h', () => {
    expect(siteHealth(row({ lastEventAt: '2026-05-21T11:00:00Z' }), NOW)).toBe('amber');
  });

  it('returns amber when a connector is degraded', () => {
    expect(
      siteHealth(row({ connectors: [connector({ status: 'degraded' })] }), NOW),
    ).toBe('amber');
  });

  it('returns red when any connector is disconnected', () => {
    expect(
      siteHealth(row({ connectors: [connector({ status: 'disconnected' })] }), NOW),
    ).toBe('red');
  });

  it('returns red even if events look recent when a connector is fully disconnected', () => {
    expect(
      siteHealth(
        row({
          lastEventAt: '2026-05-23T11:59:00Z',
          connectors: [connector({ status: 'disconnected' })],
        }),
        NOW,
      ),
    ).toBe('red');
  });
});

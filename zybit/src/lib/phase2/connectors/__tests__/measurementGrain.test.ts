import { describe, it, expect } from 'vitest';
import { isGa4OnlyMeasurementGap } from '@/lib/phase2/connectors/measurementGrain';

describe('isGa4OnlyMeasurementGap', () => {
  it('is false when no integrations are connected', () => {
    expect(isGa4OnlyMeasurementGap([])).toBe(false);
  });

  it('is true when GA4 is the only connected integration', () => {
    expect(
      isGa4OnlyMeasurementGap([{ provider: 'ga4', status: 'active' }]),
    ).toBe(true);
  });

  it('is true when multiple GA4 integrations are connected', () => {
    expect(
      isGa4OnlyMeasurementGap([
        { provider: 'ga4', status: 'active' },
        { provider: 'ga4', status: 'error' },
      ]),
    ).toBe(true);
  });

  it('is false when PostHog is connected alongside GA4', () => {
    expect(
      isGa4OnlyMeasurementGap([
        { provider: 'ga4', status: 'active' },
        { provider: 'posthog', status: 'active' },
      ]),
    ).toBe(false);
  });

  it('is false when only PostHog is connected', () => {
    expect(
      isGa4OnlyMeasurementGap([{ provider: 'posthog', status: 'active' }]),
    ).toBe(false);
  });

  it('is false when only Segment is connected', () => {
    expect(
      isGa4OnlyMeasurementGap([{ provider: 'segment', status: 'active' }]),
    ).toBe(false);
  });

  it('ignores disabled integrations when judging the gap', () => {
    expect(
      isGa4OnlyMeasurementGap([
        { provider: 'ga4', status: 'active' },
        { provider: 'posthog', status: 'disabled' },
      ]),
    ).toBe(true);
  });

  it('is false when every integration is disabled (nothing active)', () => {
    expect(
      isGa4OnlyMeasurementGap([{ provider: 'ga4', status: 'disabled' }]),
    ).toBe(false);
  });
});

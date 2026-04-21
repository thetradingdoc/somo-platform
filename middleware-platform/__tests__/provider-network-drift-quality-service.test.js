const db = require('../database');
const { computeProviderNetworkDriftQuality } = require('../services/provider-network-drift-quality-service');
const { seedProviderNetworkDriftTestData, cleanupProviderNetworkDriftTestData } = require('../scripts/seed-provider-network-drift-test-data.cjs');

describe('provider network drift quality (seeded fixtures)', () => {
  afterEach(() => {
    cleanupProviderNetworkDriftTestData(db.db);
  });

  test('surfaces low confidence, invalid status, bad date range, stale, and status drift', () => {
    seedProviderNetworkDriftTestData(db.db);
    const r = computeProviderNetworkDriftQuality(db.db);

    expect(r.pass).toBe(false);
    expect(r.totals.total_links).toBeGreaterThanOrEqual(8);

    expect(r.low_confidence_links.some((x) => x.provider_npi === 'NPI-TEST-001')).toBe(true);
    expect(r.invalid_statuses.some((x) => x.provider_npi === 'NPI-TEST-002')).toBe(true);
    expect(r.invalid_date_ranges.some((x) => x.provider_npi === 'NPI-TEST-003')).toBe(true);
    expect(r.stale_links.some((x) => x.provider_npi === 'NPI-TEST-004')).toBe(true);
    expect(r.status_drift_pairs.some((x) => x.provider_npi === 'NPI-TEST-005')).toBe(true);
  });
});

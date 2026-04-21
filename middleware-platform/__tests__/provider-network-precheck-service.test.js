const db = require('../database');
const { resolveProviderPayorNetworkPrecheck } = require('../services/provider-network-precheck-service');

function resetNetworkFixtures() {
  db.db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM provider_payer_networks;
    DELETE FROM provider_registry_source_links;
    DELETE FROM provider_registry_entities;
    DELETE FROM payor_entity_aliases;
    DELETE FROM payor_canonical_entities;
    PRAGMA foreign_keys = ON;
  `);
}

describe('provider network precheck service', () => {
  beforeEach(() => {
    resetNetworkFixtures();
  });

  test('returns no_network_data when provider_payer_networks is empty', () => {
    const now = new Date().toISOString();
    db.db.prepare(`
      INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
      VALUES ('prov_pchk', '1234567890', 'A', 'B', 'individual', 'active', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
      VALUES ('payor_pchk', 'BigCo', 'P-BIG', 'active', ?, ?)
    `).run(now, now);

    const out = resolveProviderPayorNetworkPrecheck({
      args: { provider_npi: '1234567890', payer_id: 'P-BIG' },
      resolverOutcome: null
    });
    expect(out.decision).toBe('unknown');
    expect(out.reason).toBe('no_network_data');
    expect(out.trace.provider_entity_id).toBe('prov_pchk');
    expect(out.trace.payor_entity_id).toBe('payor_pchk');
  });

  test('returns network_link_not_found when table has rows but not for this pair', () => {
    const now = new Date().toISOString();
    db.db.prepare(`
      INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
      VALUES ('prov_a', '1111111111', 'A', 'B', 'individual', 'active', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO provider_registry_entities (id, canonical_npi, first_name, last_name, provider_type, status, created_at, updated_at)
      VALUES ('prov_b', '2222222222', 'C', 'D', 'individual', 'active', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
      VALUES ('payor_x', 'Co', 'P-X', 'active', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO payor_canonical_entities (id, canonical_name, canonical_payer_id, status, created_at, updated_at)
      VALUES ('payor_y', 'Other', 'P-Y', 'active', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO provider_payer_networks (
        id, provider_entity_id, payor_entity_id, network_status, confidence, source, created_at, updated_at
      ) VALUES ('link1', 'prov_a', 'payor_x', 'in_network', 0.9, 'test', ?, ?)
    `).run(now, now);

    const out = resolveProviderPayorNetworkPrecheck({
      args: { provider_npi: '2222222222', payer_id: 'P-Y' },
      resolverOutcome: null
    });
    expect(out.reason).toBe('network_link_not_found');
  });
});
